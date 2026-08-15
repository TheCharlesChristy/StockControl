import type { ItemDetailView } from "./inventory";

/*
 * Assisted stock capture, from docs/stock-capture-technical-spec.md. Everything
 * here is transport shape only: the pipeline proposes an identity and a person
 * confirms it, so nothing in this file may be treated as authority to change
 * stock. The API re-derives every business decision server-side.
 */

export const stockCaptureBatchStatuses = ["Open", "Completed", "Cancelled"] as const;
export type StockCaptureBatchStatus = (typeof stockCaptureBatchStatuses)[number];

/**
 * Spec section 7.1. `AwaitingUpload` covers a session that has been created but
 * whose photographs have not been declared complete. Barcode evidence never
 * skips the photographs: it is one input to the complete recognition pipeline.
 */
export const recognitionSessionStatuses = [
  "AwaitingUpload",
  "Queued",
  "ProcessingBarcode",
  "ProcessingImages",
  "Enriching",
  "Fusing",
  "ReviewReady",
  "Committed",
  "Failed",
  "Cancelled",
  "Expired",
] as const;
export type RecognitionSessionStatus = (typeof recognitionSessionStatuses)[number];

/**
 * Shown as words, never as a percentage. A percentage invites the reader to do
 * arithmetic the underlying scores do not support: they come from unrelated
 * scales that are never averaged directly.
 */
export const confidenceBands = ["Strong", "Possible", "Weak"] as const;
export type ConfidenceBand = (typeof confidenceBands)[number];

export const recognitionCandidateKinds = ["InternalItem", "ExternalDraft"] as const;
export type RecognitionCandidateKind = (typeof recognitionCandidateKinds)[number];

/** The stages a session can run. `Vlm` is the one item-level model call. */
export const recognitionStages = [
  "Barcode",
  "Ocr",
  "VisualExample",
  "Category",
  "Web",
  "Vlm",
] as const;
export type RecognitionStage = (typeof recognitionStages)[number];

export const recognitionStageOutcomes = [
  "Succeeded",
  "NotApplicable",
  "Unavailable",
  "Failed",
] as const;
export type RecognitionStageOutcome = (typeof recognitionStageOutcomes)[number];

export const captureImageMediaTypes = ["image/jpeg", "image/webp"] as const;
export type CaptureImageMediaType = (typeof captureImageMediaTypes)[number];

/*
 * Limits are part of the contract because the browser enforces them for a
 * decent error message and the server enforces them because the browser is not
 * trusted. Both read them from here so they cannot drift apart.
 */
export const CAPTURE_MAX_PHOTOS = 5;
export const CAPTURE_MAX_SOURCE_BYTES = 12 * 1024 * 1024;
export const CAPTURE_MAX_SESSION_BYTES = 30 * 1024 * 1024;
export const CAPTURE_MAX_SOURCE_PIXELS = 40_000_000;
export const CAPTURE_MAX_LONG_EDGE = 2_048;
export const CAPTURE_MAX_CANDIDATES = 5;

/** Stable failure codes. Section 10 of the specification. */
export const stockCaptureFailureCodes = [
  "capture.batch_not_open",
  "capture.session_not_ready",
  "capture.session_expired",
  "capture.upload_invalid",
  "capture.recognition_unavailable",
  "capture.idempotency_conflict",
  "capture.ambiguous_identifier",
  "capture.item_changed",
  "capture.location_unavailable",
  "capture.disabled",
] as const;
export type StockCaptureFailureCode = (typeof stockCaptureFailureCodes)[number];

/**
 * A barcode the browser decoded. Deliberately carries no confidence and no item
 * id: a client that could nominate the matched item could receive stock against
 * any item it named.
 */
export interface LocalBarcodeObservation {
  readonly value: string;
  readonly symbology: string;
  readonly imageOrdinal: number;
  readonly readerVersion: string;
}

export interface StartCaptureBatchRequest {
  readonly clientBatchId: string;
  readonly defaultLocationId: string | null;
}

export interface StockCaptureBatchView {
  readonly id: string;
  readonly status: StockCaptureBatchStatus;
  readonly defaultLocationId: string | null;
  readonly createdAt: string;
  readonly closedAt: string | null;
  readonly sessions: readonly RecognitionSessionSummaryView[];
  readonly committedEntryCount: number;
}

export interface StartRecognitionSessionRequest {
  readonly clientSessionId: string;
  readonly batchId: string;
  readonly photoCount: number;
  readonly localCodes: readonly LocalBarcodeObservation[];
}

export interface RecognitionSessionSummaryView {
  readonly id: string;
  readonly status: RecognitionSessionStatus;
  readonly photoCount: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly committedItemId: string | null;
  readonly failureCode: string | null;
}

