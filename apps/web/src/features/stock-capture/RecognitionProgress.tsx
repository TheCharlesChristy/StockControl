import { Button, LinearProgress, Stack, Typography } from "@mui/material";
import type { RecognitionSessionStatus } from "@stockcontrol/contracts";
import type { ReactElement } from "react";

const stageLabels: Readonly<Record<RecognitionSessionStatus, string>> = {
  AwaitingUpload: "Waiting for photographs to finish uploading…",
  Queued: "Queued for recognition…",
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

interface RecognitionProgressProps {
  readonly status: RecognitionSessionStatus;
  readonly onCancel: () => void;
}

/**
 * Durable status polling, specification section 10: the browser has nothing
 * to lose by navigating away and back, so this is just a label over the
 * session's own status — there is no separate client-side progress model to
 * keep in sync with it.
 */
export function RecognitionProgress({ status, onCancel }: RecognitionProgressProps): ReactElement {
  return (
    <Stack spacing={2} alignItems="center" sx={{ py: 4 }}>
      <LinearProgress sx={{ width: "100%", maxWidth: 360 }} />
      <Typography role="status" aria-live="polite">
        {stageLabels[status]}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        You can wait here or start capturing the next item — this one keeps working.
      </Typography>
      <Button onClick={onCancel}>Cancel this item</Button>
    </Stack>
  );
}
