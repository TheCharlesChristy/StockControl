import {
  Alert,
  Box,
  Button,
  Card,
  CardMedia,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import type { ReactElement } from "react";

import type { CapturedPhoto } from "../scan/photo-tray";

interface SendingPhotosProps {
  readonly photos: readonly CapturedPhoto[];
  readonly submitting: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly onDiscard: () => void;
}

/**
 * The photographs somebody opted in to sending, while they are on their way.
 *
 * A failure here used to drop the person back on a photo picker holding
 * pictures they had already taken, as though the photographs were the problem.
 * They are not: the connection is. So the photographs stay on screen and the
 * only two honest choices are offered — send them again, or throw them away.
 */
export function SendingPhotos({
  photos,
  submitting,
  error,
  onRetry,
  onDiscard,
}: SendingPhotosProps): ReactElement {
  return (
    <Stack spacing={2.5}>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
        {photos.map((photo) => (
          <Card key={photo.ordinal} variant="outlined" sx={{ width: 108 }}>
            <CardMedia
              component="img"
              src={photo.previewUrl}
              alt={`Photograph ${String(photo.ordinal)}`}
              sx={{ height: 108, objectFit: "cover", opacity: submitting ? 0.6 : 1 }}
            />
          </Card>
        ))}
      </Box>

      {submitting ? (
        <Stack spacing={1} sx={{ maxWidth: 420 }}>
          <LinearProgress />
          <Typography role="status" aria-live="polite" variant="body2">
            Sending{" "}
            {photos.length === 1 ? "the photograph" : `${String(photos.length)} photographs`}…
          </Typography>
        </Stack>
      ) : (
        <Alert severity="error" role="alert">
          {error ?? "The photographs could not be sent."}
        </Alert>
      )}

      {!submitting && (
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          <Button variant="contained" onClick={onRetry}>
            Send them again
          </Button>
          <Button onClick={onDiscard}>Discard these photographs</Button>
        </Stack>
      )}
    </Stack>
  );
}