/** One row per photograph the browser must upload. */
export interface CaptureUploadGrant {
  readonly imageId: string;
  readonly ordinal: number;
  /** A same-origin API route that accepts the declared image bytes. */
  readonly url: string;
  readonly mediaType: CaptureImageMediaType;
  /** The recognition session expiry; uploads are rejected after this point. */
  readonly expiresAt: string;
}

export interface RequestCaptureUploadsRequest {
  readonly images: readonly {
    readonly ordinal: number;
    readonly mediaType: CaptureImageMediaType;
    readonly byteLength: number;
    readonly sha256: string;
    readonly width: number;
    readonly height: number;
  }[];
}

export interface CaptureUploadGrantResponse {
  readonly session: RecognitionSessionSummaryView;
  readonly grants: readonly CaptureUploadGrant[];
}

export interface CompleteCaptureUploadsRequest {
  readonly uploadedImageIds: readonly string[];
}

/** Where a candidate's evidence came from, in words a stockroom would use. */
export interface RecognitionEvidenceView {
  readonly stage: RecognitionStage;
  readonly imageOrdinals: readonly number[];
  readonly summary: string;
  readonly sourceUrl: string | null;
}

/**
 * The editable product fields behind an `ExternalDraft`. They populate the
 * ordinary new-item form; none of them is trusted until the person saves it.
 */
export interface RecognitionIdentityDraft {
  readonly manufacturer: string | null;
  readonly name: string;
  readonly partNumber: string | null;
  readonly barcode: string | null;
  readonly unit: string | null;
  readonly variantAttributes: readonly { readonly label: string; readonly value: string }[];
}

export interface RecognitionCandidateView {
  readonly id: string;
  readonly rank: number;
  readonly kind: RecognitionCandidateKind;
  readonly confidence: ConfidenceBand;
  /** Present for `InternalItem`. An archived match is shown but not selectable. */
  readonly item: ItemDetailView | null;
  readonly identity: RecognitionIdentityDraft;
  readonly selectable: boolean;
  readonly evidence: readonly RecognitionEvidenceView[];
}

export interface RecognitionStageReportView {
  readonly stage: RecognitionStage;
  readonly outcome: RecognitionStageOutcome;
  readonly imageOrdinal: number | null;
  readonly observations: readonly string[];
}

/** A retained capture photograph, served only through the authenticated API. */
export interface RecognitionPhotoView {
  readonly id: string;
  readonly ordinal: number;
  readonly url: string;
  readonly mediaType: CaptureImageMediaType;
}

/** A decoded value retained for review even when it matched no catalogue item. */
export interface DetectedBarcodeView {
  readonly value: string;
  readonly symbology: string;
  readonly imageOrdinal: number;
}

export interface RecognitionSessionView extends RecognitionSessionSummaryView {
  readonly batchId: string;
  readonly photos: readonly RecognitionPhotoView[];
  readonly detectedBarcodes: readonly DetectedBarcodeView[];
  readonly candidates: readonly RecognitionCandidateView[];
  /** Best editable product details recovered even when no catalogue candidate exists. */
  readonly suggestedDraft: RecognitionIdentityDraft | null;
  /** The "Analysis details" disclosure: every stage, for every photograph. */
  readonly stageReports: readonly RecognitionStageReportView[];
  /** True when every stage failed and the person should just type the item in. */
  readonly recommendManualEntry: boolean;
}

export interface StockCaptureSessionResponse {
  readonly session: RecognitionSessionView;
}

export interface StockCaptureBatchResponse {
  readonly batch: StockCaptureBatchView;
}

/**
 * The human-confirmed command. `selection` names what the person chose;
 * quantity and location are theirs alone and are never proposed by a model.
 */
export interface CommitCaptureEntryRequest {
  readonly clientEntryId: string;
  readonly sessionId: string;
  readonly selection:
    | {
        readonly kind: "ExistingItem";
        readonly itemId: string;
        readonly candidateId: string | null;
      }
    | {
        readonly kind: "NewItem";
        readonly candidateId: string | null;
        readonly reference: string | null;
        readonly name: string;
        readonly unit: string;
        readonly barcode: string | null;
        readonly partNumber: string | null;
      };
  readonly quantity: string;
  readonly locationId: string;
  /** Set once the person has seen and accepted the duplicate part-number warning. */
  readonly acknowledgedDuplicatePartNumber: boolean;
}

export interface CommitCaptureEntryResponse {
  readonly item: ItemDetailView;
  readonly transactionId: string;
  readonly createdItem: boolean;
  readonly batch: StockCaptureBatchView;
}

/** What the person did with the suggestions. Never carries model or OCR text. */
export const recognitionFeedbackOutcomes = ["Accepted", "Edited", "RejectedAll"] as const;
export type RecognitionFeedbackOutcome = (typeof recognitionFeedbackOutcomes)[number];
