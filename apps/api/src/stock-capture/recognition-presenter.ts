import type {
  ConfidenceBand,
  RecognitionCandidateKind,
  RecognitionCandidateView,
  RecognitionEvidenceView,
  RecognitionIdentityDraft,
  RecognitionSessionStatus,
  RecognitionSessionView,
  RecognitionStage,
  RecognitionStageOutcome,
  RecognitionStageReportView,
} from "@stockcontrol/contracts";
import { recognitionStages, recognitionStageOutcomes } from "@stockcontrol/contracts";
import { analysisOutcomeFrom, isTerminal } from "@stockcontrol/module-stock-capture";
import type { STOCKCONTROL_SCHEMA, StockControlDatabase } from "@stockcontrol/platform-database";
import type { Kysely, Transaction } from "kysely";

import type { ItemDetailOptions } from "../persistence/read-models";
import { findItemDetail } from "../persistence/read-models";

const SCHEMA: typeof STOCKCONTROL_SCHEMA = "stockcontrol";

type Database = Kysely<StockControlDatabase> | Transaction<StockControlDatabase>;

/*
 * Turns the rows a session and its candidates are stored as into the shape a
 * person reviews. Nothing here decides anything — it presents what the
 * pipeline already recorded, most of it read straight through.
 */

interface CandidateRow {
  readonly id: string;
  readonly rank: number;
  readonly kind: RecognitionCandidateKind;
  readonly item_id: string | null;
  readonly identity: unknown;
  readonly confidence_band: ConfidenceBand;
  readonly evidence: unknown;
}

interface SessionRow {
  readonly id: string;
  readonly batch_id: string;
  readonly status: RecognitionSessionStatus;
  readonly photo_count: number;
  readonly local_codes: unknown;
  readonly committed_item_id: string | null;
  readonly failure_code: string | null;
  readonly model_manifest: unknown;
  readonly created_at: Date;
  readonly expires_at: Date;
}

export const identityDraftFrom = (value: unknown): RecognitionIdentityDraft => {
  const record =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const text = (field: string): string | null =>
    typeof record[field] === "string" && record[field] !== "" ? record[field] : null;

  return {
    manufacturer: text("manufacturer"),
    name: text("name") ?? "",
    partNumber: text("partNumber"),
    barcode: text("barcode"),
    unit: text("unit"),
    variantAttributes: [],
  };
};

export const evidenceFrom = (value: unknown): readonly RecognitionEvidenceView[] => {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry): readonly RecognitionEvidenceView[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const stage = record.stage;
    const summary = record.summary;
    if (typeof stage !== "string" || typeof summary !== "string") return [];

    const ordinals = Array.isArray(record.imageOrdinals)
      ? record.imageOrdinals.filter((ordinal): ordinal is number => typeof ordinal === "number")
      : [];
    const sourceUrl = typeof record.sourceUrl === "string" ? record.sourceUrl : null;

    return [
      {
        stage: stage as RecognitionStage,
        imageOrdinals: ordinals,
        summary,
        sourceUrl,
      },
    ];
  });
};

/**
 * The barcode read is the only stage this release always has evidence for, so
 * it is the only entry synthesised here. Later stages append their own
 * reports when the worker publishes them; nothing here invents evidence for a
 * stage that has not run.
 */
export const barcodeStageReports = (localCodes: unknown): readonly RecognitionStageReportView[] => {
  if (!Array.isArray(localCodes) || localCodes.length === 0) return [];

  return localCodes.flatMap((code): readonly RecognitionStageReportView[] => {
    if (typeof code !== "object" || code === null) return [];
    const record = code as Record<string, unknown>;
    const value = record.value;
    const imageOrdinal = record.imageOrdinal;
    if (typeof value !== "string" || typeof imageOrdinal !== "number") return [];

    return [
      {
        stage: "Barcode",
        outcome: "Succeeded",
        imageOrdinal,
        observations: [`Decoded ${value}`],
      },
    ];
  });
};

