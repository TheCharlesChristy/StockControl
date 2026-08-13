import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded";
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Typography,
} from "@mui/material";
import type {
  CommitCaptureEntryRequest,
  LocationView,
  RecognitionSessionSummaryView,
} from "@stockcontrol/contracts";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";

import { ApiError } from "../../api/ApiClient";
import { useApi, useResource } from "../../api/ApiContext";
import { LoadingRows, PageHeader } from "../../components/DataStates";
import type { BarcodeProvider } from "./barcode/provider";
import { BatchSummary } from "./BatchSummary";
import { CandidateReview } from "./CandidateReview";
import { CapturePhotos } from "./CapturePhotos";
import {
  captureReducer,
  initialCaptureStage,
  type AddedEntry,
  type CaptureStage,
  type CapturedPhoto,
} from "./capture-reducer";
import { clearCaptureProgress, loadCaptureProgress, saveCaptureProgress } from "./capture-storage";
import { createIdempotencyKeeper } from "./idempotency";
import { ReceiptConfirmation } from "./ReceiptConfirmation";
import { RecognitionProgress } from "./RecognitionProgress";
import { SessionUnavailable } from "./SessionUnavailable";
import { CaptureSuccess } from "./CaptureSuccess";
import {
  CaptureUploadError,
  normaliseImage,
  SourceImageRejectedError,
  uploadToGrant,
} from "./upload/normalise";

const POLL_INITIAL_MS = 2_000;
const POLL_MAX_MS = 10_000;
const POLL_BACKOFF_STEP_MS = 1_000;

/*
 * `messageFor` used to trust only ApiError, which quietly threw away the two
 * most useful messages the upload leg produces — "that photograph is too
 * large" and "check your connection" — and replaced both with a generic line
 * that tells the person nothing they can act on.
 */
const messageFor = (caught: unknown, fallback: string): string =>
  caught instanceof ApiError ||
  caught instanceof SourceImageRejectedError ||
  caught instanceof CaptureUploadError
    ? caught.message
    : fallback;

const newClientId = (): string => crypto.randomUUID();

const revokePreviews = (photos: readonly CapturedPhoto[]): void => {
  for (const photo of photos) URL.revokeObjectURL(photo.previewUrl);
};

const STEPS = ["Photos", "Suggestions", "Confirm"] as const;

/** Which of the three steps a stage belongs to, or null where the stepper
 *  would be noise — the batch screen is not part of one item's journey. */
const stepFor = (stage: CaptureStage): number | null => {
  switch (stage.kind) {
    case "CapturingPhotos":
    case "Uploading":
      return 0;
    case "AwaitingRecognition":
    case "ReviewingCandidates":
      return 1;
    case "EnteringReceipt":
      return 2;
    default:
      return null;
  }
};

/**
 * Orchestrates the whole assisted-capture journey, specification section 5.
 * The reducer holds only what a browser refresh cannot lose — UUIDs, review
 * state, the manual-entry draft. Photo `File`s live in a ref here, alongside
 * it, because they are never worth persisting and would not survive a reload
 * regardless.
 */
export interface StockCapturePageProps {
  /** Overrides the real camera/decoder wiring in tests. */
  readonly barcodeProvider?: BarcodeProvider;
}

