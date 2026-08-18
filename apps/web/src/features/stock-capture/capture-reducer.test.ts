import { describe, expect, it } from "vitest";

import type {
  CommitCaptureEntryResponse,
  ItemDetailView,
  RecognitionCandidateView,
  RecognitionSessionSummaryView,
  RecognitionSessionView,
  StockCaptureBatchView,
} from "@stockcontrol/contracts";

import type { CapturedPhoto } from "../scan/photo-tray";
import {
  captureReducer,
  initialCaptureStage,
  topCandidateSelection,
  type CaptureStage,
} from "./capture-reducer";

const batch = (over: Partial<StockCaptureBatchView> = {}): StockCaptureBatchView => ({
  id: "batch-1",
  status: "Open",
  defaultLocationId: null,
  createdAt: "2026-08-10T09:00:00.000Z",
  closedAt: null,
  sessions: [],
  committedEntryCount: 0,
  ...over,
});

const sessionSummary = (
  over: Partial<RecognitionSessionSummaryView> = {},
): RecognitionSessionSummaryView => ({
  id: "session-1",
  status: "Queued",
  photoCount: 1,
  createdAt: "2026-08-10T09:00:00.000Z",
  expiresAt: "2026-08-10T15:00:00.000Z",
  committedItemId: null,
  failureCode: null,
  ...over,
});

const sessionView = (over: Partial<RecognitionSessionView> = {}): RecognitionSessionView => ({
  ...sessionSummary(),
  batchId: "batch-1",
  photos: [],
  detectedBarcodes: [],
  candidates: [],
  suggestedDraft: null,
  stageReports: [],
  recommendManualEntry: false,
  ...over,
});

const item = (over: Partial<ItemDetailView> = {}): ItemDetailView => ({
  id: "item-1",
  reference: "ITM-0001",
  name: "Widget",
  unit: "ea",
  barcode: null,
  partNumber: null,
  lowStockThreshold: null,
  isActive: true,
  onHand: "0",
  inStores: "0",
  atJobSites: "0",
  reserved: "0",
  reservedForYou: "0",
  available: "0",
  belowThreshold: false,
  coverPhotoUrl: null,
  balances: [],
  recentTransactions: [],
  photos: [],
  ...over,
});

const internalCandidate = (
  over: Partial<RecognitionCandidateView> = {},
): RecognitionCandidateView => ({
  id: "candidate-1",
  rank: 1,
  kind: "InternalItem",
  confidence: "Strong",
  item: item(),
  identity: {
    manufacturer: null,
    name: "Widget",
    partNumber: null,
    barcode: null,
    unit: "ea",
    variantAttributes: [],
  },
  selectable: true,
  evidence: [],
  ...over,
});

const photo = (ordinal: number): CapturedPhoto => ({
  ordinal,
  file: new File(["fake"], `photo-${String(ordinal)}.jpg`, { type: "image/jpeg" }),
  previewUrl: `blob:photo-${String(ordinal)}`,
  sourceType: "image/jpeg",
  localCodes: [],
});

