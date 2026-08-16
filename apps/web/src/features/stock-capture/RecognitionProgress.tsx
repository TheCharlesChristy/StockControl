import {
  Alert,
  Button,
  LinearProgress,
  Step,
  StepLabel,
  Stepper,
  Stack,
  Typography,
} from "@mui/material";
import type { RecognitionSessionStatus } from "@stockcontrol/contracts";
import type { ReactElement } from "react";

const stageLabels: Readonly<Record<RecognitionSessionStatus, string>> = {
  AwaitingUpload: "Waiting for photographs to finish sending…",
  Queued: "Waiting its turn…",
  ProcessingBarcode: "Checking the upload and barcodes…",
  ProcessingImages: "Reading labels and image details…",
  Enriching: "Checking catalogue and web evidence…",
  Fusing: "Running photo analysis and preparing suggestions…",
  ReviewReady: "Suggestions ready.",
  Committed: "Already added.",
  Failed: "Recognition could not finish.",
  Cancelled: "Cancelled.",
  Expired: "Expired.",
};

const pipelineSteps = [
  { status: "Queued", label: "Waiting to start" },
  { status: "ProcessingBarcode", label: "Check upload and barcodes" },
  { status: "ProcessingImages", label: "Read labels and image details" },
  { status: "Enriching", label: "Check catalogue and web evidence" },
  { status: "Fusing", label: "Analyse the photo and prepare suggestions" },
] as const satisfies readonly {
  readonly status: RecognitionSessionStatus;
  readonly label: string;
}[];

const activeStepFor = (status: RecognitionSessionStatus): number => {
  if (status === "ReviewReady" || status === "Committed") return pipelineSteps.length;
  const index = pipelineSteps.findIndex((step) => step.status === status);
  return Math.max(index, 0);
};

/* Two in a row can be one bad moment on a stockroom's wifi. Three is a
 * pattern the person should be told about rather than left watching. */
const STALLED_AFTER_FAILURES = 3;

interface RecognitionProgressProps {
  readonly status: RecognitionSessionStatus;
  readonly checkFailures: number;
  readonly onCheckNow: () => void;
  readonly onQueueAnother: () => void;
  readonly onBackToQueue: () => void;
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
  onQueueAnother,
  onBackToQueue,
  onCancel,
}: RecognitionProgressProps): ReactElement {
  const stalled = checkFailures >= STALLED_AFTER_FAILURES;
  const activeStep = activeStepFor(status);

  return (
    <Stack spacing={2} alignItems="center" sx={{ py: 4 }}>
      <LinearProgress
        color={stalled ? "warning" : "primary"}
        sx={{ width: "100%", maxWidth: 360 }}
      />
      <Typography role="status" aria-live="polite">
        {stalled ? "StockControl cannot reach the server." : stageLabels[status]}
      </Typography>

      {!stalled && (
        <Stepper
          activeStep={activeStep}
          orientation="vertical"
          aria-label="Recognition pipeline"
          sx={{ width: "100%", maxWidth: 420 }}
        >
          {pipelineSteps.map((step, index) => (
            <Step key={step.status} completed={index < activeStep}>
              <StepLabel>{step.label}</StepLabel>
            </Step>
          ))}
        </Stepper>
      )}

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
          You can wait here or go back to the queue — this keeps working either way.
        </Typography>
      )}

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <Button variant="contained" onClick={onBackToQueue}>
          Back to the queue
        </Button>
        <Button variant="outlined" onClick={onQueueAnother}>
          Photograph another item
        </Button>
        <Button onClick={onCancel}>Cancel this item</Button>
      </Stack>
    </Stack>
  );
}
