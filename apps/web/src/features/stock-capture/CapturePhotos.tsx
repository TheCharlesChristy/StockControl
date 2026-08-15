import AddAPhotoRounded from "@mui/icons-material/AddAPhotoRounded";
import DeleteRounded from "@mui/icons-material/DeleteRounded";
import PhotoLibraryRounded from "@mui/icons-material/PhotoLibraryRounded";
import { Alert, Box, Button, Card, CardMedia, IconButton, Stack, Typography } from "@mui/material";
import { CAPTURE_MAX_PHOTOS } from "@stockcontrol/contracts";
import { useCallback, useRef, useState, type ChangeEvent, type ReactElement } from "react";

import { createBarcodeProvider, type BarcodeProvider } from "./barcode/provider";
import { CaptureGuidance } from "./CaptureGuidance";
import type { CapturedPhoto } from "./capture-reducer";

/*
 * What a camera roll may offer is not the same list as what may be uploaded:
 * everything here is re-encoded to JPEG or WebP by `normaliseImage` before it
 * leaves the device, so the source format only has to be something the
 * browser can decode, and is never a `CaptureImageMediaType`.
 *
 * A phone is not obliged to tell the truth about a photograph it just took.
 * Android camera intents routinely hand back an empty `type`, and an iPhone
 * offering a library image from Files reports `image/heic`, which Safari can
 * decode perfectly well — the previous exact-match list rejected both, so the
 * photograph vanished with a message blaming its format. Anything the browser
 * claims is an image, or declines to describe at all, is now handed to the
 * decoder; `normaliseImage` re-encodes it to JPEG or WebP, and the server
 * checks magic bytes on what actually arrives regardless.
 */
const isAcceptedSource = (type: string): boolean => type === "" || type.startsWith("image/");

/**
 * The lowest ordinals still free, which is not the same as counting up from
 * the highest in use. Retaking a photograph frees its number, and minting
 * `max + 1` instead walked ordinals past `CAPTURE_MAX_PHOTOS` — a limit the
 * server enforces, so five retakes were enough to make every upload be
 * refused as `ordinal_out_of_range` with one photograph on screen.
 */
export const nextOrdinals = (taken: readonly number[], count: number): readonly number[] => {
  const used = new Set(taken);
  const free: number[] = [];

  for (let ordinal = 1; ordinal <= CAPTURE_MAX_PHOTOS && free.length < count; ordinal += 1) {
    if (!used.has(ordinal)) free.push(ordinal);
  }

  return free;
};

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
  const [scanning, setScanning] = useState(false);
  const [localMessage, setLocalMessage] = useState<string | null>(null);

  const handleFiles = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const files = [...(event.target.files ?? [])];
      event.target.value = "";

      if (files.length === 0) return;

      const budget = CAPTURE_MAX_PHOTOS - photos.length;
      const usable = files.filter((file) => isAcceptedSource(file.type));
      const accepted = usable.slice(0, budget);
      const ordinals = nextOrdinals(
        photos.map((photo) => photo.ordinal),
        accepted.length,
      );

      if (accepted.length < files.length) {
        setLocalMessage(
          usable.length < files.length
            ? "Some of those were not photographs, so they were left out."
            : `You can add at most ${String(CAPTURE_MAX_PHOTOS)} photographs.`,
        );
      } else {
        setLocalMessage(null);
      }

      setScanning(true);
      void Promise.all(
        accepted.map(async (file, index) => {
          const ordinal = ordinals[index] ?? index + 1;
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
            sourceType: file.type,
            localCodes,
          });
        }),
      ).finally(() => {
        setScanning(false);
      });
    },
    [onAddPhoto, photos, provider],
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

        {/*
         * Two inputs, because `capture` is not a hint: a phone given it opens
         * the camera and offers no way to reach a photograph already taken.
         * Section 5.1 step 3 allows either, so both are offered.
         */}
        {photos.length < CAPTURE_MAX_PHOTOS && (
          <Stack spacing={1} sx={{ width: 120 }}>
            <Button
              component="label"
              variant="outlined"
              startIcon={<AddAPhotoRounded />}
              disabled={scanning}
              sx={{ height: 74, flexDirection: "column", px: 1 }}
            >
              {scanning ? "Scanning…" : "Take a photo"}
              <input
                type="file"
                accept="image/*"
                multiple
                capture="environment"
                hidden
                onChange={handleFiles}
              />
            </Button>
            <Button
              component="label"
              startIcon={<PhotoLibraryRounded />}
              disabled={scanning}
              sx={{ height: 38, px: 1 }}
            >
              Choose
              <input type="file" accept="image/*" multiple hidden onChange={handleFiles} />
            </Button>
          </Stack>
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
