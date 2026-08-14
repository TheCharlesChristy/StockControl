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
  RecognitionCoreUnavailableError,
  type AnalyseSessionResult,
  type CorePhotoResult,
  type RecognitionCoreImageInput,
} from "./core-client";
import {
  FusionClient,
  FusionUnavailableError,
  type VlmCandidateAllowlistEntry,
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
 * Every model-backed stage degrades on its own rather than failing the job — a
 * session reaches `ReviewReady` on whatever evidence exists, even if that is
 * none at all, because "type it in" is always the fallback a person has.
 *
 * With one exception, which the 14 August staging incident is named after. A
 * stage that is `Unavailable` was never configured: Path A installations run
 * that way deliberately, retrying would only burn attempts before
 * dead-lettering, and `ReviewReady` with nothing to review is the honest
 * result. A stage that `Failed` was configured and did not answer, which is a
 * different claim entirely — and if nothing else produced a candidate either,
 * finishing the job as a success reports an outage as an empty shelf. That
 * case throws so the queue retries it with backoff, and marks the session
 * `Failed` once the attempts run out, so the person waiting is told rather
 * than left watching a progress bar that has already stopped moving.
 */

const SCHEMA: typeof STOCKCONTROL_SCHEMA = "stockcontrol";

/** The code the browser already reads on `SessionUnavailable`. */
const RECOGNITION_UNAVAILABLE = "capture.recognition_unavailable";

/**
 * Thrown when every recogniser this installation has configured refused to
 * answer and fusion consequently had nothing to rank. `code` is what
 * `failureCodeOf` in the dispatcher reads to route the job into `failJob`,
 * which applies the bounded exponential backoff from ADR 0004 — an outage
 * becomes a queue rather than a stampede.
 */
class RecognitionServicesUnavailableError extends Error {
  public readonly code = RECOGNITION_UNAVAILABLE;

  public constructor() {
    super("Every configured recognition service was unreachable.");
    this.name = "RecognitionServicesUnavailableError";
  }
}

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

/**
 * Enough of a configured URL to diagnose a wrong one, and no more. Userinfo is
 * dropped because a URL is a place credentials hide, and the path is dropped
 * because it tells a reader nothing the service name does not. A URL that will
 * not parse is itself the finding, so it is reported as such rather than
 * echoed back.
 */
const safeOrigin = (url: string | undefined): string => {
  if (url === undefined) return "unset";
  try {
    /* `host`, not `hostname` and port assembled by hand: it already carries the
     * port and keeps the brackets an IPv6 literal needs, while still excluding
     * the userinfo where a credential would hide. */
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "unparseable";
  }
};

/**
 * Whether another attempt could plausibly go differently.
 *
 * A refused connection, a timeout or a 5xx is worth retrying: the service may
 * be restarting. A 401 is a wrong API key, and it will still be a wrong API key
 * three attempts and a backoff later — retrying only delays telling somebody
 * what to fix. A response the client could not read is the same: the one
 * constrained retry has already happened inside the client.
 *
 * An error of a shape this function does not recognise is treated as transient,
 * because giving up on one unexplained look is the worse mistake.
 */
const isTransient = (error: unknown): boolean => {
  if (
    !(error instanceof RecognitionCoreUnavailableError) &&
    !(error instanceof FusionUnavailableError)
  ) {
    return true;
  }
  if (error.reason === "unreachable") return true;
  if (error.reason === "malformed") return false;
  return error.status === null || error.status >= 500 || error.status === 429;
};

/**
 * What to tell a person about a stage that did not answer. "Could not be
 * reached" is wrong for a service that answered promptly and refused, and the
 * difference decides who fixes it: a network problem is not a wrong key.
 */
const failureNote = (service: string, error: unknown): string => {
  if (
    !(error instanceof RecognitionCoreUnavailableError) &&
    !(error instanceof FusionUnavailableError)
  ) {
    return `The ${service} service could not be used.`;
  }
  if (error.reason === "unreachable") return `The ${service} service could not be reached.`;
  if (error.reason === "malformed") {
    return `The ${service} service replied with something StockControl could not read.`;
  }
  if (error.status !== null && error.status < 500 && error.status !== 429) {
    return `The ${service} service refused the request. This is a setting for your administrator to check.`;
  }
  return `The ${service} service is not answering at the moment.`;
};

/** The shape both recogniser failures log, so one query finds either. */
const serviceFailureFields = (
  error: unknown,
): {
  readonly errorName: string;
  readonly reason: string;
  readonly status: number | null;
} => {
  if (error instanceof RecognitionCoreUnavailableError || error instanceof FusionUnavailableError) {
    return { errorName: error.name, reason: error.reason, status: error.status };
  }
  return {
    errorName: error instanceof Error ? error.name : "Unknown",
    reason: "unknown",
    status: null,
  };
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
 * Runs every evidence stage this handler owns and returns both the flat
 * evidence list `runFusion` expects and a record of what each stage actually
 * did. Nothing here throws for a single stage's failure — each stage is
 * wrapped so one unreachable service cannot take down evidence every other
 * stage already gathered.
 *
 * The second half of that sentence is why the stage record matters. A stage
 * that was never configured and a stage that ran and found nothing both
 * contribute no evidence, and without this record the difference is invisible
 * from the moment the worker returns: the session reaches ReviewReady with no
 * candidates either way. Observations here stay to configuration-level facts;
 * OCR text, model output and web snippets are not put in front of a person
 * through this channel (specification section 17).
 */
const gatherEvidence = async (
  database: Database,
  configuration: RecognitionPipelineConfiguration,
  verifiedImages: readonly VerifiedImage[],
  imageRows: readonly ImageRow[],
  localCodes: readonly { value: string; symbology: string }[],
  logger: StructuredLogger,
  /* Which attempt these failures belong to, so a log line reads as "the second
   * try also could not reach it" rather than as an unrelated event. */
  attempt: number,
): Promise<{
  readonly results: readonly StageResult[];
  readonly stageReports: readonly RecognitionStageReportView[];
  /* True when at least one stage that failed might answer next time. It rides
   * out with the reports because only this function sees the errors. */
  readonly transientFailure: boolean;
}> => {
  const results: StageResult[] = [];
  const stageReports: RecognitionStageReportView[] = [];
  let transientFailure = false;
  const report = (
    stage: RecognitionStageReportView["stage"],
    outcome: RecognitionStageReportView["outcome"],
    note: string,
  ): void => {
    stageReports.push({ stage, outcome, imageOrdinal: null, observations: [note] });
  };

  let photoResults: readonly CorePhotoResult[] = [];
  if (configuration.recognitionCoreUrl === undefined) {
    report("Ocr", "Unavailable", "Text recognition is not set up on this installation.");
    report("Category", "Unavailable", "Product categories are not set up on this installation.");
  } else if (verifiedImages.length === 0) {
    report("Ocr", "NotApplicable", "There were no photographs to read.");
    report("Category", "NotApplicable", "There were no photographs to categorise.");
  } else {
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
      const readText = photoResults.some((photo) => photo.ocrLines.length > 0);
      report(
        "Ocr",
        "Succeeded",
        readText ? "Read text from the photographs." : "Found no readable text.",
      );
      const categorised = photoResults.some((photo) => photo.categories.length > 0);
      report(
        "Category",
        "Succeeded",
        categorised ? "Suggested a product category." : "Matched no product category.",
      );
    } catch (error: unknown) {
      logger.error({
        event: "recognition.core_unavailable",
        targetService: "recognition-core",
        targetOrigin: safeOrigin(configuration.recognitionCoreUrl),
        requestPath: "/v1/analyse-session",
        timeoutMilliseconds: configuration.recognitionCoreTimeoutMilliseconds,
        attempt,
        ...serviceFailureFields(error),
      });
      transientFailure ||= isTransient(error);
      const note = failureNote("text recognition", error);
      report("Ocr", "Failed", note);
      report("Category", "Failed", note);
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
  /*
   * "Not set up" is a claim about this installation, and it is only true when
   * the photographs were examined and came back without an embedding. With no
   * photographs, or with none examined because the stage above failed, the
   * absence says nothing about configuration — and the real reason is already
   * recorded on that stage, so repeating it here would count one fault twice.
   */
  if (verifiedImages.length === 0) {
    report("VisualExample", "NotApplicable", "There were no photographs to compare.");
  } else if (photoResults.length === 0) {
    report(
      "VisualExample",
      "NotApplicable",
      "The photographs were not examined, so there was nothing to compare.",
    );
  } else if (embeddingModel === undefined) {
    report(
      "VisualExample",
      "Unavailable",
      "Comparing photographs to confirmed items is not set up on this installation.",
    );
  } else {
    const index = await loadVisualIndex(database, embeddingModel).catch(() => []);
    if (index.length === 0) {
      /* Not a fault: the index is built from items people have confirmed, so
       * an installation early in its life legitimately has nothing to compare
       * against yet. */
      report(
        "VisualExample",
        "NotApplicable",
        "No confirmed items have been photographed yet to compare against.",
      );
    } else {
      let matched = 0;
      for (const photo of photoResults) {
        if (photo.embedding === null) continue;
        const neighbours = findNearestNeighbours(
          new Float32Array(photo.embedding.vector),
          index,
          5,
        );
        matched += neighbours.length;
        neighbours.forEach((neighbour, position) => {
          results.push(visualStageResult(neighbour, photo.imageOrdinal, position + 1));
        });
      }
      report(
        "VisualExample",
        "Succeeded",
        matched > 0
          ? "Compared the photographs with confirmed items."
          : "Found nothing that looks like a confirmed item.",
      );
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

  if (configuration.braveSearchApiKey === undefined) {
    report(
      "Web",
      "Unavailable",
      "Looking up manufacturer pages is not set up on this installation.",
    );
  } else if (webOutcome === null) {
    report("Web", "Failed", "The manufacturer page search could not be reached.");
  } else if (webOutcome.outcome === "NotApplicable") {
    /* `gatherWebEvidence` decides this, not the caller: with no manufacturer,
     * part number or name to go on it builds no query at all, and reporting
     * that as a search that found nothing would read as a fact about the item
     * rather than about the evidence. */
    report(
      "Web",
      "NotApplicable",
      "There was too little on the label to search for a manufacturer page.",
    );
  } else if (webOutcome.outcome === "Unavailable") {
    report(
      "Web",
      "Unavailable",
      "Looking up manufacturer pages is not set up on this installation.",
    );
  } else {
    report(
      "Web",
      "Succeeded",
      webOutcome.results.length > 0
        ? "Checked manufacturer pages."
        : "Found no manufacturer page for this item.",
    );
  }

  if (configuration.recognitionFusionUrl === undefined) {
    report("Vlm", "Unavailable", "Photo analysis is not set up on this installation.");
  } else if (verifiedImages.length === 0) {
    report("Vlm", "NotApplicable", "There were no photographs to analyse.");
  }

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
      report(
        "Vlm",
        "Succeeded",
        stageResult === null
          ? "Analysed the photographs without reaching a proposal."
          : "Analysed the photographs.",
      );
    } catch (error: unknown) {
      logger.error({
        event: "recognition.fusion_unavailable",
        targetService: "recognition-fusion",
        targetOrigin: safeOrigin(configuration.recognitionFusionUrl),
        requestPath: "/v1/chat/completions",
        timeoutMilliseconds: configuration.recognitionFusionTimeoutMilliseconds,
        attempt,
        ...serviceFailureFields(error),
      });
      transientFailure ||= isTransient(error);
      report("Vlm", "Failed", failureNote("photo analysis", error));
    }
  }

  return { results, stageReports, transientFailure };
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

/**
 * The stages that were set up and did not answer. `Unavailable` is deliberately
 * not one of them: it means nobody configured that stage, which is a decision
 * rather than a fault, and retrying a decision never changes it.
 */
const failedStagesOf = (reports: readonly RecognitionStageReportView[]): readonly string[] => [
  ...new Set(reports.filter((report) => report.outcome === "Failed").map((report) => report.stage)),
];

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
      job.attempt,
    );

    if (!(await advanceStatus(database, sessionId, "Fusing"))) return;

    const outcome = runFusion(evidence.results);
    /*
     * The stage record rides along with the manifest because it answers the
     * same question — what this installation was actually able to run — and
     * the API already reads the manifest back for the session view. A session
     * that produced no candidates is unreadable without it.
     */
    const modelManifest = {
      fusionWeights: outcome.weightsVersion,
      stages: evidence.stageReports,
    };

    /*
     * Nothing to show and a configured recogniser that did not answer: the
     * empty result is the outage, not a finding about the item. Writing
     * ReviewReady here is what let the staging incident be reported as a
     * completed job with no candidates.
     */
    const failedStages = failedStagesOf(evidence.stageReports);
    if (outcome.candidates.length === 0 && failedStages.length > 0) {
      const lastAttempt = job.attempt >= job.maxAttempts;
      /*
       * A session is told it failed once nothing further can change that: when
       * the queue has spent its attempts, or immediately when the failure was
       * never going to answer differently. Holding the news back while a retry
       * is genuinely pending is what keeps the progress bar honest; holding it
       * back through three attempts against a refused API key is just a longer
       * wait for the same answer.
       */
      const settled = lastAttempt || !evidence.transientFailure;
      logger.error({
        event: "recognition.services_unavailable",
        sessionId,
        attempt: job.attempt,
        maxAttempts: job.maxAttempts,
        failedStages,
        transient: evidence.transientFailure,
        lastAttempt,
      });

      if (settled) await markFailed(database, sessionId, RECOGNITION_UNAVAILABLE);

      /*
       * Thrown either way, so the queue records a failure rather than a
       * success. A non-transient failure is still retried by the dispatcher,
       * but the session is already terminal by then, so the next attempt stops
       * at the status guard above without calling anything.
       */
      throw new RecognitionServicesUnavailableError();
    }

    const wrote = await writeResults(database, sessionId, outcome.candidates, modelManifest);
    if (!wrote) {
      logger.log({ event: "recognition.session_moved_during_fusion", sessionId });
    }
  };
};