const isStage = (value: unknown): value is RecognitionStage =>
  (recognitionStages as readonly string[]).includes(value as string);

const isStageOutcome = (value: unknown): value is RecognitionStageOutcome =>
  (recognitionStageOutcomes as readonly string[]).includes(value as string);

/*
 * What the worker recorded about each stage, read back out of the model
 * manifest it writes when a session reaches review. Parsed defensively for
 * the ordinary reason: sessions written before this field existed have a
 * manifest without it, and those simply report nothing rather than throwing.
 */
export const workerStageReports = (manifest: unknown): readonly RecognitionStageReportView[] => {
  if (typeof manifest !== "object" || manifest === null) return [];
  const stages = (manifest as Record<string, unknown>).stages;
  if (!Array.isArray(stages)) return [];

  const isPhotographOrdinal = (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value > 0;

  return stages.flatMap((entry): readonly RecognitionStageReportView[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    if (!isStage(record.stage) || !isStageOutcome(record.outcome)) return [];

    const observations = Array.isArray(record.observations)
      ? record.observations.filter((note): note is string => typeof note === "string")
      : [];

    return [
      {
        stage: record.stage,
        outcome: record.outcome,
        /* The screen turns this into "photograph 2", so anything that is not a
         * whole positive number names no photograph and is better dropped than
         * rendered — NaN in particular is a number. */
        imageOrdinal: isPhotographOrdinal(record.imageOrdinal) ? record.imageOrdinal : null,
        observations,
      },
    ];
  });
};

const presentCandidate = async (
  database: Database,
  row: CandidateRow,
  viewer: ItemDetailOptions,
): Promise<RecognitionCandidateView> => {
  const item =
    row.item_id === null ? null : ((await findItemDetail(database, row.item_id, viewer)) ?? null);

  return {
    id: row.id,
    rank: row.rank,
    kind: row.kind,
    confidence: row.confidence_band,
    item,
    identity: identityDraftFrom(row.identity),
    /* An archived internal match is shown as evidence but cannot receive stock. */
    selectable: row.kind === "ExternalDraft" || (item?.isActive ?? false),
    evidence: evidenceFrom(row.evidence),
  };
};

export const presentRecognitionSession = async (
  database: Database,
  sessionId: string,
  viewer: ItemDetailOptions,
): Promise<RecognitionSessionView> => {
  const session = await database
    .withSchema(SCHEMA)
    .selectFrom("stock_recognition_sessions")
    .selectAll()
    .where("id", "=", sessionId)
    .executeTakeFirstOrThrow();

  const candidateRows = await database
    .withSchema(SCHEMA)
    .selectFrom("stock_recognition_candidates")
    .selectAll()
    .where("session_id", "=", sessionId)
    .orderBy("rank")
    .execute();

  const candidates = await Promise.all(
    candidateRows.map((row) =>
      presentCandidate(
        database,
        {
          id: row.id,
          rank: row.rank,
          kind: row.kind,
          item_id: row.item_id,
          identity: row.identity,
          confidence_band: row.confidence_band,
          evidence: row.evidence,
        },
        viewer,
      ),
    ),
  );

  const typedSession = session as SessionRow;
  const stageReports = workerStageReports(typedSession.model_manifest);

  return {
    id: typedSession.id,
    batchId: typedSession.batch_id,
    status: typedSession.status,
    photoCount: typedSession.photo_count,
    createdAt: typedSession.created_at.toISOString(),
    expiresAt: typedSession.expires_at.toISOString(),
    committedItemId: typedSession.committed_item_id,
    failureCode: typedSession.failure_code,
    candidates,
    /* The browser's own decodes first — they are the one stage that happened
     * before the session existed — then whatever the worker recorded. */
    stageReports: [...barcodeStageReports(typedSession.local_codes), ...stageReports],
    recommendManualEntry:
      candidates.length === 0 &&
      (isTerminal(typedSession.status) || typedSession.status === "ReviewReady"),
    analysisOutcome: analysisOutcomeFrom({
      status: typedSession.status,
      stageReports,
    }),
  };
};
