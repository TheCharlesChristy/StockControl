import PendingActionsRounded from "@mui/icons-material/PendingActionsRounded";
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  Paper,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { CAPTURE_MAX_PHOTOS } from "@stockcontrol/contracts";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactElement,
} from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";

import { useApi, useResource } from "../../api/ApiContext";
import { useAuth } from "../../auth/AuthContext";
import { useCapability } from "../../auth/useCapability";
import { offerPhotosToCapture } from "../stock-capture/handoff";
import { createBarcodeProvider, type BarcodeProvider } from "./barcode/provider";
import { createFrameGrabber, FrameCaptureError, type FrameGrabber } from "./frame-grabber";
import {
  firstLocalCode,
  isAcceptedSource,
  nextOrdinals,
  revokePreviews,
  type CapturedPhoto,
} from "./photo-tray";
import { initialScanState, isListening, scanReducer, type ScanSource } from "./scan-reducer";
import { UnidentifiedPanel } from "./UnidentifiedPanel";
import { Viewfinder } from "./Viewfinder";

type CameraState = "starting" | "scanning" | "unavailable";

export interface ScanSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /**
   * Where photos go when somebody asks for the item to be identified. The
   * capture page passes its own so that photos taken inside an open delivery
   * join that batch; left out, they are handed to the capture page through the
   * handoff slot and it decides.
   */
  readonly onIdentifyPhotos?: (photos: readonly CapturedPhoto[]) => void;
  /** Off on the capture page, which is the queue — linking to it from itself
   *  would be a button that goes nowhere. */
  readonly showQueue?: boolean;
  /** Override the real decoder and shutter in tests, which have neither a
   *  camera nor a canvas. */
  readonly barcodeProvider?: BarcodeProvider;
  readonly frameGrabber?: FrameGrabber;
}

/**
 * The scan button opens a camera.
 *
 * That sentence is the whole design. Point it at a label; if a QR or barcode
 * comes off it and the catalogue knows the code, the sheet leaves for that
 * item's page and there is nothing else to read or dismiss. Press the shutter
 * and the same question is asked of the photo. Only when neither works does a
 * screen appear at all, and what it asks is whether this is something new.
 *
 * Everything up to that question happens on the device: the stream never
 * leaves it, and a photo is decoded here. Saying yes to the question is the
 * only path by which an image is sent anywhere, and it is offered only to the
 * roles the server would accept.
 */
