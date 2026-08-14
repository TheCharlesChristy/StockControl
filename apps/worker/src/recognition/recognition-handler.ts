import { createHash, randomUUID } from "node:crypto";

import type { Kysely, Transaction } from "kysely";

import type {
  BackgroundJobEnvelope,
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
import { FusionClient, type VlmCandidateAllowlistEntry, type VlmRequest } from "./fusion-client";
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

const readLocalCodeValues = (
  localCodes: unknown,
): readonly { value: string; symbology: string }[] => {
  if (!Array.isArray(localCodes)) return [];
  const codes: { value: string; symbology: string }[] = [];
  for (const entry of localCodes) {
    if (typeof entry !== "object" || entry === null) continue;
    const { value, symbology } = entry as Record<string, unknown>;
    if (typeof value === "string" && typeof symbology === "string")
      codes.push({ value, symbology });
  }
  return codes;
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

interface AggregatedIdentifiers {
  readonly barcodeLikeCandidates: readonly string[];
  readonly partNumberCandidates: readonly string[];
  readonly nameFragments: readonly string[];
  readonly manufacturerTokens: readonly string[];
  readonly validatedGtin: string | null;
}

const aggregateIdentifiers = (
  photoResults: readonly CorePhotoResult[],
  localCodes: readonly { value: string; symbology: string }[],
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
  configuration: RecognitionPipelineConfiguration,
  verifiedImages: readonly VerifiedImage[],
  imageRows: readonly ImageRow[],
  localCodes: readonly { value: string; symbology: string }[],
  logger: StructuredLogger,
): Promise<GatheredEvidence> => {
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
      await persistImageEvidence(database, imageRows, photoResults);
      for (const photo of photoResults) {
        stageReports.push(
          {
            stage: "Barcode",
            outcome: photo.barcodeOutcome,
            imageOrdinal: photo.imageOrdinal,
            observations: photo.barcodes.map(
              (barcode) => `${barcode.symbology}: ${barcode.value}`,
            ),
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
        error,
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

  const identifiers = aggregateIdentifiers(photoResults, localCodes);

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
    const request: VlmRequest = {
      images: verifiedImages.map((image) => ({
        ordinal: image.ordinal,
        base64: image.bytes.toString("base64"),
        mediaType: image.mediaType,
      })),
      observations: photoResults.flatMap((photo) =>
        photo.ocrLines.map((line) => ({ imageOrdinal: photo.imageOrdinal, text: line.text })),
      ),
      candidates: allowlist,
      categories: [
        ...new Set(photoResults.flatMap((photo) => photo.categories.map((c) => c.label))),
      ],
      webEvidence:
        webOutcome?.results.map((result) => ({ title: result.title, snippet: result.snippet })) ??
        [],
    };

    try {
      const proposal = await client.proposeIdentity(request);
      const stageResult = vlmStageResult(proposal, identityById);
      if (stageResult !== null) results.push(stageResult);
      stageReports.push({
        stage: "Vlm",
        outcome: "Succeeded",
        imageOrdinal: null,
        observations:
          proposal.kind === "Unknown"
            ? ["Photo analysis completed but did not identify the item."]
            : ["Photo analysis proposed an identity."],
      });
    } catch (error: unknown) {
      logger.error({
        event: "recognition.fusion_unavailable",
        errorName: error instanceof Error ? error.name : "Unknown",
        error,
      });
      stageReports.push({
        stage: "Vlm",
        outcome: "Unavailable",
        imageOrdinal: null,
        observations: ["The photo-analysis service could not be reached."],
      });
    }
  } else if (verifiedImages.length > 0) {
    stageReports.push({
      stage: "Vlm",
      outcome: "Unavailable",
      imageOrdinal: null,
      observations: ["The photo-analysis service is not configured."],
    });
  }

  return { results, stageReports };
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
    if (!(await advanceStatus(database, sessionId, "Enriching"))) return;

    const evidence = await gatherEvidence(
      database,
      configuration,
      verifiedImages,
      imageRows,
      localCodes,
      logger,
    );

    if (!(await advanceStatus(database, sessionId, "Fusing"))) return;

    const outcome = runFusion(evidence.results);
    const modelManifest = {
      fusionWeights: outcome.weightsVersion,
      stageReports: evidence.stageReports,
    };

    const wrote = await writeResults(database, sessionId, outcome.candidates, modelManifest);
    if (!wrote) {
      logger.log({ event: "recognition.session_moved_during_fusion", sessionId });
    }
  };
};
