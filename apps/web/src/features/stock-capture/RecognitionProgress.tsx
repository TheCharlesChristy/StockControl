import { Alert, Button, LinearProgress, Stack, Typography } from "@mui/material";
import type { RecognitionSessionStatus } from "@stockcontrol/contracts";
import type { ReactElement } from "react";

const stageLabels: Readonly<Record<RecognitionSessionStatus, string>> = {
  AwaitingUpload: "Waiting for photographs to finish sending…",
  Queued: "Waiting its turn…",
  ProcessingBarcode: "Checking for a barcode…",
  ProcessingImages: "Reading the photographs…",
  Enriching: "Gathering evidence…",
  Fusing: "Weighing the evidence…",
  ReviewReady: "Suggestions ready.",
  Committed: "Already added.",
  Failed: "Recognition could not finish.",
  Cancelled: "Cancelled.",
  Expired: "Expired.",
};

/* Two in a row can be one bad moment on a stockroom's wifi. Three is a
 * pattern the person should be told about rather than left watching. */
const STALLED_AFTER_FAILURES = 3;

interface RecognitionProgressProps {
  readonly status: RecognitionSessionStatus;
  readonly checkFailures: number;
  readonly onCheckNow: () => void;
  readonly onCancel: () => void;
}

/**
 * Durable status polling, specification section 10: the browser has nothing
 * to lose by navigating away and back, so this is just a label over the
 * session's own status — there is no separate client-side progress model to
 * keep in sync with it.
 */
export function RecognitionProgress({
  status,
  checkFailures,
  onCheckNow,
  onCancel,
}: RecognitionProgressProps): ReactElement {
  const stalled = checkFailures >= STALLED_AFTER_FAILURES;

  return (
    <Stack spacing={2} alignItems="center" sx={{ py: 4 }}>
      <LinearProgress
        color={stalled ? "warning" : "primary"}
        sx={{ width: "100%", maxWidth: 360 }}
      />
      <Typography role="status" aria-live="polite">
        {stalled ? "StockControl cannot reach the server." : stageLabels[status]}
      </Typography>

      {stalled ? (
        <Alert
          severity="warning"
          sx={{ maxWidth: 480 }}
          action={
            <Button color="inherit" size="small" onClick={onCheckNow}>
              Check now
            </Button>
          }
        >
          This item is still being worked on and nothing has been lost. Check your connection — the
          page keeps trying on its own.
        </Alert>
      ) : (
        <Typography variant="body2" color="text.secondary">
          You can wait here or start capturing the next item — this one keeps working.
        </Typography>
      )}

      <Button onClick={onCancel}>Cancel this item</Button>
    </Stack>
  );
}