export function ScanSheet({
  open,
  onClose,
  onIdentifyPhotos,
  showQueue = true,
  barcodeProvider,
  frameGrabber,
}: ScanSheetProps): ReactElement {
  const api = useApi();
  const navigate = useNavigate();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const { features } = useAuth();
  const canManageStock = useCapability("manageStock");
  const canAddItem = features.stockCapture && canManageStock;

  const provider = useRef(barcodeProvider ?? createBarcodeProvider()).current;
  const grabber = useRef(frameGrabber ?? createFrameGrabber()).current;
  const [state, dispatch] = useReducer(scanReducer, initialScanState);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>("starting");
  const [typing, setTyping] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [shutterBusy, setShutterBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /*
   * The camera decodes many times a second. Without these, a label sitting in
   * frame would re-run the same lookup on every frame.
   */
  const listeningRef = useRef(true);
  const handledCodeRef = useRef<string | null>(null);
  const lookupInFlightRef = useRef(false);
  /** The photos this sheet is responsible for revoking. Emptied the moment
   *  they are handed on, which is when their previews stop being ours. */
  const photosRef = useRef<readonly CapturedPhoto[]>([]);

  const listening = isListening(state);

  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  useEffect(() => {
    photosRef.current = state.photos;
  }, [state.photos]);

  const loadOpenBatch = useCallback(
    (signal: AbortSignal) =>
      canAddItem && showQueue ? api.getOpenCaptureBatch(signal) : Promise.resolve(null),
    [api, canAddItem, showQueue],
  );
  const openBatch = useResource(loadOpenBatch);
  const waitingToReview = (openBatch.data?.sessions ?? []).filter(
    (session) => session.status === "ReviewReady",
  ).length;

  const stopCamera = useCallback((): void => {
    controlsRef.current?.stop();
    controlsRef.current = null;
  }, []);
  const controlsRef = useRef<IScannerControls | null>(null);

  const finish = useCallback((): void => {
    stopCamera();
    revokePreviews(photosRef.current);
    photosRef.current = [];
    handledCodeRef.current = null;
    setManualCode("");
    setTyping(false);
    setProblem(null);
    dispatch({ type: "StartOver" });
    onClose();
  }, [onClose, stopCamera]);

  const reframe = useCallback((keepPhotos: boolean): void => {
    if (!keepPhotos) {
      revokePreviews(photosRef.current);
      handledCodeRef.current = null;
    }
    setProblem(null);
    dispatch({ type: "Reframed", keepPhotos });
  }, []);

  /**
   * Turns whatever was read into the item it refers to, and leaves. Our own
   * labels encode the item's URL, so a decoded same-origin link is followed
   * rather than looked up; anything else is treated as a code, which is what
   * makes a supplier barcode on the packaging work as well as our own label.
   */
  const resolve = useCallback(
    async (raw: string, source: ScanSource): Promise<void> => {
      const code = raw.trim();
      if (code.length === 0 || lookupInFlightRef.current) return;

      handledCodeRef.current = code;
      lookupInFlightRef.current = true;
      dispatch({ type: "LookupStarted", code });

      try {
        if (/^https?:\/\//iu.test(code)) {
          const url = new URL(code);

          if (url.origin === window.location.origin) {
            void navigate(`${url.pathname}${url.search}`);
            finish();
            return;
          }
        }

        const item = await api.lookupItem(code);
        void navigate(`/inventory/${item.id}`);
        finish();
      } catch {
        /* Every way of not finding it is the same answer to the person: this
         * is not something StockControl can recognise on its own. */
        dispatch({ type: "LookupFailed", code, source });
      } finally {
        lookupInFlightRef.current = false;
      }
    },
    [api, finish, navigate],
  );

  /*
   * Read through a ref, never as a dependency. `resolve` closes over
   * `onClose`, which callers write inline, so listing it below would tear the
   * camera down and start it again on every render of whatever opened the
   * sheet — and the capture page re-renders every few seconds while polling.
   */
  const resolveRef = useRef(resolve);
  useEffect(() => {
    resolveRef.current = resolve;
  }, [resolve]);

  useEffect(() => {
    if (!open || videoElement === null) {
      return undefined;
    }

    let cancelled = false;

    /* Started through a resolved promise so that a decoder which refuses to
     * construct at all fails the same way a missing camera does — with the
     * code box still working, and a handheld scanner typing into it. */
    void Promise.resolve()
      .then(() =>
        new BrowserMultiFormatReader().decodeFromConstraints(
          {
            video: {
              // Prefer a rear-facing camera on phones, but do not require one:
              // laptops normally only expose a user-facing webcam. The
              // resolution is what the shutter captures as well as what the
              // live decoder reads, so it is asked for generously.
              facingMode: { ideal: "environment" },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
          },
          videoElement,
          (result) => {
            if (result === undefined || !listeningRef.current) return;
            const text = result.getText();
            if (text === handledCodeRef.current) return;
            void resolveRef.current(text, "camera");
          },
        ),
      )
      .then((controls) => {
        if (cancelled) {
          controls.stop();
          return;
        }

        controlsRef.current = controls;
        setCameraState("scanning");
      })
      .catch(() => {
        if (cancelled) return;
        setCameraState("unavailable");
        /* Without a camera the code box is the only way in, so it is not left
         * behind an icon somebody has to find. */
        setTyping(true);
      });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [open, videoElement]);

  useEffect(
    () => (): void => {
      revokePreviews(photosRef.current);
    },
    [],
  );

  /** Takes files from the shutter or the library, freezes the picture, then
   *  reads them here on the device. */
  const acceptFiles = useCallback(
    (files: readonly File[]): void => {
      const existing = photosRef.current;
      const usable = files.filter((file) => isAcceptedSource(file.type));
      const accepted = usable.slice(0, CAPTURE_MAX_PHOTOS - existing.length);

      if (accepted.length < files.length) {
        dispatch({
          type: "FilesRejected",
          notice:
            usable.length < files.length
              ? "Some of those were not photos, so they were left out."
              : `You can add at most ${String(CAPTURE_MAX_PHOTOS)} photos.`,
        });
      }
      if (accepted.length === 0) return;

      const ordinals = nextOrdinals(
        existing.map((photo) => photo.ordinal),
        accepted.length,
      );
      const taken = accepted.map((file, index) => ({
        ordinal: ordinals[index] ?? index + 1,
        file,
        previewUrl: URL.createObjectURL(file),
        sourceType: file.type,
        localCodes: [],
      }));

      /* Dispatched before the decode: the picture must freeze the instant the
       * shutter is pressed, not a second later when the reader finishes. */
      dispatch({ type: "ShotsTaken", photos: taken });

      void Promise.all(
        taken.map(async (photo) => ({
          ordinal: photo.ordinal,
          localCodes: await provider
            .decode(photo.file)
            .then((decoded) =>
              decoded.map((code) => ({
                value: code.value,
                symbology: code.symbology,
                imageOrdinal: photo.ordinal,
                readerVersion: provider.readerVersion,
              })),
            )
            .catch(() => []),
        })),
      ).then((codes) => {
        dispatch({ type: "CodesRead", codes });

        const found = codes.flatMap((entry) => entry.localCodes)[0];
        if (found !== undefined) {
          void resolveRef.current(found.value, "photo");
          return;
        }

        /* Only once every shot on the sheet has been read: an earlier one may
         * already have produced the answer. */
        if (firstLocalCode(existing) === undefined) {
          dispatch({ type: "NoCodeFound" });
        }
      });
    },
    [provider],
  );

  const takeShot = useCallback((): void => {
    if (videoElement === null) return;
    setShutterBusy(true);
    setProblem(null);

    void grabber
      .grab(videoElement)
      .then((file) => {
        acceptFiles([file]);
      })
      .catch((caught: unknown) => {
        setProblem(
          caught instanceof FrameCaptureError ? caught.message : "That photo could not be taken.",
        );
      })
      .finally(() => {
        setShutterBusy(false);
      });
  }, [acceptFiles, grabber, videoElement]);

  const handleFiles = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const files = [...(event.target.files ?? [])];
      event.target.value = "";
      if (files.length > 0) acceptFiles(files);
    },
    [acceptFiles],
  );

  const discardPhoto = useCallback((ordinal: number): void => {
    const photo = photosRef.current.find((entry) => entry.ordinal === ordinal);
    if (photo !== undefined) URL.revokeObjectURL(photo.previewUrl);
    dispatch({ type: "PhotoDiscarded", ordinal });
  }, []);

  /** The opt-in, and the only path by which a photo leaves the device. */
  const addAsNewItem = useCallback((): void => {
    const photos = photosRef.current;
    if (photos.length === 0) return;

    /* Ownership moves with them, before anything downstream can unmount this
     * sheet: whatever runs next must not find them still on our books. */
    photosRef.current = [];

    if (onIdentifyPhotos === undefined) {
      offerPhotosToCapture(photos);
      void navigate("/stock-capture");
    } else {
      onIdentifyPhotos(photos);
    }

    finish();
  }, [finish, navigate, onIdentifyPhotos]);

  const handleManualSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void resolve(manualCode, "typed");
  };

  const { stage } = state;
  const reading = stage.kind === "Reading" || stage.kind === "Looking";
  const frozenPreviewUrl =
    stage.kind !== "Framing" && state.photos.length > 0
      ? (state.photos[state.photos.length - 1]?.previewUrl ?? null)
      : null;

  return (
    <Dialog
      open={open}
      onClose={finish}
      fullScreen={fullScreen}
      fullWidth
      maxWidth="xs"
      aria-label="Scan an item"
      slotProps={{
        paper: {
          sx: {
            bgcolor: "#000000",
            overflow: "hidden",
            ...(fullScreen ? {} : { height: "min(78vh, 640px)" }),
          },
        },
      }}
    >
      <Viewfinder
        videoRef={setVideoElement}
        frozenPreviewUrl={frozenPreviewUrl}
        cameraUnavailable={cameraState === "unavailable"}
        busy={shutterBusy}
        canShoot={cameraState === "scanning" && state.photos.length < CAPTURE_MAX_PHOTOS}
        hint={
          cameraState === "starting"
            ? "Starting the camera…"
            : "Hold a barcode or QR code in the frame, or take a photo of the item"
        }
        onClose={finish}
        onShutter={takeShot}
        onToggleKeyboard={() => setTyping((current) => !current)}
        onFilesChosen={handleFiles}
      >
        {waitingToReview > 0 && stage.kind === "Framing" && (
          <Chip
            component={RouterLink}
            to="/stock-capture"
            clickable
            onClick={finish}
            icon={<PendingActionsRounded />}
            label={
              waitingToReview === 1
                ? "1 item ready to review"
                : `${String(waitingToReview)} items ready to review`
            }
            sx={{ position: "absolute", top: 68, left: "50%", transform: "translateX(-50%)" }}
          />
        )}

        {state.photos.length > 0 && stage.kind === "Framing" && (
          <Chip
            size="small"
            label={
              state.photos.length === 1
                ? "1 photo held"
                : `${String(state.photos.length)} photos held`
            }
            sx={{
              position: "absolute",
              bottom: 100,
              left: "50%",
              transform: "translateX(-50%)",
              bgcolor: "rgba(0,0,0,0.55)",
              color: "#FFFFFF",
            }}
          />
        )}

        {reading && (
          <Stack
            spacing={1.5}
            alignItems="center"
            sx={{
              position: "absolute",
              inset: 0,
              placeContent: "center",
              bgcolor: "rgba(0,0,0,0.45)",
            }}
          >
            <CircularProgress sx={{ color: "#FFFFFF" }} />
            <Typography role="status" aria-live="polite" sx={{ color: "#FFFFFF" }}>
              {stage.kind === "Looking" ? `Looking up ${stage.code}…` : "Reading the photo…"}
            </Typography>
          </Stack>
        )}

        {stage.kind === "Unidentified" && (
          <UnidentifiedPanel
            code={stage.code}
            photos={state.photos}
            onDiscardPhoto={discardPhoto}
            canAddItem={canAddItem}
            onAddItem={addAsNewItem}
            onAnotherAngle={() => reframe(true)}
            onRetake={() => reframe(false)}
          />
        )}

        {typing && stage.kind !== "Unidentified" && (
          <Paper
            elevation={0}
            component="form"
            onSubmit={handleManualSubmit}
            sx={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              p: 2,
              borderRadius: "16px 16px 0 0",
            }}
          >
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <TextField
                label="Item code or barcode"
                value={manualCode}
                onChange={(event) => setManualCode(event.target.value)}
                placeholder="ITM-0001 or a barcode"
                autoComplete="off"
                autoFocus
                fullWidth
                size="small"
              />
              <Button
                type="submit"
                variant="contained"
                disabled={manualCode.trim().length === 0 || reading}
              >
                Find
              </Button>
            </Stack>
          </Paper>
        )}

        {(problem !== null || state.notice !== null) && stage.kind === "Framing" && (
          <Alert
            severity="warning"
            sx={{ position: "absolute", left: 12, right: 12, bottom: 100 }}
            onClose={() => setProblem(null)}
          >
            {problem ?? state.notice}
          </Alert>
        )}
      </Viewfinder>
    </Dialog>
  );
}