export function StockCapturePage({ barcodeProvider }: StockCapturePageProps = {}): ReactElement {
  const api = useApi();
  const [stage, dispatch] = useReducer(captureReducer, initialCaptureStage);
  const startedRef = useRef(false);
  const photosRef = useRef<readonly CapturedPhoto[]>([]);
  const pollDelayRef = useRef(POLL_INITIAL_MS);
  const [finishing, setFinishing] = useState(false);
  const [batchActionError, setBatchActionError] = useState<string | null>(null);
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  const [defaultLocationId, setDefaultLocationId] = useState("");
  const [addedEntries, setAddedEntries] = useState<readonly AddedEntry[]>([]);
  const [checkNonce, setCheckNonce] = useState(0);

  /*
   * Specification section 12. Both keys are held rather than minted per
   * attempt: a retry after a lost response must be recognisable to the server
   * as the same command, or one delivery becomes two stock receipts.
   */
  const sessionKeys = useRef(createIdempotencyKeeper()).current;
  const entryKeys = useRef(createIdempotencyKeeper()).current;

  const loadLocations = useCallback((signal: AbortSignal) => api.listLocations(signal), [api]);
  const locations = useResource(loadLocations);
  const locationList: readonly LocationView[] = locations.data?.locations ?? [];

  // Recovers an open batch (and, if one was in flight, its session) from the
  // UUIDs left in session storage, or starts a fresh batch when there is
  // nothing to recover. Runs exactly once per mount.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const progress = loadCaptureProgress();

    const startFreshBatch = async (): Promise<void> => {
      try {
        const batch = await api.startCaptureBatch({
          clientBatchId: newClientId(),
          defaultLocationId: null,
        });
        saveCaptureProgress({ batchId: batch.id, sessionId: null });
        setDefaultLocationId(batch.defaultLocationId ?? "");
        dispatch({ type: "BatchReady", batch });
      } catch (caught) {
        dispatch({
          type: "BatchStartFailed",
          message: messageFor(caught, "A capture batch could not be started."),
        });
      }
    };

    const resume = async (): Promise<void> => {
      if (progress === null) {
        await startFreshBatch();
        return;
      }

      try {
        const batch = await api.getCaptureBatch(progress.batchId);
        dispatch({ type: "BatchReady", batch });
        saveCaptureProgress({ batchId: batch.id, sessionId: progress.sessionId });
        setDefaultLocationId(batch.defaultLocationId ?? "");

        if (progress.sessionId !== null) {
          const session = await api.getCaptureSession(progress.sessionId);
          dispatch({ type: "SessionResumed", batch, session });
        }
      } catch {
        /* Losing the previous batch is worth saying out loud: its photographs
         * and part-finished items are not in the new one. */
        clearCaptureProgress();
        setBatchNotice(
          "The batch you had open could not be reopened, so this is a new one. Anything already added to stock is safe.",
        );
        await startFreshBatch();
      }
    };

    void resume();
  }, [api]);

  // The upload leg, specification section 10: normalise every photo, request
  // one grant per photo, PUT each in turn, then tell the server every upload
  // landed. A session that resolved from a barcode alone (`exactItemId`) skips
  // straight past this with no photographs declared at all.
  useEffect(() => {
    if (stage.kind !== "Uploading") return;

    if (stage.session.status !== "AwaitingUpload") {
      /* The barcode short cut reaches here having uploaded nothing, so this is
       * the only place its previews are ever released. */
      revokePreviews(photosRef.current);
      dispatch({ type: "UploadsCompleted", session: stage.session });
      return;
    }

    let cancelled = false;
    // Read through a function, not the variable directly: TypeScript narrows
    // a captured `let` to a constant across every `await` below, since
    // nothing in this function's own body reassigns it — the reassignment
    // lives in the effect's cleanup closure instead, and a call is opaque to
    // that narrowing.
    const isCancelled = (): boolean => cancelled;
    const { batch, session } = stage;
    const photos = photosRef.current;

    const run = async (): Promise<void> => {
      try {
        const normalised = await Promise.all(photos.map((photo) => normaliseImage(photo.file)));
        if (isCancelled()) return;

        const { grants } = await api.requestCaptureUploads(session.id, {
          images: normalised.map((image, index) => ({
            ordinal: photos[index]?.ordinal ?? index + 1,
            mediaType: image.mediaType,
            byteLength: image.byteLength,
            sha256: image.sha256,
            width: image.width,
            height: image.height,
          })),
        });
        if (isCancelled()) return;

        const grantByOrdinal = new Map(grants.map((grant) => [grant.ordinal, grant]));
        let uploadedCount = 0;

        for (const [index, image] of normalised.entries()) {
          const ordinal = photos[index]?.ordinal ?? index + 1;
          const grant = grantByOrdinal.get(ordinal);
          if (grant === undefined) continue;

          await uploadToGrant(grant, image);
          uploadedCount += 1;
          if (!isCancelled()) dispatch({ type: "UploadProgressed", uploadedCount });
        }
        if (isCancelled()) return;

        const uploadedImageIds = [...grantByOrdinal.values()].map((grant) => grant.imageId);
        const completed = await api.completeCaptureUploads(session.id, { uploadedImageIds });
        if (!isCancelled()) {
          revokePreviews(photos);
          dispatch({ type: "UploadsCompleted", session: completed });
        }
      } catch (caught) {
        if (!isCancelled()) {
          dispatch({
            type: "UploadFailed",
            batch,
            photos,
            message: messageFor(caught, "The photographs could not be uploaded."),
          });
        }
      }
    };

    void run();
    return (): void => {
      cancelled = true;
    };
  }, [api, stage]);

  // Durable status polling, specification section 10: checked immediately on
  // arrival — a session that resolved without a model call (an exact barcode
  // match) should not sit through one idle interval before showing it — then
  // an expanding interval from 2s to 10s. Keyed only on the session id so a
  // poll response updating the stage in place never restarts the timer.
  const awaitingSessionId = stage.kind === "AwaitingRecognition" ? stage.session.id : null;

  useEffect(() => {
    if (awaitingSessionId === null) {
      pollDelayRef.current = POLL_INITIAL_MS;
      return;
    }

    let cancelled = false;
    let firstCheck = true;

    const poll = (): void => {
      if (cancelled) return;
      api
        .getCaptureSession(awaitingSessionId)
        .then((session) => {
          if (!cancelled) dispatch({ type: "SessionPolled", session });
        })
        .catch(() => {
          /* Swallowing this left a progress bar turning over a connection
           * that had gone away, with nothing on screen ever saying so. */
          if (!cancelled) dispatch({ type: "SessionCheckFailed" });
        })
        .finally(() => {
          if (cancelled) return;
          if (!firstCheck) {
            pollDelayRef.current = Math.min(
              pollDelayRef.current + POLL_BACKOFF_STEP_MS,
              POLL_MAX_MS,
            );
          }
          firstCheck = false;
          timer = setTimeout(poll, pollDelayRef.current);
        });
    };

    let timer = setTimeout(poll, 0);
    return (): void => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, awaitingSessionId, checkNonce]);

  useEffect(() => {
    return (): void => {
      revokePreviews(photosRef.current);
    };
  }, []);

  const startNewItem = useCallback((): void => {
    if (stage.kind !== "BatchOverview") return;
    photosRef.current = [];
    sessionKeys.reset();
    setBatchActionError(null);
    setBatchNotice(null);
    dispatch({ type: "StartNewItem", batch: stage.batch });
  }, [sessionKeys, stage]);

  const finishBatch = useCallback((): void => {
    if (stage.kind !== "BatchOverview") return;
    setFinishing(true);
    setBatchActionError(null);
    api
      .completeCaptureBatch(stage.batch.id)
      .then((batch) => {
        clearCaptureProgress();
        dispatch({ type: "BatchClosed", batch });
      })
      .catch((caught: unknown) => {
        setBatchActionError(messageFor(caught, "The batch could not be finished."));
      })
      .finally(() => {
        setFinishing(false);
      });
  }, [api, stage]);

  const startAnotherBatch = useCallback((): void => {
    clearCaptureProgress();
    setAddedEntries([]);
    setBatchNotice(null);
    setBatchActionError(null);
    startedRef.current = false;
    entryKeys.reset();
    sessionKeys.reset();
    api
      .startCaptureBatch({ clientBatchId: newClientId(), defaultLocationId: null })
      .then((batch) => {
        saveCaptureProgress({ batchId: batch.id, sessionId: null });
        setDefaultLocationId(batch.defaultLocationId ?? "");
        startedRef.current = true;
        dispatch({ type: "BatchReady", batch });
      })
      .catch((caught: unknown) => {
        startedRef.current = true;
        dispatch({
          type: "BatchStartFailed",
          message: messageFor(caught, "A capture batch could not be started."),
        });
      });
  }, [api, entryKeys, sessionKeys]);

  const resumeSession = useCallback(
    (summary: RecognitionSessionSummaryView): void => {
      if (stage.kind !== "BatchOverview") return;
      const { batch } = stage;
      setBatchActionError(null);
      saveCaptureProgress({ batchId: batch.id, sessionId: summary.id });
      api
        .getCaptureSession(summary.id)
        .then((session) => {
          dispatch({ type: "SessionResumed", batch, session });
        })
        .catch((caught: unknown) => {
          setBatchActionError(messageFor(caught, "That item could not be resumed."));
        });
    },
    [api, stage],
  );

  const addPhoto = useCallback((photo: CapturedPhoto): void => {
    dispatch({ type: "PhotoAdded", photo });
  }, []);

  const removePhoto = useCallback((ordinal: number): void => {
    dispatch({ type: "PhotoRemoved", ordinal });
  }, []);

  const cancelCapturing = useCallback((): void => {
    if (stage.kind !== "CapturingPhotos") return;
    revokePreviews(stage.photos);
    dispatch({ type: "ReturnToBatch", batch: stage.batch });
  }, [stage]);

  const submitPhotos = useCallback((): void => {
    if (stage.kind !== "CapturingPhotos") return;
    const { batch, photos } = stage;
    photosRef.current = photos;
    dispatch({ type: "SessionSubmitting" });

    const localCodes = photos.flatMap((photo) => photo.localCodes);
    const clientSessionId = sessionKeys.keyFor({
      batchId: batch.id,
      photoCount: photos.length,
      localCodes,
    });

    api
      .startCaptureSession({
        clientSessionId,
        batchId: batch.id,
        photoCount: photos.length,
        localCodes,
      })
      .then(({ session }) => {
        saveCaptureProgress({ batchId: batch.id, sessionId: session.id });
        pollDelayRef.current = POLL_INITIAL_MS;
        dispatch({ type: "SessionStarted", session, totalCount: photos.length });
      })
      .catch((caught: unknown) => {
        dispatch({
          type: "SessionSubmitFailed",
          message: messageFor(caught, "The session could not be started."),
        });
      });
  }, [api, sessionKeys, stage]);

  const cancelSession = useCallback((): void => {
    if (stage.kind !== "AwaitingRecognition" && stage.kind !== "ReviewingCandidates") return;
    const { batch, session } = stage;
    saveCaptureProgress({ batchId: batch.id, sessionId: null });
    sessionKeys.reset();
    api
      .cancelCaptureSession(session.id)
      .catch((caught: unknown) => {
        /* The screen returns to the batch either way — but if the server did
         * not accept the cancellation, its photographs are still queued. */
        setBatchActionError(
          messageFor(
            caught,
            "That item was closed here, but the server may still be working on it.",
          ),
        );
      })
      .finally(() => {
        dispatch({ type: "SessionCancelled", batch });
      });
  }, [api, sessionKeys, stage]);

  const abandonSession = useCallback((): void => {
    if (stage.kind !== "SessionUnavailable") return;
    sessionKeys.reset();
    saveCaptureProgress({ batchId: stage.batch.id, sessionId: null });
    dispatch({ type: "ReturnToBatch", batch: stage.batch });
  }, [sessionKeys, stage]);

  const retrySession = useCallback((): void => {
    if (stage.kind !== "SessionUnavailable") return;
    photosRef.current = [];
    sessionKeys.reset();
    saveCaptureProgress({ batchId: stage.batch.id, sessionId: null });
    dispatch({ type: "StartNewItem", batch: stage.batch });
  }, [sessionKeys, stage]);

  const checkNow = useCallback((): void => {
    setCheckNonce((nonce) => nonce + 1);
  }, []);

  const toggleDetails = useCallback((): void => {
    dispatch({ type: "ToggleAnalysisDetails" });
  }, []);

  const commit = useCallback((): void => {
    if (stage.kind !== "EnteringReceipt") return;
    const { batch, session, selection, draft } = stage;
    dispatch({ type: "CommitSubmitting" });

    const command = {
      sessionId: session.id,
      selection:
        selection.kind === "ExistingItem"
          ? {
              kind: "ExistingItem" as const,
              itemId: selection.itemId,
              candidateId: selection.candidateId,
            }
          : {
              kind: "NewItem" as const,
              candidateId: selection.candidateId,
              reference: selection.reference,
              name: selection.name,
              unit: selection.unit,
              barcode: selection.barcode,
              partNumber: selection.partNumber,
            },
      quantity: draft.quantity,
      locationId: draft.locationId,
      acknowledgedDuplicatePartNumber: draft.acknowledgedDuplicatePartNumber,
    };

    const request: CommitCaptureEntryRequest = {
      clientEntryId: entryKeys.keyFor(command),
      ...command,
    };

    api
      .commitCaptureEntry(batch.id, request)
      .then((result) => {
        /* Not cleared: the batch is still open and still worth returning to.
         * Clearing it here meant a refresh straight after adding an item
         * silently abandoned the batch that item went into. */
        saveCaptureProgress({ batchId: result.batch.id, sessionId: null });
        entryKeys.reset();
        sessionKeys.reset();
        setAddedEntries((current) => [
          ...current,
          {
            itemId: result.item.id,
            reference: result.item.reference,
            name: result.item.name,
            quantity: draft.quantity,
            unit: result.item.unit,
          },
        ]);
        dispatch({ type: "CommitSucceeded", result });
      })
      .catch((caught: unknown) => {
        const partNumberError =
          caught instanceof ApiError ? caught.fieldError("partNumber") : undefined;
        dispatch({
          type: "CommitFailed",
          message: partNumberError ?? messageFor(caught, "That could not be added to stock."),
          duplicatePartNumberConflict: partNumberError !== undefined,
        });
      });
  }, [api, entryKeys, sessionKeys, stage]);

  const activeStep = useMemo(() => stepFor(stage), [stage]);

  return (
    <Box>
      <Button
        component={RouterLink}
        to="/inventory"
        startIcon={<ArrowBackRounded />}
        sx={{ mb: 1.5 }}
      >
        Back to inventory
      </Button>

      <PageHeader
        eyebrow="Assisted stock capture"
        title="Add stock"
        description="Photograph an item and let StockControl suggest what it is. Nothing changes in stock until you confirm it."
      />

      {activeStep !== null && (
        <Stepper activeStep={activeStep} sx={{ mb: 3, maxWidth: 560 }}>
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
      )}

      {stage.kind === "StartingBatch" && <LoadingRows rows={6} label="Starting capture" />}

      {stage.kind === "BatchFailed" && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={startAnotherBatch}>
              Try again
            </Button>
          }
        >
          {stage.message}
        </Alert>
      )}

      {stage.kind === "BatchOverview" && (
        <BatchSummary
          batch={stage.batch}
          added={addedEntries}
          locations={locationList}
          defaultLocationId={defaultLocationId}
          notice={batchNotice}
          error={batchActionError}
          finishing={finishing}
          onDefaultLocationChange={setDefaultLocationId}
          onDismissNotice={() => setBatchNotice(null)}
          onStartNewItem={startNewItem}
          onResumeSession={resumeSession}
          onFinishBatch={finishBatch}
        />
      )}

      {stage.kind === "BatchCompleted" && (
        <Stack spacing={2.5}>
          <Alert severity="success">
            {stage.batch.committedEntryCount === 0
              ? "That batch is finished. Nothing was added to stock."
              : `That batch is finished. ${String(stage.batch.committedEntryCount)} ${
                  stage.batch.committedEntryCount === 1 ? "item was" : "items were"
                } added to stock.`}
          </Alert>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <Button variant="contained" onClick={startAnotherBatch}>
              Start another batch
            </Button>
            <Button component={RouterLink} to="/inventory" variant="outlined">
              Back to inventory
            </Button>
          </Stack>
        </Stack>
      )}

      {stage.kind === "CapturingPhotos" && (
        <CapturePhotos
          photos={stage.photos}
          submitting={stage.submitting}
          error={stage.error}
          onAddPhoto={addPhoto}
          onRemovePhoto={removePhoto}
          onSubmit={submitPhotos}
          onCancel={cancelCapturing}
          {...(barcodeProvider === undefined ? {} : { barcodeProvider })}
        />
      )}

      {stage.kind === "Uploading" && (
        <Stack spacing={2} alignItems="center" sx={{ py: 4 }}>
          <LinearProgress
            variant={stage.totalCount > 0 ? "determinate" : "indeterminate"}
            value={stage.totalCount > 0 ? (stage.uploadedCount / stage.totalCount) * 100 : 0}
            sx={{ width: "100%", maxWidth: 360 }}
          />
          <Typography role="status" aria-live="polite">
            Sending photographs — {stage.uploadedCount} of {stage.totalCount}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Keep this page open until they have all been sent.
          </Typography>
        </Stack>
      )}

      {stage.kind === "AwaitingRecognition" && (
        <RecognitionProgress
          status={stage.session.status}
          checkFailures={stage.checkFailures}
          onCheckNow={checkNow}
          onCancel={cancelSession}
        />
      )}

      {stage.kind === "ReviewingCandidates" && (
        <CandidateReview
          session={stage.session}
          showDetails={stage.showDetails}
          onToggleDetails={toggleDetails}
          onSelect={(selection) =>
            dispatch({ type: "CandidateSelected", selection, locationId: defaultLocationId })
          }
          onManualEntry={() =>
            dispatch({ type: "ManualEntryStarted", locationId: defaultLocationId })
          }
          onCancel={cancelSession}
        />
      )}

      {stage.kind === "EnteringReceipt" && (
        <ReceiptConfirmation
          selection={stage.selection}
          draft={stage.draft}
          locations={locationList}
          locationsFailed={locations.status === "error"}
          onReloadLocations={locations.reload}
          submitting={stage.submitting}
          error={stage.error}
          duplicatePartNumberConflict={stage.duplicatePartNumberConflict}
          onSelectionChange={(selection) => dispatch({ type: "SelectionChanged", selection })}
          onDraftChange={(draft) => dispatch({ type: "ReceiptDraftChanged", draft })}
          onSubmit={commit}
          onBack={() => dispatch({ type: "ReceiptBackToCandidates" })}
        />
      )}

      {stage.kind === "SessionUnavailable" && (
        <SessionUnavailable
          session={stage.session}
          onRetry={retrySession}
          onBackToBatch={abandonSession}
        />
      )}

      {stage.kind === "Committed" && (
        <CaptureSuccess
          result={stage.result}
          locationId={stage.locationId}
          locations={locationList}
          onBackToBatch={() => dispatch({ type: "ReturnToBatch", batch: stage.batch })}
        />
      )}
    </Box>
  );
}
