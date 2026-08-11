import AddAPhotoRounded from "@mui/icons-material/AddAPhotoRounded";
import DeleteRounded from "@mui/icons-material/DeleteRounded";
import { Alert, Box, Button, Card, CardMedia, IconButton, Stack, Typography } from "@mui/material";
import { CAPTURE_MAX_PHOTOS, type CaptureImageMediaType } from "@stockcontrol/contracts";
import { useCallback, useRef, useState, type ChangeEvent, type ReactElement } from "react";

import { createBarcodeProvider, type BarcodeProvider } from "./barcode/provider";
import { CaptureGuidance } from "./CaptureGuidance";
import type { CapturedPhoto } from "./capture-reducer";

const ACCEPTED_MEDIA_TYPES: readonly CaptureImageMediaType[] = ["image/jpeg", "image/webp"];

const isCaptureMediaType = (type: string): type is CaptureImageMediaType =>
  (ACCEPTED_MEDIA_TYPES as readonly string[]).includes(type) || type === "image/png";

interface CapturePhotosProps {
  readonly photos: readonly CapturedPhoto[];
  readonly submitting: boolean;
  readonly error: string | null;
  readonly onAddPhoto: (photo: CapturedPhoto) => void;
  readonly onRemovePhoto: (ordinal: number) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
  readonly barcodeProvider?: BarcodeProvider;
}

/**
 * Photo capture and the barcode fast path, specification section 5.1 steps
 * 3-4. Barcode decoding runs on exactly the file the input produced — the
 * original resolution — before anything here would ever downscale it.
 */
export function CapturePhotos({
  photos,
  submitting,
  error,
  onAddPhoto,
  onRemovePhoto,
  onSubmit,
  onCancel,
  barcodeProvider,
}: CapturePhotosProps): ReactElement {
  const provider = useRef(barcodeProvider ?? createBarcodeProvider()).current;
  const inputRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [localMessage, setLocalMessage] = useState<string | null>(null);

  const nextOrdinal = photos.length === 0 ? 1 : Math.max(...photos.map((p) => p.ordinal)) + 1;

  const handleFiles = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const files = [...(event.target.files ?? [])];
      event.target.value = "";

      if (files.length === 0) return;

      const budget = CAPTURE_MAX_PHOTOS - photos.length;
      const accepted = files.filter((file) => isCaptureMediaType(file.type)).slice(0, budget);

      if (accepted.length < files.length) {
        setLocalMessage(
          budget <= 0
            ? `You can add at most ${String(CAPTURE_MAX_PHOTOS)} photographs.`
            : "Only JPEG or WebP photographs can be added.",
        );
      } else {
        setLocalMessage(null);
      }

      setScanning(true);
      void Promise.all(
        accepted.map(async (file, index) => {
          const ordinal = nextOrdinal + index;
          const localCodes = await provider
            .decode(file)
            .then((decoded) =>
              decoded.map((code) => ({
                value: code.value,
                symbology: code.symbology,
                imageOrdinal: ordinal,
                readerVersion: provider.readerVersion,
              })),
            )
            .catch(() => []);

          onAddPhoto({
            ordinal,
            file,
            previewUrl: URL.createObjectURL(file),
            mediaType: isCaptureMediaType(file.type) ? file.type : "image/jpeg",
            localCodes,
          });
        }),
      ).finally(() => {
        setScanning(false);
      });
    },
    [nextOrdinal, onAddPhoto, photos.length, provider],
  );

  const totalCodesFound = photos.reduce((sum, photo) => sum + photo.localCodes.length, 0);

  return (
    <Stack spacing={2}>
      <CaptureGuidance />

      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
        {photos.map((photo) => (
          <Card key={photo.ordinal} variant="outlined" sx={{ width: 120 }}>
            <CardMedia
              component="img"
              src={photo.previewUrl}
              alt={`Photograph ${String(photo.ordinal)}`}
              sx={{ height: 120, objectFit: "cover" }}
            />
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ p: 0.5 }}
            >
              <Typography variant="caption" color="text.secondary">
                {photo.localCodes.length > 0 ? "Barcode found" : `#${String(photo.ordinal)}`}
              </Typography>
              <IconButton
                size="small"
                aria-label={`Remove photograph ${String(photo.ordinal)}`}
                onClick={() => {
                  URL.revokeObjectURL(photo.previewUrl);
                  onRemovePhoto(photo.ordinal);
                }}
              >
                <DeleteRounded fontSize="small" />
              </IconButton>
            </Stack>
          </Card>
        ))}

        {photos.length < CAPTURE_MAX_PHOTOS && (
          <Button
            component="label"
            variant="outlined"
            startIcon={<AddAPhotoRounded />}
            disabled={scanning}
            sx={{ width: 120, height: 120, flexDirection: "column" }}
          >
            {scanning ? "Scanning…" : "Add photo"}
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/webp,image/png"
              multiple
              capture="environment"
              hidden
              onChange={handleFiles}
            />
          </Button>
        )}
      </Box>

      {localMessage !== null && <Alert severity="warning">{localMessage}</Alert>}
      {totalCodesFound > 0 && (
        <Alert severity="success">
          Found {totalCodesFound === 1 ? "a barcode" : `${String(totalCodesFound)} barcodes`}. If it
          matches one active item exactly, you can confirm it without waiting.
        </Alert>
      )}
      {error !== null && <Alert severity="error">{error}</Alert>}

      <Stack direction="row" spacing={1.5} justifyContent="flex-end">
        <Button onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={onSubmit}
          disabled={photos.length === 0 || submitting || scanning}
        >
          {submitting ? "Starting…" : "Continue"}
        </Button>
      </Stack>
    </Stack>
  );
}
