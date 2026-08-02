import CameraAltRounded from "@mui/icons-material/CameraAltRounded";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError } from "../api/ApiClient";
import { useApi } from "../api/ApiContext";

interface ScanDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

type CameraState = "starting" | "scanning" | "unavailable";

/**
 * Turns whatever a camera or a hardware scanner reads into the page it refers
 * to. Item labels encode the item's own URL, so a decoded same-origin link is
 * followed directly; anything else is treated as a code and looked up, which is
 * what makes a supplier barcode on the packaging work as well as our own label.
 *
 * The typed field is not a fallback afterthought — a warehouse scanner behaves
 * like a keyboard, so typing into it is the same journey.
 */
export function ScanDialog({ open, onClose }: ScanDialogProps): ReactElement {
  const api = useApi();
  const navigate = useNavigate();
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const scanInFlightRef = useRef(false);
  const [cameraState, setCameraState] = useState<CameraState>("starting");
  const [manualCode, setManualCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const stopCamera = useCallback((): void => {
    controlsRef.current?.stop();
    controlsRef.current = null;
  }, []);

  const finish = useCallback((): void => {
    stopCamera();
    setManualCode("");
    setMessage(null);
    onClose();
  }, [onClose, stopCamera]);

  /** A label encodes this application's own URL, so follow it rather than looking it up. */
  const resolve = useCallback(
    async (raw: string): Promise<void> => {
      const value = raw.trim();

      if (value.length === 0) {
        return;
      }

      setBusy(true);
      setMessage(null);

      try {
        if (/^https?:\/\//iu.test(value)) {
          const url = new URL(value);

          if (url.origin === window.location.origin) {
            stopCamera();
            navigate(`${url.pathname}${url.search}`);
            finish();
            return;
          }
        }

        const item = await api.lookupItem(value);

        stopCamera();
        navigate(`/inventory/${item.id}`);
        finish();
      } catch (error: unknown) {
        setMessage(
          error instanceof ApiError && error.status === 404
            ? `Nothing in the catalogue matches “${value}”.`
            : error instanceof ApiError
              ? error.message
              : `Nothing in the catalogue matches “${value}”.`,
        );
      } finally {
        setBusy(false);
      }
    },
    [api, finish, navigate, stopCamera],
  );

  useEffect(() => {
    if (!open || videoElement === null) {
      return undefined;
    }

    let cancelled = false;
    const reader = new BrowserMultiFormatReader();
    scanInFlightRef.current = false;

    void reader
      .decodeFromConstraints(
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
          if (result !== undefined && !scanInFlightRef.current) {
            scanInFlightRef.current = true;
            void resolve(result.getText()).finally(() => {
              scanInFlightRef.current = false;
            });
          }
        },
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
  }, [open, resolve, videoElement]);

  const handleManualSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void resolve(manualCode);
  };

  return (
    <Dialog open={open} onClose={finish} fullWidth maxWidth="xs">
      <DialogTitle>Find an item</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
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
                objectFit: "cover",
                transform: "scaleX(-1)",
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
              Point the camera at an item&rsquo;s QR code or barcode.
            </Typography>
          )}

          {cameraState === "unavailable" && (
            <Alert severity="info">
              No camera is available here. Type or scan the code below instead — a handheld scanner
              types into this box.
            </Alert>
          )}

          <Divider>or</Divider>

          <Box component="form" onSubmit={handleManualSubmit}>
            <Stack spacing={1.5}>
              <TextField
                label="Item code or barcode"
                value={manualCode}
                onChange={(event) => setManualCode(event.target.value)}
                placeholder="ITM-0001, a barcode or a part number"
                autoComplete="off"
                autoFocus={cameraState === "unavailable"}
                fullWidth
              />
              <Button type="submit" variant="contained" disabled={busy || manualCode.length === 0}>
                Find item
              </Button>
            </Stack>
          </Box>

          {message !== null && <Alert severity="warning">{message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={finish} startIcon={<CameraAltRounded />}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
