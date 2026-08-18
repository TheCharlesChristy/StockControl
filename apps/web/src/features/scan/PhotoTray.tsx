import CloseRounded from "@mui/icons-material/CloseRounded";
import QrCode2Rounded from "@mui/icons-material/QrCode2Rounded";
import { Box, IconButton, Tooltip } from "@mui/material";
import type { ReactElement } from "react";

import type { CapturedPhoto } from "./photo-tray";

interface PhotoTrayProps {
  readonly photos: readonly CapturedPhoto[];
  readonly onDiscard: (ordinal: number) => void;
}

/**
 * The shots being held, shown at the point where the person decides what to do
 * with them. Small, because they have just seen each one full-screen; the job
 * here is only to say how many are about to be sent, and to let one go.
 */
export function PhotoTray({ photos, onDiscard }: PhotoTrayProps): ReactElement {
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
      {photos.map((photo) => (
        <Box key={photo.ordinal} sx={{ position: "relative", width: 64, height: 64 }}>
          <Box
            component="img"
            src={photo.previewUrl}
            alt={`Photo ${String(photo.ordinal)}`}
            sx={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              borderRadius: 1.5,
              border: "1px solid",
              borderColor: "divider",
            }}
          />
          {photo.localCodes.length > 0 && (
            /* The one piece of feedback that says the fast path worked without
             * anything being sent anywhere. */
            <Tooltip title="A code was read from this photo on this device">
              <Box
                sx={{
                  position: "absolute",
                  bottom: 2,
                  left: 2,
                  display: "grid",
                  placeItems: "center",
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  bgcolor: "success.main",
                  color: "success.contrastText",
                }}
              >
                <QrCode2Rounded sx={{ fontSize: 13 }} />
              </Box>
            </Tooltip>
          )}
          <IconButton
            size="small"
            aria-label={`Discard photo ${String(photo.ordinal)}`}
            onClick={() => onDiscard(photo.ordinal)}
            sx={{
              position: "absolute",
              top: -8,
              right: -8,
              width: 24,
              height: 24,
              bgcolor: "background.paper",
              border: "1px solid",
              borderColor: "divider",
              "&:hover": { bgcolor: "background.paper" },
            }}
          >
            <CloseRounded sx={{ fontSize: 15 }} />
          </IconButton>
        </Box>
      ))}
    </Box>
  );
}
