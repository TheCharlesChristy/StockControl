import { Box, MenuItem, Paper, Stack, TextField } from "@mui/material";
import type { StockRequestStatus } from "@stockcontrol/contracts";
import { stockRequestStatuses } from "@stockcontrol/contracts";
import { useCallback, useState, type ReactElement } from "react";

import { useApi, useResource } from "../api/ApiContext";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "../components/DataStates";
import { StockRequestList } from "../components/StockRequestList";

type StatusFilter = StockRequestStatus | "All";

const STATUS_FILTERS: readonly StatusFilter[] = [
  "Pending",
  ...stockRequestStatuses.slice(1),
  "All",
];

/**
 * The review queue. Pending sits first because a request waiting on a decision
 * is the only kind anybody has to act on.
 */
export function RequestsPage(): ReactElement {
  const api = useApi();
  const [status, setStatus] = useState<StatusFilter>("Pending");

  const load = useCallback(
    (signal: AbortSignal) =>
      api.listStockRequests(
        { ...(status === "All" ? {} : { status }), limit: 100, offset: 0 },
        signal,
      ),
    [api, status],
  );
  const requests = useResource(load);
  const data = requests.data;

  return (
    <Box>
      <PageHeader
        eyebrow="Stock requests"
        title="What people have asked for"
        description="Approving a request that names a job reserves the stock against it. Turning one down needs a reason, so the person who asked knows why."
      />

      <TextField
        select
        label="Status"
        value={status}
        onChange={(event) => setStatus(event.target.value as StatusFilter)}
        sx={{ mb: 2.5, minWidth: 200 }}
      >
        {STATUS_FILTERS.map((option) => (
          <MenuItem key={option} value={option}>
            {option}
          </MenuItem>
        ))}
      </TextField>

      {requests.status === "error" && requests.error !== undefined && (
        <ErrorState error={requests.error} onRetry={requests.reload} />
      )}

      {requests.status === "loading" && data === undefined && <LoadingRows rows={5} />}

      {data !== undefined && data.rows.length === 0 && (
        <EmptyState
          title={status === "Pending" ? "Nothing is waiting" : "No requests match that filter"}
          description="Engineers raise requests from an item's page. They appear here as soon as they do."
        />
      )}

      {data !== undefined && data.rows.length > 0 && (
        <Paper variant="outlined">
          <Stack>
            <StockRequestList requests={data.rows} canReview onChanged={requests.reload} />
          </Stack>
        </Paper>
      )}
    </Box>
  );
}
