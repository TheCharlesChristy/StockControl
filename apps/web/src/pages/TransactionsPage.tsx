import {
  Box,
  Chip,
  Link,
  Pagination,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useDeferredValue, useState, type ReactElement } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";

import { useApi, useResource } from "../api/ApiContext";
import {
  EmptyState,
  ErrorState,
  formatDateTime,
  formatQuantity,
  LoadingRows,
  PageHeader,
} from "../components/DataStates";

const PAGE_SIZE = 50;

export function TransactionsPage(): ReactElement {
  const api = useApi();
  const [searchParams] = useSearchParams();
  const [itemId, setItemId] = useState(searchParams.get("itemId") ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  const deferredItemId = useDeferredValue(itemId);
  const load = useCallback(
    (signal: AbortSignal) =>
      api.listTransactions(
        {
          ...(deferredItemId.trim().length === 0 ? {} : { itemId: deferredItemId.trim() }),
          ...(from.length === 0 ? {} : { from: new Date(from).toISOString() }),
          ...(to.length === 0 ? {} : { to: new Date(`${to}T23:59:59`).toISOString() }),
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        },
        signal,
      ),
    [api, deferredItemId, from, to, page],
  );
  const transactions = useResource(load);
  const data = transactions.data;
  const pageCount = data === undefined ? 1 : Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  return (
    <Box>
      <PageHeader
        eyebrow="Transactions"
        title="Every change, and who made it"
        description="An append-only record. Mistakes are corrected with a new adjustment, never by editing history."
      />

      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2.5 }}>
        <TextField
          label="Item"
          value={itemId}
          onChange={(event) => {
            setItemId(event.target.value);
            setPage(1);
          }}
          helperText="An item reference such as ITM-0001"
          sx={{ flex: 2 }}
        />
        <TextField
          type="date"
          label="From"
          value={from}
          onChange={(event) => {
            setFrom(event.target.value);
            setPage(1);
          }}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ flex: 1 }}
        />
        <TextField
          type="date"
          label="To"
          value={to}
          onChange={(event) => {
            setTo(event.target.value);
            setPage(1);
          }}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ flex: 1 }}
        />
      </Stack>

      {transactions.status === "error" && transactions.error !== undefined && (
        <ErrorState error={transactions.error} onRetry={transactions.reload} />
      )}

      {transactions.status === "loading" && data === undefined && <LoadingRows rows={10} />}

      {data !== undefined && data.rows.length === 0 && (
        <EmptyState
          title="No transactions match"
          description="Widen the date range, or clear the item filter."
        />
      )}

      {data !== undefined && data.rows.length > 0 && (
        <Paper variant="outlined">
          <TableContainer>
            <Table aria-label="Transaction log">
              <TableHead>
                <TableRow>
                  <TableCell>When</TableCell>
                  <TableCell>What</TableCell>
                  <TableCell>Item</TableCell>
                  <TableCell align="right">Quantity</TableCell>
                  <TableCell>From</TableCell>
                  <TableCell>To</TableCell>
                  <TableCell>Job</TableCell>
                  <TableCell>Who</TableCell>
                  <TableCell>Reason</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.rows.map((transaction) => (
                  <TableRow key={transaction.id} hover>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      {formatDateTime(transaction.occurredAt)}
                    </TableCell>
                    <TableCell>
                      <Chip label={transaction.kind} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell sx={{ minWidth: 180 }}>
                      <Link
                        component={RouterLink}
                        to={`/inventory/${transaction.itemId}`}
                        underline="hover"
                      >
                        {transaction.itemReference}
                      </Link>
                      <Typography variant="body2" color="text.secondary">
                        {transaction.itemName}
                      </Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                      {formatQuantity(transaction.quantity)} {transaction.unit}
                    </TableCell>
                    <TableCell>{transaction.fromLocationCode ?? "—"}</TableCell>
                    <TableCell>{transaction.toLocationCode ?? "—"}</TableCell>
                    <TableCell>{transaction.jobNumber ?? "—"}</TableCell>
                    <TableCell>{transaction.actorName}</TableCell>
                    <TableCell sx={{ maxWidth: 220 }}>{transaction.reason ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            alignItems="center"
            justifyContent="space-between"
            sx={{ px: 2, py: 1.5 }}
          >
            <Typography variant="body2" color="text.secondary">
              {data.total} transaction{data.total === 1 ? "" : "s"}
            </Typography>
            {pageCount > 1 && (
              <Pagination
                count={pageCount}
                page={page}
                onChange={(_, next) => setPage(next)}
                size="small"
              />
            )}
          </Stack>
        </Paper>
      )}
    </Box>
  );
}
