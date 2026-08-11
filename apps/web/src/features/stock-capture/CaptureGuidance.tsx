import InfoOutlined from "@mui/icons-material/InfoOutlined";
import { Alert, Stack, Typography } from "@mui/material";
import type { ReactElement } from "react";

/**
 * The whole of what a person is told before photographing an item (section
 * 5.1, step 3): the item should be visible, and extra angles or a label
 * close-up help. Deliberately not a required backdrop or frame — the model
 * pipeline is meant to cope with an ordinary stockroom photo.
 */
export function CaptureGuidance(): ReactElement {
  return (
    <Alert severity="info" icon={<InfoOutlined />}>
      <Stack spacing={0.5}>
        <Typography variant="body2">
          Photograph the item so it is clearly visible — one to five photos.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Extra angles or a close-up of a label or barcode usually help. There is no required
          background or frame.
        </Typography>
      </Stack>
    </Alert>
  );
}
