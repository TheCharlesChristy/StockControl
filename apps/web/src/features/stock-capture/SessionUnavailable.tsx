import { Alert, AlertTitle, Button, Stack, Typography } from "@mui/material";
import type { RecognitionSessionSummaryView } from "@stockcontrol/contracts";
import type { ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";

/*
 * The session carries a stable failure code the browser never used to read,
 * so every way of failing produced the same sentence. Which of these a person
 * sees decides whether photographing the item again is worth their time.
 */
const explanationFor = (session: RecognitionSessionSummaryView): string => {
  if (session.status === "Committed") {
    return "This item has already been added to stock. There is nothing left to confirm.";
  }

  if (session.status === "Expired") {
    return "This item waited too long to be recognised and has been cleared away. Its photographs were not kept.";
  }

  switch (session.failureCode) {
    case "capture.recognition_unavailable":
      return "The service that recognises photographs is not available at the moment. Photographs will not be read until it is back.";
    case "capture.upload_invalid":
      return "The photographs could not be read. A different shot — better lit, or closer to the label — usually works.";
    default:
      return "StockControl could not work out what this item is from these photographs.";
  }
};

const titleFor = (session: RecognitionSessionSummaryView): string => {
  if (session.status === "Committed") return "Already added";
  if (session.status === "Expired") return "This item expired";
  return "This item was not recognised";
};

interface SessionUnavailableProps {
  readonly session: RecognitionSessionSummaryView;
  readonly onRetry: () => void;
  readonly onCancel: () => void;
  readonly onBackToBatch: () => void;
}

/**
 * The end of the road for one item, and the two ways off it. Neither is
 * "enter it here": the server only accepts a receipt against a session that
 * reached review, so offering manual entry on this screen — as the previous
 * copy did — was an instruction that could not be followed.
 */
export function SessionUnavailable({
  session,
  onRetry,
  onCancel,
  onBackToBatch,
}: SessionUnavailableProps): ReactElement {
  const committed = session.status === "Committed";

  return (
    <Stack spacing={2.5}>
      <Alert severity={committed ? "info" : "warning"}>
        <AlertTitle>{titleFor(session)}</AlertTitle>
        {explanationFor(session)}
      </Alert>

      {!committed && (
        <Typography variant="body2" color="text.secondary">
          You can photograph it again, or add it straight from inventory without photographs.
        </Typography>
      )}

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        {!committed && (
          <Button variant="contained" onClick={onRetry}>
            Photograph it again
          </Button>
        )}
        <Button variant={committed ? "contained" : "outlined"} onClick={onBackToBatch}>
          Back to the queue
        </Button>
        {!committed && (
          <Button component={RouterLink} to="/inventory">
            Add it in inventory instead
          </Button>
        )}
        {!committed && <Button onClick={onCancel}>Remove from the queue</Button>}
      </Stack>
    </Stack>
  );
}