describe("captureReducer", () => {
  it("starts in StartingBatch", () => {
    expect(initialCaptureStage).toEqual({ kind: "StartingBatch" });
  });

  it("moves to BatchFailed when opening the batch fails", () => {
    const next = captureReducer(initialCaptureStage, {
      type: "BatchStartFailed",
      message: "Could not open a capture batch.",
    });
    expect(next).toEqual({ kind: "BatchFailed", message: "Could not open a capture batch." });
  });

  it("moves to BatchOverview once the batch is ready", () => {
    const next = captureReducer(initialCaptureStage, { type: "BatchReady", batch: batch() });
    expect(next).toEqual({ kind: "BatchOverview", batch: batch() });
  });

  /*
   * Photographs are chosen and opted in to on the scan sheet, so they arrive
   * here already taken: the batch never sits on an empty photo picker.
   */
  it("starts sending the photographs it was handed", () => {
    const next = captureReducer(
      { kind: "BatchOverview", batch: batch() },
      { type: "PhotosOffered", batch: batch(), photos: [photo(1), photo(2)] },
    );
    expect(next).toEqual({
      kind: "SendingPhotos",
      batch: batch(),
      photos: [photo(1), photo(2)],
      submitting: true,
      error: null,
    });
  });

  describe("while sending photographs", () => {
    const sending: CaptureStage = {
      kind: "SendingPhotos",
      batch: batch(),
      photos: [photo(1)],
      submitting: false,
      error: null,
    };

    it("tracks a retry and a failure to open the session", () => {
      const submitting = captureReducer(sending, { type: "SessionSubmitting" });
      expect(submitting).toMatchObject({ submitting: true, error: null });

      const failed = captureReducer(submitting, {
        type: "SessionSubmitFailed",
        message: "The session could not be started.",
      });
      expect(failed).toMatchObject({
        kind: "SendingPhotos",
        submitting: false,
        error: "The session could not be started.",
      });
    });

    /* The photographs are the whole point of a retry: losing them would leave
     * "Send them again" with nothing to send. */
    it("keeps the photographs through a failure", () => {
      const failed = captureReducer(sending, {
        type: "SessionSubmitFailed",
        message: "The session could not be started.",
      });
      expect(failed).toMatchObject({ photos: [photo(1)] });
    });

    it("moves to Uploading once the session starts", () => {
      const next = captureReducer(sending, {
        type: "SessionStarted",
        session: sessionSummary({ status: "AwaitingUpload" }),
        totalCount: 3,
      });
      expect(next).toEqual({
        kind: "Uploading",
        batch: batch(),
        session: sessionSummary({ status: "AwaitingUpload" }),
        uploadedCount: 0,
        totalCount: 3,
      });
    });

    it("ignores session actions in every other stage", () => {
      const elsewhere: CaptureStage = { kind: "BatchOverview", batch: batch() };
      expect(captureReducer(elsewhere, { type: "SessionSubmitting" })).toBe(elsewhere);
      expect(captureReducer(elsewhere, { type: "SessionSubmitFailed", message: "No." })).toBe(
        elsewhere,
      );
    });
  });

  describe("while uploading", () => {
    const uploading: CaptureStage = {
      kind: "Uploading",
      batch: batch(),
      session: sessionSummary({ status: "AwaitingUpload" }),
      uploadedCount: 0,
      totalCount: 2,
    };

    it("tracks progress", () => {
      const next = captureReducer(uploading, { type: "UploadProgressed", uploadedCount: 1 });
      expect(next).toMatchObject({ uploadedCount: 1 });
    });

    it("moves to AwaitingRecognition once every upload completes", () => {
      const next = captureReducer(uploading, {
        type: "UploadsCompleted",
        session: sessionSummary({ status: "Queued" }),
      });
      expect(next).toEqual({
        kind: "AwaitingRecognition",
        batch: batch(),
        session: sessionSummary({ status: "Queued" }),
        checkFailures: 0,
      });
    });

    it("holds on to the photographs so a failed upload can be sent again", () => {
      const next = captureReducer(uploading, {
        type: "UploadFailed",
        photos: [photo(1)],
        message: "That photograph could not be uploaded. Check your connection and try again.",
      });
      expect(next).toEqual({
        kind: "SendingPhotos",
        batch: batch(),
        photos: [photo(1)],
        submitting: false,
        error: "That photograph could not be uploaded. Check your connection and try again.",
      });
    });
  });

  describe("polling a session", () => {
    const awaiting: CaptureStage = {
      kind: "AwaitingRecognition",
      batch: batch(),
      session: sessionSummary({ status: "Queued" }),
      checkFailures: 0,
    };

    it.each(["Queued", "ProcessingBarcode", "ProcessingImages", "Enriching", "Fusing"] as const)(
      "stays in AwaitingRecognition while the status is %s",
      (status) => {
        const next = captureReducer(awaiting, {
          type: "SessionPolled",
          session: sessionView({ status }),
        });
        expect(next.kind).toBe("AwaitingRecognition");
      },
    );

    it("moves to ReviewingCandidates once the session is ReviewReady", () => {
      const next = captureReducer(awaiting, {
        type: "SessionPolled",
        session: sessionView({ status: "ReviewReady", candidates: [internalCandidate()] }),
      });
      expect(next).toEqual({
        kind: "ReviewingCandidates",
        batch: batch(),
        session: sessionView({ status: "ReviewReady", candidates: [internalCandidate()] }),
        showDetails: false,
      });
    });

    it("preserves whether analysis details were open across a re-poll", () => {
      const reviewing: CaptureStage = {
        kind: "ReviewingCandidates",
        batch: batch(),
        session: sessionView({ status: "ReviewReady" }),
        showDetails: true,
      };
      const next = captureReducer(reviewing, {
        type: "SessionPolled",
        session: sessionView({ status: "ReviewReady" }),
      });
      expect(next).toMatchObject({ showDetails: true });
    });

    it("moves to SessionUnavailable on Failed or Expired", () => {
      for (const status of ["Failed", "Expired"] as const) {
        const next = captureReducer(awaiting, {
          type: "SessionPolled",
          session: sessionView({ status }),
        });
        expect(next.kind).toBe("SessionUnavailable");
      }
    });

    it("ignores a poll result outside AwaitingRecognition/ReviewingCandidates", () => {
      const elsewhere: CaptureStage = { kind: "BatchOverview", batch: batch() };
      expect(captureReducer(elsewhere, { type: "SessionPolled", session: sessionView() })).toBe(
        elsewhere,
      );
    });
  });

  describe("reviewing candidates", () => {
    const reviewing: CaptureStage = {
      kind: "ReviewingCandidates",
      batch: batch(),
      session: sessionView({ status: "ReviewReady", candidates: [internalCandidate()] }),
      showDetails: false,
    };

    it("toggles analysis details", () => {
      expect(captureReducer(reviewing, { type: "ToggleAnalysisDetails" })).toMatchObject({
        showDetails: true,
      });
    });

    it("moves to EnteringReceipt with the batch default location prefilled", () => {
      const withDefault: CaptureStage = {
        ...reviewing,
        batch: batch({ defaultLocationId: "location-1" }),
      };
      const next = captureReducer(withDefault, {
        type: "CandidateSelected",
        selection: {
          kind: "ExistingItem",
          itemId: "item-1",
          candidateId: "candidate-1",
          label: "Widget",
          reference: "ITM-0001",
          unit: "ea",
          onHand: "0",
        },
        locationId: "location-1",
      });
      expect(next).toMatchObject({
        kind: "EnteringReceipt",
        selection: { kind: "ExistingItem", itemId: "item-1" },
        draft: { quantity: "", locationId: "location-1", acknowledgedDuplicatePartNumber: false },
      });
    });

    it("starts manual entry with a detected unmatched barcode pre-filled", () => {
      const withBarcode: CaptureStage = {
        ...reviewing,
        session: sessionView({
          status: "ReviewReady",
          detectedBarcodes: [{ value: "5012345678900", symbology: "EAN-13", imageOrdinal: 1 }],
        }),
      };
      const next = captureReducer(withBarcode, { type: "ManualEntryStarted", locationId: "" });
      expect(next).toMatchObject({
        kind: "EnteringReceipt",
        selection: {
          kind: "NewItem",
          candidateId: null,
          name: "",
          unit: "",
          barcode: "5012345678900",
        },
      });
    });
  });

  describe("entering the receipt", () => {
    const entering: CaptureStage = {
      kind: "EnteringReceipt",
      batch: batch(),
      session: sessionView({ status: "ReviewReady" }),
      selection: {
        kind: "ExistingItem",
        itemId: "item-1",
        candidateId: null,
        label: "Widget",
        reference: "ITM-0001",
        unit: "ea",
        onHand: "0",
      },
      draft: { quantity: "", locationId: "", acknowledgedDuplicatePartNumber: false },
      submitting: false,
      error: null,
      duplicatePartNumberConflict: false,
    };

    it("merges a partial draft change", () => {
      const next = captureReducer(entering, {
        type: "ReceiptDraftChanged",
        draft: { quantity: "5" },
      });
      expect(next).toMatchObject({ draft: { quantity: "5", locationId: "" } });
    });

    it("returns to ReviewingCandidates without losing the session", () => {
      const next = captureReducer(entering, { type: "ReceiptBackToCandidates" });
      expect(next).toEqual({
        kind: "ReviewingCandidates",
        batch: batch(),
        session: sessionView({ status: "ReviewReady" }),
        showDetails: false,
      });
    });

    it("tracks a commit failure without discarding the draft", () => {
      const submitting = captureReducer(entering, { type: "CommitSubmitting" });
      const failed = captureReducer(submitting, {
        type: "CommitFailed",
        message: "That item was edited while you were checking it.",
        duplicatePartNumberConflict: false,
      });
      expect(failed).toMatchObject({
        kind: "EnteringReceipt",
        submitting: false,
        error: "That item was edited while you were checking it.",
        duplicatePartNumberConflict: false,
        draft: entering.draft,
      });
    });

    it("flags a duplicate part number conflict so the form can offer to confirm it", () => {
      const failed = captureReducer(entering, {
        type: "CommitFailed",
        message: "Another active item already uses this part number. Confirm to create it anyway.",
        duplicatePartNumberConflict: true,
      });
      expect(failed).toMatchObject({ duplicatePartNumberConflict: true });
    });

    it("replaces the selection and clears any conflict when it is edited", () => {
      const flagged: CaptureStage = { ...entering, duplicatePartNumberConflict: true };
      const next = captureReducer(flagged, {
        type: "SelectionChanged",
        selection: {
          kind: "NewItem",
          candidateId: null,
          reference: null,
          name: "Widget",
          unit: "ea",
          barcode: null,
          partNumber: "RS-1",
        },
      });
      expect(next).toMatchObject({
        selection: { kind: "NewItem", name: "Widget", partNumber: "RS-1" },
        duplicatePartNumberConflict: false,
        error: null,
      });
    });

    it("ignores a selection change outside EnteringReceipt", () => {
      const elsewhere: CaptureStage = { kind: "BatchOverview", batch: batch() };
      expect(
        captureReducer(elsewhere, {
          type: "SelectionChanged",
          selection: {
            kind: "ExistingItem",
            itemId: "item-1",
            candidateId: null,
            label: "Widget",
            reference: "ITM-0001",
            unit: "ea",
            onHand: "0",
          },
        }),
      ).toBe(elsewhere);
    });

    it("moves to Committed on success", () => {
      const result: CommitCaptureEntryResponse = {
        item: item(),
        transactionId: "txn-1",
        createdItem: false,
        batch: batch({ committedEntryCount: 1 }),
      };
      const next = captureReducer(entering, { type: "CommitSucceeded", result });
      expect(next).toEqual({ kind: "Committed", batch: result.batch, result, locationId: "" });
    });
  });

  describe("resuming a session from BatchOverview", () => {
    const overview: CaptureStage = { kind: "BatchOverview", batch: batch() };

    it("goes to ReviewingCandidates when the session is already ready", () => {
      const next = captureReducer(overview, {
        type: "SessionResumed",
        batch: batch(),
        session: sessionView({ status: "ReviewReady" }),
      });
      expect(next).toEqual({
        kind: "ReviewingCandidates",
        batch: batch(),
        session: sessionView({ status: "ReviewReady" }),
        showDetails: false,
      });
    });

    it("goes to AwaitingRecognition when the session is still working", () => {
      const next = captureReducer(overview, {
        type: "SessionResumed",
        batch: batch(),
        session: sessionView({ status: "Fusing" }),
      });
      expect(next).toEqual({
        kind: "AwaitingRecognition",
        batch: batch(),
        session: sessionView({ status: "Fusing" }),
        checkFailures: 0,
      });
    });

    it("goes to SessionUnavailable when the session failed or expired", () => {
      const next = captureReducer(overview, {
        type: "SessionResumed",
        batch: batch(),
        session: sessionView({ status: "Expired" }),
      });
      expect(next).toEqual({
        kind: "SessionUnavailable",
        batch: batch(),
        session: sessionView({ status: "Expired" }),
      });
    });

    it("ignores a resume outside BatchOverview", () => {
      const elsewhere: CaptureStage = {
        kind: "AwaitingRecognition",
        batch: batch(),
        session: sessionSummary(),
        checkFailures: 0,
      };
      expect(
        captureReducer(elsewhere, {
          type: "SessionResumed",
          batch: batch(),
          session: sessionView(),
        }),
      ).toBe(elsewhere);
    });
  });

  it("returns to BatchOverview after a cancellation or an explicit return", () => {
    const somewhere: CaptureStage = {
      kind: "AwaitingRecognition",
      batch: batch(),
      session: sessionSummary(),
      checkFailures: 0,
    };
    expect(
      captureReducer(somewhere, {
        type: "SessionCancelled",
        batch: batch({ committedEntryCount: 2 }),
      }),
    ).toEqual({ kind: "BatchOverview", batch: batch({ committedEntryCount: 2 }) });
    expect(captureReducer(somewhere, { type: "ReturnToBatch", batch: batch() })).toEqual({
      kind: "BatchOverview",
      batch: batch(),
    });
  });
});

