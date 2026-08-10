import AddAPhotoRounded from "@mui/icons-material/AddAPhotoRounded";
import {
  Alert,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import type {
  RecognitionSessionStatus,
  RecognitionSessionSummaryView,
  StockCaptureBatchView,
} from "@stockcontrol/contracts";
import type { ReactElement } from "react";

const statusLabels: Readonly<Record<RecognitionSessionStatus, string>> = {
  AwaitingUpload: "Uploading",
  Queued: "Queued",
  ProcessingBarcode: "Working",
  ProcessingImages: "Working",
  Enriching: "Working",
  Fusing: "Working",
  ReviewReady: "Ready to review",
  Committed: "Added",
  Failed: "Could not finish",
  Cancelled: "Cancelled",
  Expired: "Expired",
};

const terminalStatuses: ReadonlySet<RecognitionSessionStatus> = new Set([
  "Committed",
  "Cancelled",
  "Failed",
  "Expired",
]);

interface BatchSummaryProps {
  readonly batch: StockCaptureBatchView;
  readonly error: string | null;
  readonly finishing: boolean;
  readonly onStartNewItem: () => void;
  readonly onResumeSession: (session: RecognitionSessionSummaryView) => void;
  readonly onFinishBatch: () => void;
}

/**
 * The landing page for a batch, specification section 5: every item added so
 * far, and every session still in flight — the browser has nothing to lose by
 * navigating away and back, so this is always safe to return to.
 */
export function BatchSummary({
  batch,
  error,
  finishing,
  onStartNewItem,
  onResumeSession,
  onFinishBatch,
}: BatchSummaryProps): ReactElement {
  const unresolved = batch.sessions.filter((session) => !terminalStatuses.has(session.status));

  return (
    <Stack spacing={2.5}>
      <Typography variant="body1">
        {batch.committedEntryCount === 0
          ? "Nothing has been added to stock yet in this batch."
          : `${String(batch.committedEntryCount)} ${
              batch.committedEntryCount === 1 ? "item has" : "items have"
            } been added to stock in this batch.`}
      </Typography>

      {error !== null && <Alert severity="error">{error}</Alert>}

      {unresolved.length > 0 && (
        <Stack spacing={1.5}>
          <Typography variant="subtitle2">Still in progress</Typography>
          {unresolved.map((session) => (
            <Card key={session.id} variant="outlined">
              <CardActionArea onClick={() => onResumeSession(session)}>
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="body2">
                      {session.photoCount === 1
                        ? "1 photograph"
                        : `${String(session.photoCount)} photographs`}
                    </Typography>
                    <Chip size="small" label={statusLabels[session.status]} />
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Stack>
      )}

      <Stack direction="row" spacing={1.5} justifyContent="space-between">
        <Button variant="contained" startIcon={<AddAPhotoRounded />} onClick={onStartNewItem}>
          Add another item
        </Button>
        <Button onClick={onFinishBatch} disabled={finishing}>
          {finishing ? "Finishing…" : "Finish this batch"}
        </Button>
      </Stack>
    </Stack>
  );
}
