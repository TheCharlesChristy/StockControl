import { createHash, randomUUID } from "node:crypto";

import type { Kysely, Transaction } from "kysely";

import type {
  BackgroundJobEnvelope,
  LocalBarcodeObservation,
  RecognitionIdentityDraft,
  RecognitionSessionStatus,
  RecognitionStageReportView,
} from "@stockcontrol/contracts";
import type { StructuredLogger } from "@stockcontrol/platform";
import {
  canonicalGtin,
  validateProductCode,
  type CandidateIdentityInput,
  type FusedCandidate,
  type StageResult,
} from "@stockcontrol/module-stock-capture";
import type { STOCKCONTROL_SCHEMA, StockControlDatabase } from "@stockcontrol/platform-database";

import { mapWithConcurrency } from "./bounded-concurrency";
import {
  barcodeStageResult,
  catalogueStageResult,
  categoryStageResult,
  runFusion,
  visualStageResult,
  vlmStageResult,
  webStageResult,
} from "./candidate-fusion";
import { queryCatalogue, type CatalogueMatch } from "./catalogue-retrieval";
import {
  RecognitionCoreClient,
  type AnalyseSessionResult,
  type CorePhotoResult,
  type RecognitionCoreImageInput,
} from "./core-client";
import {
  FusionClient,
  FusionUnavailableError,
  type VlmCandidateAllowlistEntry,
  type VlmProposal,
  type VlmRequest,
} from "./fusion-client";
import type { ImageStorage } from "./image-storage";
import type { RecognitionPipelineConfiguration } from "./recognition-configuration";
import { encodeFloat16Buffer, findNearestNeighbours } from "./visual-index";
import { loadVisualIndex } from "./visual-index-store";
import { gatherWebEvidence } from "./web-evidence";

/*
 * The "Recognize" job handler, specification sections 7 and 9.3. It owns:
 * downloading and re-verifying Bucket objects, invoking model services with
 * deadlines, catalogue retrieval, in-memory visual search, bounded web
 * evidence, deterministic fusion, and the transactional candidate/session
 * write that ends the job.
 *
 * Every model-backed stage degrades to `Unavailable` on its own rather than
 * failing the job — a session reaches `ReviewReady` on whatever evidence
 * exists, even if that is none at all, because "type it in" is always the
 * fallback a person has. `Failed` is reserved for the one case where there
 * is nothing to review at all: no verified photograph and no local code.
 */

const SCHEMA: typeof STOCKCONTROL_SCHEMA = "stockcontrol";

type Database = Kysely<StockControlDatabase> | Transaction<StockControlDatabase>;

interface ImageRow {
  readonly id: string;
  readonly ordinal: number;
  readonly object_key: string;
  readonly sha256: string;
}

interface VerifiedImage {
  readonly ordinal: number;
  readonly bytes: Buffer;
  readonly mediaType: string;
}

interface GatheredEvidence {
  readonly results: readonly StageResult[];
  readonly stageReports: readonly RecognitionStageReportView[];
  readonly suggestedDraft: RecognitionIdentityDraft | null;
}

export interface RecognitionHandlerDependencies {
  readonly database: Kysely<StockControlDatabase>;
  readonly imageStorage: ImageStorage;
  readonly configuration: RecognitionPipelineConfiguration;
  readonly logger: StructuredLogger;
}

/**
 * Every non-terminal session status the worker still owns. A lease can be
 * lost and reclaimed mid-job (ADR 0004), so a retried run may resume from
 * any of these, not only the one it left off at — the guard below only has
 * to prove nobody has cancelled, expired, or completed the session out from
 * under it, not that this is exactly the step it expected next.
 */
const PROCESSING_STATUSES: readonly RecognitionSessionStatus[] = [
  "Queued",
  "ProcessingBarcode",
  "ProcessingImages",
  "Enriching",
  "Fusing",
];

/** True when the guarded write actually happened — false means a concurrent
 * cancellation, expiry, or duplicate run already moved the session on, and
 * this handler must stop touching it. */
const advanceStatus = async (
  database: Database,
  sessionId: string,
  to: RecognitionSessionStatus,
): Promise<boolean> => {
  const result = await database
    .withSchema(SCHEMA)
    .updateTable("stock_recognition_sessions")
    .set({ status: to, updated_at: new Date() })
    .where("id", "=", sessionId)
    .where("status", "in", PROCESSING_STATUSES)
    .executeTakeFirst();
  return Number(result.numUpdatedRows) > 0;
};

