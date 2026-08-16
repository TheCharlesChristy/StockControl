import CloseRounded from "@mui/icons-material/CloseRounded";
import PendingActionsRounded from "@mui/icons-material/PendingActionsRounded";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  LinearProgress,
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

import { ApiError } from "../../api/ApiClient";
import { useApi, useResource } from "../../api/ApiContext";
import { useAuth } from "../../auth/AuthContext";
import { useCapability } from "../../auth/useCapability";
import { offerPhotosToCapture } from "../stock-capture/handoff";
import { createBarcodeProvider, type BarcodeProvider } from "./barcode/provider";
import { IdentifyPanel, NoCodeAdvice } from "./IdentifyPanel";
import {
  firstLocalCode,
  isAcceptedSource,
  nextOrdinals,
  revokePreviews,
  type CapturedPhoto,
} from "./photo-tray";
import { PhotoTray } from "./PhotoTray";
import { ReceiveScannedStock } from "./ReceiveScannedStock";
import { ScanResult } from "./ScanResult";
import {
  initialScanState,
  isListening,
  scanReducer,
  type ScanOutcome,
  type ScanSource,
} from "./scan-reducer";

type CameraState = "starting" | "scanning" | "unavailable";

export interface ScanSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /**
   * Where photographs go when somebody asks for them to be identified. The
   * capture page passes its own so that photographs taken inside an open
   * delivery join that batch; left out, they are handed to the capture page
   * through the handoff slot and it decides.
   */
  readonly onIdentifyPhotos?: (photos: readonly CapturedPhoto[]) => void;
  /** Off on the capture page, which is the queue — linking to it from itself
   *  would be a button that goes nowhere. */
  readonly showQueue?: boolean;
  /** Overrides the real decoder in tests, which have no camera. */
  readonly barcodeProvider?: BarcodeProvider;
}

const noMatchMessage = (code: string, caught: unknown): string =>
  caught instanceof ApiError && caught.status !== 404
    ? caught.message
    : `Nothing in the catalogue matches “${code}”.`;

/**
 * The one place in StockControl where you point a device at a thing.
 *
 * Scanning a label and photographing an item used to be separate features on
 * separate screens, which meant choosing between them before knowing which one
 * could answer the question. They are the same question. This sheet takes a
 * code from the camera, from a keyboard or handheld wand, or from a
 * photograph, and only when none of that identifies the item does assisted
 * capture appear — as an offer, to the roles allowed to accept it.
 *
 * Everything above that line happens on the device: the camera stream never
 * leaves it, and a photograph is decoded here. `IdentifyPanel` is the only
 * route by which any image is sent anywhere.
 */
