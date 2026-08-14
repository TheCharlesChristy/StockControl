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
      return "The service that recognises photographs did not answer, and StockControl tried several times. This is not a problem with your photographs — nothing will be recognised until the service is back, so add the item from inventory for now and tell your administrator.";
    case "capture.upload_invalid":
      return "The photographs could not be read. A different shot — better lit, or closer to the label — usually works.";
    default:
      return "StockControl could not work out what this item is from these photographs.";
  }
};

const titleFor = (session: RecognitionSessionSummaryView): string => {
  if (session.status === "Committed") return "Already added";
  if (session.status === "Expired") return "This item expired";
  if (session.failureCode === "capture.recognition_unavailable") {
    return "The recognition service is not responding";
  }
  return "This item was not recognised";
};

/*
 * Which button carries the weight is the whole difference between these two
 * screens. A photograph that could not be read is fixed by taking a better
 * one; a recogniser that is down will refuse the next photograph exactly as it
 * refused this one, so offering that first sends a person round a loop the
 * software already knows is closed.
 */
const retryIsWorthwhile = (session: RecognitionSessionSummaryView): boolean =>
  session.failureCode !== "capture.recognition_unavailable";

interface SessionUnavailableProps {
  readonly session: RecognitionSessionSummaryView;
  readonly onRetry: () => void;
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
  onBackToBatch,
}: SessionUnavailableProps): ReactElement {
  const committed = session.status === "Committed";
  const retryFirst = retryIsWorthwhile(session);

  return (
    <Stack spacing={2.5}>
      <Alert severity={committed ? "info" : "warning"}>
        <AlertTitle>{titleFor(session)}</AlertTitle>
        {explanationFor(session)}
      </Alert>

      {!committed && (
        <Typography variant="body2" color="text.secondary">
          {retryFirst
            ? "You can photograph it again, or add it straight from inventory without photographs."
            : "Adding it from inventory takes the same details and does not need the recognition service."}
        </Typography>
      )}

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        {!committed && (
          <Button variant={retryFirst ? "contained" : "outlined"} onClick={onRetry}>
            Photograph it again
          </Button>
        )}
        <Button variant={committed ? "contained" : "outlined"} onClick={onBackToBatch}>
          Back to batch
        </Button>
        {!committed && (
          <Button
            component={RouterLink}
            to="/inventory"
            variant={retryFirst ? "text" : "contained"}
          >
            Add it in inventory instead
          </Button>
        )}
      </Stack>
    </Stack>
  );
}