describe("topCandidateSelection", () => {
  it("returns null when there is no rank-1 candidate", () => {
    expect(topCandidateSelection([internalCandidate({ rank: 2 })])).toBeNull();
  });

  it("returns null when the rank-1 candidate is not selectable", () => {
    expect(topCandidateSelection([internalCandidate({ selectable: false })])).toBeNull();
  });

  it("builds an ExistingItem selection from an internal candidate", () => {
    expect(topCandidateSelection([internalCandidate()])).toEqual({
      kind: "ExistingItem",
      reference: "ITM-0001",
      unit: "ea",
      onHand: "0",
      itemId: "item-1",
      candidateId: "candidate-1",
      label: "Widget",
    });
  });

  it("builds a NewItem selection from an external draft candidate", () => {
    const draft = internalCandidate({
      kind: "ExternalDraft",
      item: null,
      identity: {
        manufacturer: "Acme",
        name: "Acme Widget",
        partNumber: "RS-1234A",
        barcode: "5012345678900",
        unit: "ea",
        variantAttributes: [],
      },
    });
    expect(topCandidateSelection([draft])).toEqual({
      kind: "NewItem",
      candidateId: "candidate-1",
      reference: null,
      name: "Acme Widget",
      unit: "ea",
      barcode: "5012345678900",
      partNumber: "RS-1234A",
    });
  });

  it("uses the detected barcode when an external draft omitted it", () => {
    const draft = internalCandidate({
      kind: "ExternalDraft",
      item: null,
      identity: {
        manufacturer: null,
        name: "Uncatalogued widget",
        partNumber: null,
        barcode: null,
        unit: "ea",
        variantAttributes: [],
      },
    });

    expect(topCandidateSelection([draft], "5012345678900")).toMatchObject({
      kind: "NewItem",
      barcode: "5012345678900",
    });
  });

  it("returns null for an internal candidate missing its item", () => {
    expect(topCandidateSelection([internalCandidate({ item: null })])).toBeNull();
  });
});

