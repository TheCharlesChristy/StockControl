import AddAPhotoRounded from "@mui/icons-material/AddAPhotoRounded";
import AutoAwesomeRounded from "@mui/icons-material/AutoAwesomeRounded";
import LockOutlined from "@mui/icons-material/LockOutlined";
import ReplayRounded from "@mui/icons-material/ReplayRounded";
import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import type { ReactElement } from "react";

import type { CapturedPhoto } from "./photo-tray";
import { PhotoTray } from "./PhotoTray";

interface UnidentifiedPanelProps {
  /** What was read but matched nothing, or null when the photo held no code. */
  readonly code: string | null;
  readonly photos: readonly CapturedPhoto[];
  readonly onDiscardPhoto: (ordinal: number) => void;
  /** Whether this person may send photos for identification: Office and Admin,
   *  where the installation has assisted capture switched on. */
  readonly canAddItem: boolean;
  readonly onAddItem: () => void;
  readonly onAnotherAngle: () => void;
  readonly onRetake: () => void;
}

/**
 * What the sheet says when it could not work out what it is looking at.
 *
 * A match needs no screen — the sheet leaves for the item's page. This is the
 * other half, and it exists to make the dead end into a question: yes, this is
 * something new, add it.
 *
 * Answering yes is also the opt-in. Photos taken here are read on the device,
 * which is how the barcode path costs nothing and discloses nothing; sending
 * them to be identified is a different act, so it is never a side effect of
 * taking a photo and never remembered between scans. This button is the only
 * route to it, and it is offered only to a role the server would accept.
 */
export function UnidentifiedPanel({
  code,
  photos,
  onDiscardPhoto,
  canAddItem,
  onAddItem,
  onAnotherAngle,
  onRetake,
}: UnidentifiedPanelProps): ReactElement {
  const photoCount = photos.length;
  const hasPhotos = photoCount > 0;
  const one = photoCount === 1;

  return (
    <Paper
      elevation={0}
      sx={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        p: 2.5,
        borderRadius: "16px 16px 0 0",
        maxHeight: "100%",
        overflowY: "auto",
      }}
    >
      <Stack spacing={1.75}>
        <Box>
          <Typography variant="h4" component="p">
            Not recognised
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {code === null
              ? "No barcode or QR code was found in that photo."
              : `Nothing in the catalogue uses “${code}”.`}
          </Typography>
        </Box>

        {photoCount > 1 && <PhotoTray photos={photos} onDiscard={onDiscardPhoto} />}

        {canAddItem ? (
          <>
            <Typography variant="body2">
              {hasPhotos
                ? "Is it something new? StockControl can read your photo to work out what it is — you can still match it to an item already in the catalogue before anything changes in stock."
                : "Take a photo of it and StockControl can work out what it is."}
            </Typography>

            {hasPhotos && (
              <Stack direction="row" spacing={1} alignItems="flex-start">
                <LockOutlined fontSize="small" color="action" sx={{ mt: 0.25 }} />
                <Typography variant="caption" color="text.secondary">
                  {one
                    ? "Nothing has left this device. Choosing this sends the photo to StockControl to be identified."
                    : `Nothing has left this device. Choosing this sends all ${String(photoCount)} photos to StockControl to be identified.`}
                </Typography>
              </Stack>
            )}

            <Stack spacing={1}>
              <Button
                variant="contained"
                size="large"
                startIcon={hasPhotos ? <AutoAwesomeRounded /> : <AddAPhotoRounded />}
                onClick={hasPhotos ? onAddItem : onAnotherAngle}
              >
                {hasPhotos ? "Add this as a new item" : "Photograph it"}
              </Button>
              {hasPhotos && (
                <Stack direction="row" spacing={1}>
                  <Button
                    fullWidth
                    startIcon={<AddAPhotoRounded />}
                    onClick={onAnotherAngle}
                    /* Extra angles are the one thing that reliably improves a
                     * recognition result, and the moment to offer them is
                     * before the photos are sent, not after. */
                  >
                    Another angle
                  </Button>
                  <Button fullWidth startIcon={<ReplayRounded />} onClick={onRetake}>
                    Start again
                  </Button>
                </Stack>
              )}
            </Stack>
          </>
        ) : (
          <>
            <Typography variant="body2">
              {code === null
                ? "A closer, better-lit shot of the label usually reads. An office user can add an item StockControl does not know about."
                : "An office user can add an item StockControl does not know about."}
            </Typography>
            <Button
              variant="contained"
              size="large"
              startIcon={<ReplayRounded />}
              onClick={onRetake}
            >
              Try again
            </Button>
          </>
        )}
      </Stack>
    </Paper>
  );
}
