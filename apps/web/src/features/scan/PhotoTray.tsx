import AddAPhotoRounded from "@mui/icons-material/AddAPhotoRounded";
import DeleteRounded from "@mui/icons-material/DeleteRounded";
import PhotoLibraryRounded from "@mui/icons-material/PhotoLibraryRounded";
import QrCode2Rounded from "@mui/icons-material/QrCode2Rounded";
import {
  Box,
  Button,
  Card,
  CardMedia,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { CAPTURE_MAX_PHOTOS } from "@stockcontrol/contracts";
import type { ChangeEvent, ReactElement } from "react";

import type { CapturedPhoto } from "./photo-tray";

interface PhotoTrayProps {
  readonly photos: readonly CapturedPhoto[];
  readonly decoding: boolean;
  readonly disabled: boolean;
  readonly onFilesChosen: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onRemove: (ordinal: number) => void;
}

/**
 * The photographs on the scan sheet, and the two ways to add one.
 *
 * Two inputs, because `capture` is not a hint: a phone given it opens the
 * camera and offers no way to reach a photograph already taken. Both are
 * offered, and the tray looks the same whichever the person used.
 */
export function PhotoTray({
  photos,
  decoding,
  disabled,
  onFilesChosen,
  onRemove,
}: PhotoTrayProps): ReactElement {
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.25 }}>
      {photos.map((photo) => (
        <Card key={photo.ordinal} variant="outlined" sx={{ width: 104, overflow: "hidden" }}>
          <Box sx={{ position: "relative" }}>
            <CardMedia
              component="img"
              src={photo.previewUrl}
              alt={`Photograph ${String(photo.ordinal)}`}
              sx={{ height: 84, objectFit: "cover" }}
            />
            {photo.localCodes.length > 0 && (
              /* The one piece of feedback that says the fast path worked
               * without anything being sent anywhere. */
              <Tooltip title="A code was read from this photograph on this device">
                <Box
                  sx={{
                    position: "absolute",
                    top: 4,
                    right: 4,
                    display: "grid",
                    placeItems: "center",
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    bgcolor: "success.main",
                    color: "success.contrastText",
                  }}
                >
                  <QrCode2Rounded sx={{ fontSize: 16 }} />
                </Box>
              </Tooltip>
            )}
          </Box>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            sx={{ px: 0.5 }}
          >
            <Typography variant="caption" color="text.secondary">
              #{photo.ordinal}
            </Typography>
            <IconButton
              size="small"
              aria-label={`Remove photograph ${String(photo.ordinal)}`}
              disabled={disabled}
              onClick={() => onRemove(photo.ordinal)}
            >
              <DeleteRounded fontSize="small" />
            </IconButton>
          </Stack>
        </Card>
      ))}

      {photos.length < CAPTURE_MAX_PHOTOS && (
        <Stack spacing={0.75} sx={{ width: 104 }}>
          <Button
            component="label"
            variant="outlined"
            size="small"
            startIcon={<AddAPhotoRounded />}
            disabled={decoding || disabled}
            sx={{ height: 62, flexDirection: "column", px: 0.5, lineHeight: 1.2 }}
          >
            {decoding ? "Reading…" : "Take a photo"}
            <input
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              hidden
              onChange={onFilesChosen}
            />
          </Button>
          <Button
            component="label"
            size="small"
            startIcon={<PhotoLibraryRounded />}
            disabled={decoding || disabled}
            sx={{ px: 0.5 }}
          >
            Choose
            <input type="file" accept="image/*" multiple hidden onChange={onFilesChosen} />
          </Button>
        </Stack>
      )}
    </Box>
  );
}
