import type {
  CommitCaptureEntryResponse,
  LocalBarcodeObservation,
  RecognitionCandidateView,
  RecognitionSessionSummaryView,
  RecognitionSessionView,
  StockCaptureBatchView,
} from "@stockcontrol/contracts";

/*
 * Explicit recoverable states, not boolean loading flags. Every screen the
 * page can show is a distinct `kind`, so "what is on screen" and "what the
 * server says" can never quietly drift apart the way `loading`/`error`/
 * `data` flags can when two of them are true at once.
 *
 * Image bytes, decoded frames and presigned URLs never belong in this state:
 * `CapturedPhoto.file` is a `File` held for the lifetime of one capture only,
 * and nothing here is what gets persisted to browser storage — the page
 * decides that separately, keeping only IDs and the manual-entry draft.
 */

export interface CapturedPhoto {
  readonly ordinal: number;
  readonly file: File;
  readonly previewUrl: string;
  /** What the camera or picker produced. The media type that is actually
   *  uploaded is decided by `normaliseImage`, which re-encodes every file. */
  readonly sourceType: string;
  readonly localCodes: readonly LocalBarcodeObservation[];
}

export type ReceiptSelection =
  | {
      readonly kind: "ExistingItem";
      readonly itemId: string;
      readonly candidateId: string | null;
      readonly label: string;
      /* Carried for the confirmation screen, which section 5.2 step 12 says
       * must show the item and its unit — not the commit, which sends an id. */
      readonly reference: string;
      readonly unit: string;
      readonly onHand: string;
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

export interface ReceiptDraft {
  readonly quantity: string;
  readonly locationId: string;
  readonly acknowledgedDuplicatePartNumber: boolean;
}

export type CaptureStage =
  | { readonly kind: "StartingBatch" }
  | { readonly kind: "BatchFailed"; readonly message: string }
  | { readonly kind: "BatchOverview"; readonly batch: StockCaptureBatchView }
  /*
   * A closed batch is not a batch overview. Leaving it on that screen left
   * "Add another item" pointing at a batch the server would refuse, which is
   * a dead end reachable by pressing the only other button on the page.
   */
  | { readonly kind: "BatchCompleted"; readonly batch: StockCaptureBatchView }
  | {
      readonly kind: "CapturingPhotos";
      readonly batch: StockCaptureBatchView;
      readonly photos: readonly CapturedPhoto[];
      readonly submitting: boolean;
      readonly error: string | null;
    }
  | {
      readonly kind: "Uploading";
      readonly batch: StockCaptureBatchView;
      readonly session: RecognitionSessionSummaryView;
      readonly uploadedCount: number;
      readonly totalCount: number;
    }
  | {
      readonly kind: "AwaitingRecognition";
      readonly batch: StockCaptureBatchView;
      readonly session: RecognitionSessionSummaryView;
      /** Consecutive failed status checks. A dropped connection used to leave
       *  the progress bar turning with nothing behind it. */
      readonly checkFailures: number;
    }
  | {
      readonly kind: "ReviewingCandidates";
      readonly batch: StockCaptureBatchView;
      readonly session: RecognitionSessionView;
      readonly showDetails: boolean;
    }
  | {
      readonly kind: "EnteringReceipt";
      readonly batch: StockCaptureBatchView;
      readonly session: RecognitionSessionView;
      readonly selection: ReceiptSelection;
      readonly draft: ReceiptDraft;
      readonly submitting: boolean;
      readonly error: string | null;
      /** Set when the server refused a new item over an active duplicate part number. */
      readonly duplicatePartNumberConflict: boolean;
    }
  | {
      readonly kind: "Committed";
      readonly batch: StockCaptureBatchView;
      readonly result: CommitCaptureEntryResponse;
      /** Where the person said it went, so the success screen can name it
       *  rather than guessing from the item's balances. */
      readonly locationId: string;
    }
  | {
      readonly kind: "SessionUnavailable";
      readonly batch: StockCaptureBatchView;
      readonly session: RecognitionSessionSummaryView;
    };

/** The item this visit added, kept so the batch can list what is in it. */
export interface AddedEntry {
  readonly itemId: string;
  readonly reference: string;
  readonly name: string;
  readonly quantity: string;
  readonly unit: string;
}

export type CaptureAction =
  | { readonly type: "BatchStartFailed"; readonly message: string }
  | { readonly type: "BatchReady"; readonly batch: StockCaptureBatchView }
  | { readonly type: "BatchClosed"; readonly batch: StockCaptureBatchView }
  | { readonly type: "StartNewItem"; readonly batch: StockCaptureBatchView }
  | {
      readonly type: "SessionResumed";
      readonly batch: StockCaptureBatchView;
      readonly session: RecognitionSessionView;
    }
  | { readonly type: "PhotoAdded"; readonly photo: CapturedPhoto }
  | { readonly type: "PhotoRemoved"; readonly ordinal: number }
  | { readonly type: "SessionSubmitting" }
  | { readonly type: "SessionSubmitFailed"; readonly message: string }
  | {
      readonly type: "SessionStarted";
      readonly session: RecognitionSessionSummaryView;
      readonly totalCount: number;
    }
  | { readonly type: "UploadProgressed"; readonly uploadedCount: number }
  | { readonly type: "UploadsCompleted"; readonly session: RecognitionSessionSummaryView }
  /** The barcode short cut: the session was already past `AwaitingUpload`, so
   *  there was nothing to send and the session in hand is still the right one. */
  | { readonly type: "UploadsSkipped" }
  | {
      readonly type: "UploadFailed";
      readonly photos: readonly CapturedPhoto[];
      readonly message: string;
    }
  | { readonly type: "SessionPolled"; readonly session: RecognitionSessionView }
  | { readonly type: "SessionCheckFailed" }
  | { readonly type: "ToggleAnalysisDetails" }
  /** `locationId` seeds the receipt from the batch default the person chose,
   *  so a delivery into one store is not re-picked for every item in it. */
  | {
      readonly type: "CandidateSelected";
      readonly selection: ReceiptSelection;
      readonly locationId: string;
    }
  | { readonly type: "ManualEntryStarted"; readonly locationId: string }
  | { readonly type: "SelectionChanged"; readonly selection: ReceiptSelection }
  | { readonly type: "ReceiptDraftChanged"; readonly draft: Partial<ReceiptDraft> }
  | { readonly type: "ReceiptBackToCandidates" }
  | { readonly type: "CommitSubmitting" }
  | {
      readonly type: "CommitFailed";
      readonly message: string;
      readonly duplicatePartNumberConflict: boolean;
    }
  | { readonly type: "CommitSucceeded"; readonly result: CommitCaptureEntryResponse }
  | { readonly type: "SessionCancelled"; readonly batch: StockCaptureBatchView }
  | { readonly type: "ReturnToBatch"; readonly batch: StockCaptureBatchView };

export const initialCaptureStage: CaptureStage = { kind: "StartingBatch" };

const isCommitted = (session: RecognitionSessionSummaryView): boolean =>
  session.status === "Committed";

const EMPTY_DRAFT: ReceiptDraft = {
  quantity: "",
  locationId: "",
  acknowledgedDuplicatePartNumber: false,
};

/** The best candidate to preselect: rank 1, if the session published one. */
export const topCandidateSelection = (
  candidates: readonly RecognitionCandidateView[],
): ReceiptSelection | null => {
  const top = candidates.find((candidate) => candidate.rank === 1);
  if (top === undefined || !top.selectable) return null;

  if (top.kind === "InternalItem" && top.item !== null) {
    return {
      kind: "ExistingItem",
      itemId: top.item.id,
      candidateId: top.id,
      label: top.item.name,
      reference: top.item.reference,
      unit: top.item.unit,
      onHand: top.item.onHand,
    };
  }

  if (top.kind === "ExternalDraft") {
    return {
      kind: "NewItem",
      candidateId: top.id,
      reference: null,
      name: top.identity.name,
      unit: top.identity.unit ?? "",
      barcode: top.identity.barcode,
      partNumber: top.identity.partNumber,
    };
  }

  return null;
};

export function captureReducer(stage: CaptureStage, action: CaptureAction): CaptureStage {
  switch (action.type) {
    case "BatchStartFailed":
      return { kind: "BatchFailed", message: action.message };

    case "BatchReady":
      return { kind: "BatchOverview", batch: action.batch };

    case "BatchClosed":
      return { kind: "BatchCompleted", batch: action.batch };

    case "StartNewItem":
      return {
        kind: "CapturingPhotos",
        batch: action.batch,
        photos: [],
        submitting: false,
        error: null,
      };

    case "SessionResumed": {
      if (stage.kind !== "BatchOverview") return stage;
      const { session } = action;

      if (session.status === "ReviewReady") {
        return { kind: "ReviewingCandidates", batch: action.batch, session, showDetails: false };
      }

      /*
       * `Committed` used to land on the review screen, which invited a second
       * confirmation for stock that had already been received — the server
       * refuses it, but only after the person has filled the form in again.
       */
      if (session.status === "Failed" || session.status === "Expired" || isCommitted(session)) {
        return { kind: "SessionUnavailable", batch: action.batch, session };
      }

      return { kind: "AwaitingRecognition", batch: action.batch, session, checkFailures: 0 };
    }

    case "PhotoAdded": {
      if (stage.kind !== "CapturingPhotos") return stage;
      return { ...stage, photos: [...stage.photos, action.photo], error: null };
    }

    case "PhotoRemoved": {
      if (stage.kind !== "CapturingPhotos") return stage;
      return {
        ...stage,
        photos: stage.photos.filter((photo) => photo.ordinal !== action.ordinal),
      };
    }

    case "SessionSubmitting": {
      if (stage.kind !== "CapturingPhotos") return stage;
      return { ...stage, submitting: true, error: null };
    }

    case "SessionSubmitFailed": {
      if (stage.kind !== "CapturingPhotos") return stage;
      return { ...stage, submitting: false, error: action.message };
    }

    case "SessionStarted": {
      if (stage.kind !== "CapturingPhotos") return stage;
      return {
        kind: "Uploading",
        batch: stage.batch,
        session: action.session,
        uploadedCount: 0,
        totalCount: action.totalCount,
      };
    }

    case "UploadProgressed": {
      if (stage.kind !== "Uploading") return stage;
      return { ...stage, uploadedCount: action.uploadedCount };
    }

    case "UploadsCompleted": {
      if (stage.kind !== "Uploading") return stage;
      return {
        kind: "AwaitingRecognition",
        batch: stage.batch,
        session: action.session,
        checkFailures: 0,
      };
    }

    case "UploadsSkipped": {
      if (stage.kind !== "Uploading") return stage;
      return {
        kind: "AwaitingRecognition",
        batch: stage.batch,
        session: stage.session,
        checkFailures: 0,
      };
    }

    case "UploadFailed": {
      if (stage.kind !== "Uploading") return stage;
      /* The batch comes from the stage this case has already narrowed, not
       * from the action: an effect that had to carry it would need `stage` in
       * its dependencies, which is exactly what used to restart it mid-upload. */
      return {
        kind: "CapturingPhotos",
        batch: stage.batch,
        photos: action.photos,
        submitting: false,
        error: action.message,
      };
    }

    case "SessionPolled": {
      if (stage.kind !== "AwaitingRecognition" && stage.kind !== "ReviewingCandidates") {
        return stage;
      }

      const { session } = action;

      if (session.status === "ReviewReady") {
        return {
          kind: "ReviewingCandidates",
          batch: stage.batch,
          session,
          showDetails: stage.kind === "ReviewingCandidates" ? stage.showDetails : false,
        };
      }

      if (session.status === "Failed" || session.status === "Expired" || isCommitted(session)) {
        return { kind: "SessionUnavailable", batch: stage.batch, session };
      }

      return { kind: "AwaitingRecognition", batch: stage.batch, session, checkFailures: 0 };
    }

    case "SessionCheckFailed": {
      if (stage.kind !== "AwaitingRecognition") return stage;
      return { ...stage, checkFailures: stage.checkFailures + 1 };
    }

    case "ToggleAnalysisDetails": {
      if (stage.kind !== "ReviewingCandidates") return stage;
      return { ...stage, showDetails: !stage.showDetails };
    }

    case "CandidateSelected": {
      if (stage.kind !== "ReviewingCandidates") return stage;
      return {
        kind: "EnteringReceipt",
        batch: stage.batch,
        session: stage.session,
        selection: action.selection,
        draft: { ...EMPTY_DRAFT, locationId: action.locationId },
        submitting: false,
        error: null,
        duplicatePartNumberConflict: false,
      };
    }

    case "ManualEntryStarted": {
      if (stage.kind !== "ReviewingCandidates") return stage;
      return {
        kind: "EnteringReceipt",
        batch: stage.batch,
        session: stage.session,
        selection: {
          kind: "NewItem",
          candidateId: null,
          reference: null,
          name: "",
          unit: "",
          barcode: null,
          partNumber: null,
        },
        draft: { ...EMPTY_DRAFT, locationId: action.locationId },
        submitting: false,
        error: null,
        duplicatePartNumberConflict: false,
      };
    }

    case "SelectionChanged": {
      if (stage.kind !== "EnteringReceipt") return stage;
      return {
        ...stage,
        selection: action.selection,
        error: null,
        duplicatePartNumberConflict: false,
      };
    }

    case "ReceiptDraftChanged": {
      if (stage.kind !== "EnteringReceipt") return stage;
      return { ...stage, draft: { ...stage.draft, ...action.draft }, error: null };
    }

    case "ReceiptBackToCandidates": {
      if (stage.kind !== "EnteringReceipt") return stage;
      return {
        kind: "ReviewingCandidates",
        batch: stage.batch,
        session: stage.session,
        showDetails: false,
      };
    }

    case "CommitSubmitting": {
      if (stage.kind !== "EnteringReceipt") return stage;
      return { ...stage, submitting: true, error: null };
    }

    case "CommitFailed": {
      if (stage.kind !== "EnteringReceipt") return stage;
      return {
        ...stage,
        submitting: false,
        error: action.message,
        duplicatePartNumberConflict: action.duplicatePartNumberConflict,
      };
    }

    case "CommitSucceeded": {
      const locationId = stage.kind === "EnteringReceipt" ? stage.draft.locationId : "";
      return { kind: "Committed", batch: action.result.batch, result: action.result, locationId };
    }

    case "SessionCancelled":
      return { kind: "BatchOverview", batch: action.batch };

    case "ReturnToBatch":
      return { kind: "BatchOverview", batch: action.batch };

    default:
      return stage;
  }
}