describe("failure and completion states", () => {
  it("counts consecutive failed status checks", () => {
    const awaiting: CaptureStage = {
      kind: "AwaitingRecognition",
      batch: batch(),
      session: sessionSummary({ status: "Queued" }),
      checkFailures: 0,
    };

    const once = captureReducer(awaiting, { type: "SessionCheckFailed" });
    const twice = captureReducer(once, { type: "SessionCheckFailed" });

    expect(twice).toMatchObject({ kind: "AwaitingRecognition", checkFailures: 2 });
  });

  it("forgets the failures as soon as a check succeeds", () => {
    const stalled: CaptureStage = {
      kind: "AwaitingRecognition",
      batch: batch(),
      session: sessionSummary({ status: "Queued" }),
      checkFailures: 4,
    };

    const next = captureReducer(stalled, {
      type: "SessionPolled",
      session: sessionView({ status: "Fusing" }),
    });

    expect(next).toMatchObject({ kind: "AwaitingRecognition", checkFailures: 0 });
  });

  it("ignores a failed check outside AwaitingRecognition", () => {
    const overview: CaptureStage = { kind: "BatchOverview", batch: batch() };
    expect(captureReducer(overview, { type: "SessionCheckFailed" })).toBe(overview);
  });

  /*
   * A committed session used to reopen the review screen, inviting a second
   * confirmation for stock that had already been received.
   */
  it("does not reopen review for a session that was already committed", () => {
    const next = captureReducer(
      { kind: "BatchOverview", batch: batch() },
      {
        type: "SessionResumed",
        batch: batch(),
        session: sessionView({ status: "Committed" }),
      },
    );

    expect(next.kind).toBe("SessionUnavailable");
  });

  it("does not reopen review when a poll reports the session committed", () => {
    const awaiting: CaptureStage = {
      kind: "AwaitingRecognition",
      batch: batch(),
      session: sessionSummary({ status: "Queued" }),
      checkFailures: 0,
    };

    const next = captureReducer(awaiting, {
      type: "SessionPolled",
      session: sessionView({ status: "Committed" }),
    });

    expect(next.kind).toBe("SessionUnavailable");
  });
});