const readLocalCodeValues = (localCodes: unknown): readonly LocalBarcodeObservation[] => {
  if (!Array.isArray(localCodes)) return [];
  const codes: LocalBarcodeObservation[] = [];
  for (const entry of localCodes) {
    if (typeof entry !== "object" || entry === null) continue;
    const { value, symbology, imageOrdinal, readerVersion } = entry as Record<string, unknown>;
    if (typeof value !== "string" || typeof symbology !== "string") continue;
    const safeImageOrdinal =
      typeof imageOrdinal === "number" &&
      Number.isInteger(imageOrdinal) &&
      imageOrdinal >= 1 &&
      imageOrdinal <= 5
        ? imageOrdinal
        : 1;
    codes.push({
      value,
      symbology,
      imageOrdinal: safeImageOrdinal,
      readerVersion: typeof readerVersion === "string" ? readerVersion : "unknown",
    });
  }
  return codes;
};

/** Retains both browser and server decodes, preferring the browser on duplicates. */
export const mergeDetectedBarcodes = (
  localCodes: readonly LocalBarcodeObservation[],
  photoResults: readonly CorePhotoResult[],
): readonly LocalBarcodeObservation[] => {
  const merged: LocalBarcodeObservation[] = [];
  const seen = new Set<string>();
  const add = (code: LocalBarcodeObservation): void => {
    const value = code.value.trim();
    const symbology = code.symbology.trim();
    if (value === "" || symbology === "") return;
    const key = `${symbology.toUpperCase()}:${value.toUpperCase()}:${String(code.imageOrdinal)}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({ ...code, value, symbology });
  };

  localCodes.forEach(add);
  for (const photo of photoResults) {
    for (const barcode of photo.barcodes) {
      add({
        value: barcode.value,
        symbology: barcode.symbology,
        imageOrdinal: photo.imageOrdinal,
        readerVersion: "recognition-core",
      });
    }
  }

  return merged.slice(0, 20);
};

/** Downloads each declared image and keeps only the ones whose bytes match
 * the digest declared at upload time (spec: "the worker re-checks ... digest
 * ... on what actually arrived"). A mismatch is marked Rejected, not
 * retried — the browser already had its one chance to upload the right
 * bytes, and a second attempt would just be trusting the same channel twice. */
const verifyImages = async (
  database: Database,
  imageStorage: ImageStorage,
  images: readonly ImageRow[],
  logger: StructuredLogger,
): Promise<readonly VerifiedImage[]> => {
  const verified: VerifiedImage[] = [];

  for (const image of images) {
    try {
      const downloaded = await imageStorage.getObject(image.object_key);
      const digest = createHash("sha256").update(downloaded.bytes).digest("hex");
      const status = digest === image.sha256 ? "Verified" : "Rejected";

      await database
        .withSchema(SCHEMA)
        .updateTable("stock_recognition_images")
        .set({ status })
        .where("id", "=", image.id)
        .execute();

      if (status === "Verified") {
        verified.push({
          ordinal: image.ordinal,
          bytes: downloaded.bytes,
          mediaType: downloaded.mediaType,
        });
      }
    } catch (error: unknown) {
      logger.error({
        event: "recognition.image_download_failed",
        imageId: image.id,
        errorName: error instanceof Error ? error.name : "Unknown",
      });
      await database
        .withSchema(SCHEMA)
        .updateTable("stock_recognition_images")
        .set({ status: "Rejected" })
        .where("id", "=", image.id)
        .execute();
    }
  }

  return verified;
};

export interface AggregatedIdentifiers {
  readonly barcodeLikeCandidates: readonly string[];
  readonly partNumberCandidates: readonly string[];
  readonly nameFragments: readonly string[];
  readonly manufacturerTokens: readonly string[];
  readonly validatedGtin: string | null;
}

const aggregateIdentifiers = (
  photoResults: readonly CorePhotoResult[],
  localCodes: readonly LocalBarcodeObservation[],
): AggregatedIdentifiers => {
  const barcodeLike = new Set<string>();
  const partNumbers = new Set<string>();
  const names = new Set<string>();
  const manufacturers = new Set<string>();
  let validatedGtin: string | null = null;

  const considerCode = (value: string, symbology: string): void => {
    const validated = validateProductCode({ value, symbology });
    if (validated === null) return;
    // A validated code is exactly what the catalogue's barcode/reference
    // lookup searches on — this is what makes a local scan or a
    // recognition-core barcode observation actually reach queryCatalogue.
    barcodeLike.add(validated.value);
    if (validated.canonicalGtin !== null) {
      barcodeLike.add(validated.canonicalGtin);
      validatedGtin ??= validated.canonicalGtin;
    }
  };

  for (const code of localCodes) considerCode(code.value, code.symbology);

  for (const photo of photoResults) {
    for (const barcode of photo.barcodes) considerCode(barcode.value, barcode.symbology);
    for (const value of photo.identifiers.barcodeLikeCandidates) {
      barcodeLike.add(value);
      const gtin = canonicalGtin(value);
      if (gtin !== null) validatedGtin ??= gtin;
    }
    for (const value of photo.identifiers.partNumberCandidates) partNumbers.add(value);
    for (const value of photo.identifiers.nameFragments) names.add(value);
    for (const value of photo.identifiers.manufacturerTokens) manufacturers.add(value);
  }

  return {
    barcodeLikeCandidates: [...barcodeLike],
    partNumberCandidates: [...partNumbers],
    nameFragments: [...names],
    manufacturerTokens: [...manufacturers],
    validatedGtin,
  };
};

const draftHasEvidence = (draft: RecognitionIdentityDraft): boolean =>
  draft.name.trim() !== "" ||
  draft.manufacturer !== null ||
  draft.partNumber !== null ||
  draft.barcode !== null ||
  draft.variantAttributes.length > 0;

/**
 * Keeps useful structured evidence even when deterministic fusion cannot
 * produce a catalogue candidate. The person still confirms every field; this
 * only prevents OCR/VLM work that already succeeded from disappearing behind
 * a blank manual-entry form.
 */
export const suggestedDraftFromEvidence = (
  identifiers: AggregatedIdentifiers,
  photoResults: readonly CorePhotoResult[],
  localCodes: readonly LocalBarcodeObservation[],
): RecognitionIdentityDraft | null => {
  const manufacturer = identifiers.manufacturerTokens[0] ?? null;
  const nameFragment = identifiers.nameFragments.find((value) => /[A-Za-z]/u.test(value)) ?? "";
  const name =
    manufacturer !== null &&
    nameFragment !== "" &&
    !nameFragment.toLocaleLowerCase().includes(manufacturer.toLocaleLowerCase())
      ? `${manufacturer} ${nameFragment}`
      : nameFragment || manufacturer || "";
  const variants = photoResults
    .flatMap((photo) => photo.identifiers.variantAttributes)
    .filter(
      (attribute, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.label.toLocaleLowerCase() === attribute.label.toLocaleLowerCase() &&
            candidate.value.toLocaleLowerCase() === attribute.value.toLocaleLowerCase(),
        ) === index,
    )
    .slice(0, 8);
  const draft: RecognitionIdentityDraft = {
    manufacturer,
    name: name.slice(0, 120),
    partNumber: identifiers.partNumberCandidates[0] ?? null,
    barcode:
      identifiers.validatedGtin ??
      identifiers.barcodeLikeCandidates[0] ??
      localCodes[0]?.value ??
      null,
    unit: null,
    variantAttributes: variants,
  };

  return draftHasEvidence(draft) ? draft : null;
};

const draftFromVlmProposal = (proposal: VlmProposal): RecognitionIdentityDraft | null => {
  if (proposal.kind !== "ExternalIdentity") return null;
  return {
    manufacturer: proposal.manufacturer,
    name: proposal.name,
    partNumber: proposal.partNumber,
    barcode: proposal.barcode,
    unit: null,
    variantAttributes: proposal.variantAttributes,
  };
};

const draftCompleteness = (draft: RecognitionIdentityDraft): number =>
  (draft.name.trim() === "" ? 0 : 4) +
  (draft.manufacturer === null ? 0 : 1) +
  (draft.partNumber === null ? 0 : 2) +
  (draft.barcode === null ? 0 : 2) +
  draft.variantAttributes.length;

const preferDraft = (
  current: RecognitionIdentityDraft | null,
  proposed: RecognitionIdentityDraft | null,
): RecognitionIdentityDraft | null => {
  if (proposed === null) return current;
  if (current === null || draftCompleteness(proposed) >= draftCompleteness(current))
    return proposed;
  return current;
};

export const buildPerPhotoVlmRequests = (
  images: readonly {
    readonly ordinal: number;
    readonly bytes: Buffer;
    readonly mediaType: string;
  }[],
  photoResults: readonly CorePhotoResult[],
  candidates: readonly VlmCandidateAllowlistEntry[],
  webEvidence: VlmRequest["webEvidence"],
): readonly { readonly imageOrdinal: number; readonly request: VlmRequest }[] =>
  images.map((image) => {
    const photo = photoResults.find((result) => result.imageOrdinal === image.ordinal);
    return {
      imageOrdinal: image.ordinal,
      request: {
        images: [
          {
            ordinal: image.ordinal,
            base64: image.bytes.toString("base64"),
            mediaType: image.mediaType,
          },
        ],
        observations:
          photo?.ocrLines.map((line) => ({ imageOrdinal: image.ordinal, text: line.text })) ?? [],
        candidates,
        categories: photo?.categories.map((category) => category.label) ?? [],
        webEvidence,
      },
    };
  });

const catalogueMatchSummary = (match: CatalogueMatch): string =>
  `${match.name}${match.partNumber !== null ? ` (${match.partNumber})` : ""}`;

const catalogueMatchIdentity = (match: CatalogueMatch): CandidateIdentityInput => ({
  itemId: match.itemId,
  barcode: match.barcode,
  partNumber: match.partNumber,
  name: match.name,
});

/**
 * Saves each image's embedding and proposed crops onto its own row, keyed by
 * ordinal. `BuildExemplars` reads this back after commit rather than calling
 * recognition-core a second time for evidence this job already paid for —
 * the column is exactly as ephemeral as the image itself, gone with it at
 * the same `delete_after`.
 */
const persistImageEvidence = async (
  database: Database,
  imageRows: readonly ImageRow[],
  photoResults: readonly CorePhotoResult[],
): Promise<void> => {
  const idByOrdinal = new Map(imageRows.map((row) => [row.ordinal, row.id]));

  for (const photo of photoResults) {
    if (photo.embedding === null && photo.crops.length === 0) continue;
    const imageId = idByOrdinal.get(photo.imageOrdinal);
    if (imageId === undefined) continue;

    await database
      .withSchema(SCHEMA)
      .updateTable("stock_recognition_images")
      .set({
        ...(photo.embedding === null
          ? {}
          : {
              embedding: encodeFloat16Buffer(photo.embedding.vector),
              embedding_model: photo.embedding.modelRevision,
            }),
        crop_metadata: JSON.stringify({ crops: photo.crops, quality: photo.quality }),
      })
      .where("id", "=", imageId)
      .execute();
  }
};

/**
 * Runs every evidence stage this handler owns and returns the flat evidence
 * list `runFusion` expects. Nothing here throws for a single stage's
 * failure — each stage is wrapped so one unreachable service cannot take
 * down evidence every other stage already gathered.
 */
const gatherEvidence = async (
  database: Database,
  sessionId: string,
  configuration: RecognitionPipelineConfiguration,
  verifiedImages: readonly VerifiedImage[],
  imageRows: readonly ImageRow[],
  localCodes: readonly LocalBarcodeObservation[],
  logger: StructuredLogger,
): Promise<GatheredEvidence | null> => {
  const results: StageResult[] = [];
  const stageReports: RecognitionStageReportView[] = [];

  let photoResults: readonly CorePhotoResult[] = [];
  if (configuration.recognitionCoreUrl !== undefined && verifiedImages.length > 0) {
    const client = new RecognitionCoreClient({
      baseUrl: configuration.recognitionCoreUrl,
      timeoutMilliseconds: configuration.recognitionCoreTimeoutMilliseconds,
    });
    const inputs: readonly RecognitionCoreImageInput[] = verifiedImages.map((image) => ({
      ordinal: image.ordinal,
      bytes: image.bytes,
      mediaType: image.mediaType,
    }));
    try {
      const analysed: AnalyseSessionResult = await client.analyseSession(randomUUID(), inputs);
      photoResults = analysed.photoResults;
      const detectedBarcodes = mergeDetectedBarcodes(localCodes, photoResults);
      await database
        .withSchema(SCHEMA)
        .updateTable("stock_recognition_sessions")
        .set({ local_codes: JSON.stringify(detectedBarcodes) })
        .where("id", "=", sessionId)
        .execute();
      await persistImageEvidence(database, imageRows, photoResults);
      for (const photo of photoResults) {
        stageReports.push(
          {
            stage: "Barcode",
            outcome: photo.barcodeOutcome,
            imageOrdinal: photo.imageOrdinal,
            observations: photo.barcodes.map((barcode) => `${barcode.symbology}: ${barcode.value}`),
          },
          {
            stage: "Ocr",
            outcome: photo.ocrOutcome,
            imageOrdinal: photo.imageOrdinal,
            observations: photo.ocrLines.map((line) => line.text),
          },
          {
            stage: "VisualExample",
            outcome: photo.embeddingOutcome,
            imageOrdinal: photo.imageOrdinal,
            observations:
              photo.embedding === null
                ? []
                : [`Image embedding created by ${photo.embedding.modelRevision}`],
          },
          {
            stage: "Category",
            outcome: photo.categoryOutcome,
            imageOrdinal: photo.imageOrdinal,
            observations: photo.categories.map((category) => category.label),
          },
        );
      }
    } catch (error: unknown) {
      logger.error({
        event: "recognition.core_unavailable",
        errorName: error instanceof Error ? error.name : "Unknown",
      });
      for (const image of verifiedImages) {
        for (const stage of ["Barcode", "Ocr", "VisualExample", "Category"] as const) {
          stageReports.push({
            stage,
            outcome: "Unavailable",
            imageOrdinal: image.ordinal,
            observations: ["The recognition service could not be reached."],
          });
        }
      }
    }
  } else if (verifiedImages.length > 0) {
    for (const image of verifiedImages) {
      for (const stage of ["Barcode", "Ocr", "VisualExample", "Category"] as const) {
        stageReports.push({
          stage,
          outcome: "Unavailable",
          imageOrdinal: image.ordinal,
          observations: ["This recognition service is not configured."],
        });
      }
    }
  }

  // recognition-core (barcode, OCR, category and embedding) is the image
  // processing stage. Do not claim enrichment has started until that remote
  // call has actually finished.
  if (!(await advanceStatus(database, sessionId, "Enriching"))) return null;

  const identifiers = aggregateIdentifiers(photoResults, localCodes);
  let suggestedDraft = suggestedDraftFromEvidence(identifiers, photoResults, localCodes);

  const catalogueMatches = await queryCatalogue(database, {
    barcodeLikeCandidates: identifiers.barcodeLikeCandidates,
    partNumberCandidates: identifiers.partNumberCandidates,
    nameFragments: identifiers.nameFragments,
  }).catch((): readonly CatalogueMatch[] => []);

  catalogueMatches.forEach((match, index) => {
    const imageOrdinal = photoResults[0]?.imageOrdinal ?? 1;
    if (match.matchedBy === "Barcode") {
      results.push(barcodeStageResult(match, imageOrdinal, index + 1));
    } else {
      results.push(catalogueStageResult(match, imageOrdinal, index + 1));
    }
  });

  for (const photo of photoResults) {
    photo.categories.forEach((category, index) => {
      results.push(categoryStageResult(category.label, photo.imageOrdinal, index + 1));
    });
  }

  const embeddingModel = photoResults.find((photo) => photo.embedding !== null)?.embedding
    ?.modelRevision;
  if (embeddingModel !== undefined) {
    const index = await loadVisualIndex(database, embeddingModel).catch(() => []);
    if (index.length > 0) {
      for (const photo of photoResults) {
        if (photo.embedding === null) continue;
        const neighbours = findNearestNeighbours(
          new Float32Array(photo.embedding.vector),
          index,
          5,
        );
        neighbours.forEach((neighbour, position) => {
          results.push(visualStageResult(neighbour, photo.imageOrdinal, position + 1));
        });
      }
    }
  }

  const webOutcome = await gatherWebEvidence(
    {
      validatedGtin: identifiers.validatedGtin,
      manufacturerTokens: identifiers.manufacturerTokens,
      partNumberCandidates: identifiers.partNumberCandidates,
      nameFragments: identifiers.nameFragments,
    },
    {
      braveApiKey: configuration.braveSearchApiKey,
      fetchTimeoutMilliseconds: configuration.webFetchTimeoutMilliseconds,
    },
  ).catch(() => null);
  webOutcome?.results.forEach((result, index) => {
    results.push(webStageResult(result, index + 1));
  });

  // The VLM is part of fusion, and can be the slowest call in the pipeline.
  // Publish this boundary before making the call so polling reports where the
  // worker is really waiting rather than remaining on "Enriching".
  if (!(await advanceStatus(database, sessionId, "Fusing"))) return null;

  if (configuration.recognitionFusionUrl !== undefined && verifiedImages.length > 0) {
    const allowlist: VlmCandidateAllowlistEntry[] = catalogueMatches.slice(0, 5).map((match) => ({
      candidateId: match.itemId,
      summary: catalogueMatchSummary(match),
    }));
    const identityById = new Map<string, CandidateIdentityInput>(
      catalogueMatches.map((match) => [match.itemId, catalogueMatchIdentity(match)]),
    );

    const client = new FusionClient({
      baseUrl: configuration.recognitionFusionUrl,
      apiKey: configuration.recognitionFusionApiKey ?? "",
      timeoutMilliseconds: configuration.recognitionFusionTimeoutMilliseconds,
    });
    /* Each photograph gets an independent bounded call. Combining two normal
     * phone photos produced ~3,500 vision tokens on the 4,096-token staging
     * context, took 40 seconds, and made one invalid answer discard both
     * photographs. Per-photo calls stay small, isolate failures, and let
     * deterministic fusion reward agreement across images. */
    const requests = buildPerPhotoVlmRequests(
      verifiedImages,
      photoResults,
      allowlist,
      webOutcome?.results.map((result) => ({ title: result.title, snippet: result.snippet })) ?? [],
    );
    const outcomes = await mapWithConcurrency(
      requests,
      configuration.recognitionFusionConcurrency,
      async ({ imageOrdinal, request }) => {
        try {
          return {
            imageOrdinal,
            proposal: await client.proposeIdentity(request),
            error: null,
          };
        } catch (error: unknown) {
          return { imageOrdinal, proposal: null, error };
        }
      },
    );

    // mapWithConcurrency preserves request order, so deterministic fusion and
    // suggested-draft tie breaking do not depend on which model call finishes first.
    for (const { imageOrdinal, proposal, error } of outcomes) {
      if (proposal !== null) {
        const stageResult = vlmStageResult(proposal, identityById, imageOrdinal);
        if (stageResult !== null) results.push(stageResult);
        suggestedDraft = preferDraft(suggestedDraft, draftFromVlmProposal(proposal));
        stageReports.push({
          stage: "Vlm",
          outcome: "Succeeded",
          imageOrdinal,
          observations:
            proposal.kind === "Unknown"
              ? ["Photo analysis completed but did not identify the item."]
              : ["Photo analysis proposed an identity."],
        });
        continue;
      }

      logger.error({
        event: "recognition.fusion_unavailable",
        imageOrdinal,
        errorName: error instanceof Error ? error.name : "Unknown",
        reason: error instanceof FusionUnavailableError ? error.reason : "Unknown",
        validationFailures:
          error instanceof FusionUnavailableError
            ? error.diagnostics.map((diagnostic) => diagnostic.failure)
            : [],
        finishReasons:
          error instanceof FusionUnavailableError
            ? error.diagnostics.map((diagnostic) => diagnostic.finishReason)
            : [],
      });
      stageReports.push({
        stage: "Vlm",
        outcome: "Unavailable",
        imageOrdinal,
        observations: [
          error instanceof FusionUnavailableError && error.reason === "TimedOut"
            ? `Photo analysis took longer than ${String(
                Math.round(configuration.recognitionFusionTimeoutMilliseconds / 1_000),
              )} seconds and was stopped.`
            : "The photo-analysis service could not complete the request.",
        ],
      });
    }
  } else if (verifiedImages.length > 0) {
    for (const image of verifiedImages) {
      stageReports.push({
        stage: "Vlm",
        outcome: "Unavailable",
        imageOrdinal: image.ordinal,
        observations: ["The photo-analysis service is not configured."],
      });
    }
  }

  return { results, stageReports, suggestedDraft };
};

const candidateKind = (candidate: FusedCandidate): "InternalItem" | "ExternalDraft" =>
  candidate.identity.itemId !== null && candidate.identity.itemId !== undefined
    ? "InternalItem"
    : "ExternalDraft";

const writeResults = async (
  database: Kysely<StockControlDatabase>,
  sessionId: string,
  candidates: readonly FusedCandidate[],
  modelManifest: Record<string, unknown>,
): Promise<boolean> =>
  database.transaction().execute(async (tx) => {
    const moved = await advanceStatus(tx, sessionId, "ReviewReady");
    if (!moved) return false;

    if (candidates.length > 0) {
      await tx
        .withSchema(SCHEMA)
        .insertInto("stock_recognition_candidates")
        .values(
          candidates.map((candidate, index) => ({
            id: randomUUID(),
            session_id: sessionId,
            rank: index + 1,
            kind: candidateKind(candidate),
            item_id: candidate.identity.itemId ?? null,
            identity: JSON.stringify(candidate.identity),
            confidence_band: candidate.confidence,
            fusion_score: candidate.score,
            evidence: JSON.stringify(candidate.evidence),
            model_manifest: JSON.stringify(modelManifest),
          })),
        )
        .onConflict((conflict) => conflict.columns(["session_id", "rank"]).doNothing())
        .execute();
    }

    await tx
      .withSchema(SCHEMA)
      .updateTable("stock_recognition_sessions")
      .set({ model_manifest: JSON.stringify(modelManifest) })
      .where("id", "=", sessionId)
      .execute();

    return true;
  });

const markFailed = async (
  database: Kysely<StockControlDatabase>,
  sessionId: string,
  failureCode: string,
): Promise<void> => {
  await database
    .withSchema(SCHEMA)
    .updateTable("stock_recognition_sessions")
    .set({ status: "Failed", failure_code: failureCode, updated_at: new Date() })
    .where("id", "=", sessionId)
    .where("status", "in", PROCESSING_STATUSES)
    .execute();
};

export const createRecognitionHandler = (
  dependencies: RecognitionHandlerDependencies,
): ((job: BackgroundJobEnvelope<{ readonly sessionId: string }>) => Promise<void>) => {
  const { database, imageStorage, configuration, logger } = dependencies;

  return async (job) => {
    const { sessionId } = job.payload;

    const session = await database
      .withSchema(SCHEMA)
      .selectFrom("stock_recognition_sessions")
      .select(["id", "status", "local_codes"])
      .where("id", "=", sessionId)
      .executeTakeFirst();

    if (session === undefined) {
      logger.log({ event: "recognition.session_missing", sessionId });
      return;
    }
    // A retried job (lease lost and reclaimed mid-run — ADR 0004) can find
    // the session anywhere in PROCESSING_STATUSES, not only "Queued": it
    // resumes from here rather than refusing to touch a session it already
    // owns. Only a status this handler no longer owns — reviewable,
    // committed, cancelled, expired — is a reason to stop.
    if (!PROCESSING_STATUSES.includes(session.status)) {
      logger.log({
        event: "recognition.session_not_processing",
        sessionId,
        status: session.status,
      });
      return;
    }

    if (!(await advanceStatus(database, sessionId, "ProcessingBarcode"))) return;

    const imageRows = await database
      .withSchema(SCHEMA)
      .selectFrom("stock_recognition_images")
      .select(["id", "ordinal", "object_key", "sha256"])
      .where("session_id", "=", sessionId)
      .orderBy("ordinal")
      .execute();

    const verifiedImages = await verifyImages(database, imageStorage, imageRows, logger);
    const localCodes = readLocalCodeValues(session.local_codes);

    if (verifiedImages.length === 0 && localCodes.length === 0) {
      await markFailed(database, sessionId, "capture.recognition_unavailable");
      return;
    }

    if (!(await advanceStatus(database, sessionId, "ProcessingImages"))) return;

    const evidence = await gatherEvidence(
      database,
      sessionId,
      configuration,
      verifiedImages,
      imageRows,
      localCodes,
      logger,
    );
    if (evidence === null) return;

    const outcome = runFusion(evidence.results);
    const modelManifest = {
      fusionWeights: outcome.weightsVersion,
      stageReports: evidence.stageReports,
      suggestedDraft: evidence.suggestedDraft,
    };

    const wrote = await writeResults(database, sessionId, outcome.candidates, modelManifest);
    if (!wrote) {
      logger.log({ event: "recognition.session_moved_during_fusion", sessionId });
    }
  };
};
