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

const statusLabels: Readonly<Record<StatusFilter, string>> = {
  Pending: "Waiting",
  Approved: "Approved",
  Rejected: "Rejected",
  Cancelled: "Withdrawn",
  All: "All requests",
};

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
        title="Requests from the team"
        description="Approve the amount you can provide, or reject it with a reason. Requests for a named job become commitments when approved."
      />

      <TextField
        select
        label="Status"
        data-help-target="requests-status"
        value={status}
        onChange={(event) => setStatus(event.target.value as StatusFilter)}
        sx={{ mb: 2.5, minWidth: 200 }}
      >
        {STATUS_FILTERS.map((option) => (
          <MenuItem key={option} value={option}>
            {statusLabels[option]}
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
        <Paper variant="outlined" data-help-target="requests-list">
          <Stack>
            <StockRequestList requests={data.rows} canReview onChanged={requests.reload} />
          </Stack>
        </Paper>
      )}
    </Box>
  );
}