export function ScanSheet({
  open,
  onClose,
  onIdentifyPhotos,
  showQueue = true,
  barcodeProvider,
}: ScanSheetProps): ReactElement {
  const api = useApi();
  const navigate = useNavigate();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const { features } = useAuth();
  const canManageStock = useCapability("manageStock");
  const canIdentify = features.stockCapture && canManageStock;

  const provider = useRef(barcodeProvider ?? createBarcodeProvider()).current;
  const [state, dispatch] = useReducer(scanReducer, initialScanState);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>("starting");
  const [manualCode, setManualCode] = useState("");
  const [receiving, setReceiving] = useState(false);
  const controlsRef = useRef<IScannerControls | null>(null);

  /*
   * The camera decodes many times a second. Without these, a label held in
   * frame would re-run the same lookup on every frame, and a decode arriving
   * after the person has already found the item would replace what they are
   * reading.
   */
  const listeningRef = useRef(true);
  const handledCodeRef = useRef<string | null>(null);
  const lookupInFlightRef = useRef(false);
  /**
   * The photographs this sheet is responsible for revoking. Emptied the moment
   * they are handed to the capture page, which owns their previews from then
   * on — revoking them here would blank its thumbnails mid-upload.
   */
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
      canIdentify && showQueue ? api.getOpenCaptureBatch(signal) : Promise.resolve(null),
    [api, canIdentify, showQueue],
  );
  const openBatch = useResource(loadOpenBatch);
  const waitingToReview = (openBatch.data?.sessions ?? []).filter(
    (session) => session.status === "ReviewReady",
  ).length;

  const stopCamera = useCallback((): void => {
    controlsRef.current?.stop();
    controlsRef.current = null;
  }, []);

  const finish = useCallback((): void => {
    stopCamera();
    revokePreviews(photosRef.current);
    handledCodeRef.current = null;
    setManualCode("");
    setReceiving(false);
    dispatch({ type: "StartOver" });
    onClose();
  }, [onClose, stopCamera]);

  const startOver = useCallback((): void => {
    revokePreviews(photosRef.current);
    handledCodeRef.current = null;
    setManualCode("");
    setReceiving(false);
    dispatch({ type: "StartOver" });
  }, []);

  /**
   * Turns whatever was read into the item it refers to. Our own labels encode
   * the item's URL, so a decoded same-origin link is followed rather than
   * looked up; anything else is treated as a code, which is what makes a
   * supplier barcode on the packaging work as well as our own label.
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
        dispatch({ type: "ItemFound", item, source });

        /* No decision to offer means no card to read: a role that can only
         * look at the item is taken straight to it, as it always was. */
        if (!canManageStock) {
          void navigate(`/inventory/${item.id}`);
          finish();
        }
      } catch (caught) {
        dispatch({ type: "LookupFailed", code, source, message: noMatchMessage(code, caught) });
      } finally {
        lookupInFlightRef.current = false;
      }
    },
    [api, canManageStock, finish, navigate],
  );

  /*
   * Read through a ref, never as a dependency. `resolve` closes over `onClose`,
   * which callers write inline, so listing it below would tear the camera down
   * and start it again on every render of whatever opened the sheet — and the
   * capture page re-renders every few seconds while it polls its queue.
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
     * code box below still working, and a handheld scanner typing into it. */
    void Promise.resolve()
      .then(() =>
        new BrowserMultiFormatReader().decodeFromConstraints(
          {
            video: {
              // Prefer a rear-facing camera on phones, but do not require one:
              // laptops normally only expose a user-facing webcam.
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          videoElement,
          (result) => {
            if (result === undefined || !listeningRef.current) return;
            const text = result.getText();
            /* A label sitting in frame decodes on every frame. Acting on each
             * one would hammer the lookup route with a code already answered. */
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
        if (!cancelled) {
          setCameraState("unavailable");
        }
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

  const handleFiles = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const files = [...(event.target.files ?? [])];
      event.target.value = "";
      if (files.length === 0) return;

      const existing = photosRef.current;
      const usable = files.filter((file) => isAcceptedSource(file.type));
      const accepted = usable.slice(0, CAPTURE_MAX_PHOTOS - existing.length);
      const ordinals = nextOrdinals(
        existing.map((photo) => photo.ordinal),
        accepted.length,
      );

      if (accepted.length < files.length) {
        dispatch({
          type: "FilesRejected",
          notice:
            usable.length < files.length
              ? "Some of those were not photographs, so they were left out."
              : `You can add at most ${String(CAPTURE_MAX_PHOTOS)} photographs.`,
        });
      }
      if (accepted.length === 0) return;

      dispatch({ type: "DecodeStarted" });

      void Promise.all(
        accepted.map(async (file, index): Promise<CapturedPhoto> => {
          const ordinal = ordinals[index] ?? index + 1;
          const localCodes = await provider
            .decode(file)
            .then((decoded) =>
              decoded.map((decodedCode) => ({
                value: decodedCode.value,
                symbology: decodedCode.symbology,
                imageOrdinal: ordinal,
                readerVersion: provider.readerVersion,
              })),
            )
            .catch(() => []);

          return {
            ordinal,
            file,
            previewUrl: URL.createObjectURL(file),
            sourceType: file.type,
            localCodes,
          };
        }),
      )
        .then((photos) => {
          dispatch({ type: "PhotosAdded", photos });

          const code = firstLocalCode(photos);
          if (code !== undefined) {
            void resolve(code.value, "photo");
            return;
          }

          /* Only once every photograph on the sheet has been read: an earlier
           * one may already have produced the answer. */
          if (firstLocalCode(existing) === undefined) {
            dispatch({ type: "NoCodeFound" });
          }
        })
        .finally(() => {
          dispatch({ type: "DecodeFinished" });
        });
    },
    [provider, resolve],
  );

  const removePhoto = useCallback((ordinal: number): void => {
    const photo = photosRef.current.find((entry) => entry.ordinal === ordinal);
    if (photo !== undefined) URL.revokeObjectURL(photo.previewUrl);
    dispatch({ type: "PhotoRemoved", ordinal });
  }, []);

  /** The opt-in, and the only path by which a photograph leaves the device. */
  const identify = useCallback((): void => {
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

  const openItem = (itemId: string): void => {
    void navigate(`/inventory/${itemId}`);
    finish();
  };

  const outcome: ScanOutcome = state.outcome;
  const settled = outcome.kind === "Found" || outcome.kind === "Received";
  const unmatchedFromPhoto = outcome.kind === "NoMatch" && outcome.source === "photo";
  const offerIdentification =
    state.photos.length > 0 && !state.decoding && (outcome.kind === "NoCode" || unmatchedFromPhoto);

  return (
    <>
      <Dialog open={open} onClose={finish} fullWidth maxWidth="xs" fullScreen={fullScreen}>
        <DialogTitle
          component="div"
          sx={{ display: "flex", alignItems: "center", gap: 1, pr: 1.5 }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography component="h2" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
              Scan an item
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Camera, code or photo — whichever you have
            </Typography>
          </Box>
          <IconButton onClick={finish} aria-label="Close">
            <CloseRounded />
          </IconButton>
        </DialogTitle>

        <DialogContent>
          <Stack spacing={2}>
            {settled ? (
              <ScanResult
                item={outcome.item}
                received={outcome.kind === "Received"}
                canAddStock={canManageStock}
                onOpen={() => openItem(outcome.item.id)}
                onAddStock={() => setReceiving(true)}
                onScanAnother={startOver}
              />
            ) : (
              <>
                <Box
                  sx={{
                    position: "relative",
                    borderRadius: 2,
                    overflow: "hidden",
                    bgcolor: "#000000",
                    aspectRatio: "4 / 3",
                    display: cameraState === "unavailable" ? "none" : "block",
                  }}
                >
                  <video
                    ref={setVideoElement}
                    autoPlay
                    muted
                    playsInline
                    aria-label="Camera preview"
                    style={{
                      display: "block",
                      width: "100%",
                      height: "100%",
                      /*
                       * Never mirrored. The camera this is pointed at is the
                       * rear one, and a mirrored preview shows every part
                       * number backwards — which is exactly what somebody is
                       * squinting at when the decode will not catch.
                       */
                      objectFit: "cover",
                    }}
                  />
                  {/* A frame to aim with, rather than a full-bleed black box
                   *  that gives no clue where to hold the label. */}
                  <Box
                    aria-hidden
                    sx={{
                      position: "absolute",
                      inset: "18% 12%",
                      border: "2px solid rgba(255,255,255,0.85)",
                      borderRadius: 2,
                    }}
                  />
                </Box>

                {cameraState === "starting" && (
                  <Typography variant="body2" color="text.secondary">
                    Starting the camera…
                  </Typography>
                )}

                {cameraState === "scanning" && (
                  <Typography variant="body2" color="text.secondary">
                    Hold a QR code or barcode inside the frame.
                  </Typography>
                )}

                {cameraState === "unavailable" && (
                  <Alert severity="info">
                    No camera is available here. Type or scan the code below instead — a handheld
                    scanner types into this box.
                  </Alert>
                )}

                {outcome.kind === "Looking" && (
                  <Box>
                    <LinearProgress />
                    <Typography variant="body2" color="text.secondary" role="status" sx={{ mt: 1 }}>
                      Looking up {outcome.code}…
                    </Typography>
                  </Box>
                )}

                <Box component="form" onSubmit={handleManualSubmit}>
                  <Stack direction="row" spacing={1} alignItems="flex-start">
                    <TextField
                      label="Item code or barcode"
                      value={manualCode}
                      onChange={(event) => setManualCode(event.target.value)}
                      placeholder="ITM-0001 or a barcode"
                      autoComplete="off"
                      autoFocus={cameraState === "unavailable"}
                      fullWidth
                      size="small"
                    />
                    <Button
                      type="submit"
                      variant="outlined"
                      disabled={manualCode.trim().length === 0 || outcome.kind === "Looking"}
                    >
                      Find
                    </Button>
                  </Stack>
                </Box>

                {outcome.kind === "NoMatch" && !unmatchedFromPhoto && (
                  <Alert severity="warning">{outcome.message}</Alert>
                )}

                <Divider>
                  <Typography variant="caption" color="text.secondary">
                    or use a photo
                  </Typography>
                </Divider>

                <PhotoTray
                  photos={state.photos}
                  decoding={state.decoding}
                  disabled={outcome.kind === "Looking"}
                  onFilesChosen={handleFiles}
                  onRemove={removePhoto}
                />

                {state.photos.length === 0 && (
                  <Typography variant="caption" color="text.secondary">
                    A photograph is read on this device to find a code in it. Nothing is sent
                    anywhere.
                  </Typography>
                )}

                {state.notice !== null && <Alert severity="warning">{state.notice}</Alert>}

                {offerIdentification &&
                  (canIdentify ? (
                    <IdentifyPanel
                      photoCount={state.photos.length}
                      unmatchedCode={unmatchedFromPhoto ? outcome.code : null}
                      onIdentify={identify}
                    />
                  ) : (
                    <NoCodeAdvice />
                  ))}

                {waitingToReview > 0 && (
                  <Button
                    component={RouterLink}
                    to="/stock-capture"
                    onClick={finish}
                    startIcon={<PendingActionsRounded />}
                    size="small"
                  >
                    {waitingToReview === 1
                      ? "1 photographed item is ready to review"
                      : `${String(waitingToReview)} photographed items are ready to review`}
                  </Button>
                )}
              </>
            )}
          </Stack>
        </DialogContent>
      </Dialog>

      {receiving && settled && (
        <ReceiveScannedStock
          item={outcome.item}
          onClose={() => setReceiving(false)}
          onReceived={(item) => {
            setReceiving(false);
            dispatch({ type: "StockReceived", item });
          }}
        />
      )}
    </>
  );
}
