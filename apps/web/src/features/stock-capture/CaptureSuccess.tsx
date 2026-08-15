import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import { Alert, Box, Button, Paper, Stack, Typography } from "@mui/material";
import type { CommitCaptureEntryResponse, LocationView } from "@stockcontrol/contracts";
import type { ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";

import { formatQuantity } from "../../components/DataStates";

interface CaptureSuccessProps {
  readonly result: CommitCaptureEntryResponse;
  readonly locationId: string;
  readonly locations: readonly LocationView[];
  readonly onBackToBatch: () => void;
}

/**
 * Specification section 5.2 step 14: the item's reference and its new balance.
 * The commit response has carried the whole item all along; this screen used
 * to say only "Stock received", which leaves a person no way to tell a
 * successful receipt from one that landed against the wrong item.
 */
export function CaptureSuccess({
  result,
  locationId,
  locations,
  onBackToBatch,
}: CaptureSuccessProps): ReactElement {
  const location = locations.find((entry) => entry.id === locationId);
  const balance = result.item.balances.find((entry) => entry.locationId === locationId);

  return (
    <Stack spacing={2.5}>
      <Alert severity="success" icon={<CheckCircleRounded />}>
        {result.createdItem ? "New item created and stock received." : "Stock received."}
      </Alert>

      <Paper variant="outlined" role="group" aria-label="What was added" sx={{ p: 2.5 }}>
        <Stack spacing={1.25}>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 750 }}>
              {result.item.reference}
            </Typography>
            <Typography variant="h6" sx={{ lineHeight: 1.3 }}>
              {result.item.name}
            </Typography>
          </Box>
          <Typography variant="body2">
            Now on hand: <strong>{formatQuantity(result.item.onHand)}</strong> {result.item.unit}
          </Typography>
          {location !== undefined && (
            <Typography variant="body2" color="text.secondary">
              Received into {location.path === "" ? location.name : location.path}
              {balance === undefined
                ? ""
                : ` — ${formatQuantity(balance.quantity)} ${result.item.unit} there now`}
            </Typography>
          )}
        </Stack>
      </Paper>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <Button variant="contained" onClick={onBackToBatch}>
          Add another item
        </Button>
        <Button component={RouterLink} to={`/inventory/${result.item.id}`} variant="outlined">
          View this item
        </Button>
      </Stack>
    </Stack>
  );
}
