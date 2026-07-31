import FileDownloadRounded from "@mui/icons-material/FileDownloadRounded";
import {
  Box,
  Button,
  Chip,
  Link,
  MenuItem,
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
import { transactionKinds, type TransactionKind } from "@stockcontrol/contracts";
import { useCallback, useDeferredValue, type ReactElement } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";

import { useApi, useResource } from "../api/ApiContext";
import { useCapability } from "../auth/useCapability";
import { downloadCsv, fetchAllRows, toCsv } from "../csv";
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
  const seesEveryone = useCapability("viewAllActivity");
  /*
   * Filters live in the URL so a filtered log can be shared, bookmarked, and
   * survives the back button — a link from an item lands here already narrowed.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const itemId = searchParams.get("itemId") ?? "";
  const kind = searchParams.get("kind") ?? "";
  const actorUserId = searchParams.get("actorUserId") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);

  const setFilter = (key: string, value: string): void => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);

        if (value.length === 0) {
          next.delete(key);
        } else {
          next.set(key, value);
        }

        /* Any filter change invalidates the page number. */
        if (key !== "page") {
          next.delete("page");
        }

        return next;
      },
      { replace: true },
    );
  };

  const loadPeople = useCallback(
    (signal: AbortSignal) => (seesEveryone ? api.listUsers(signal) : Promise.resolve(undefined)),
    [api, seesEveryone],
  );
  const people = useResource(loadPeople);

  const deferredItemId = useDeferredValue(itemId);
  const query = useCallback(
    (limit: number, offset: number) => ({
      ...(deferredItemId.trim().length === 0 ? {} : { itemId: deferredItemId.trim() }),
      ...(actorUserId.length === 0 ? {} : { actorUserId }),
      ...(from.length === 0 ? {} : { from: new Date(from).toISOString() }),
      ...(to.length === 0 ? {} : { to: new Date(`${to}T23:59:59`).toISOString() }),
      limit,
      offset,
    }),
    [deferredItemId, actorUserId, from, to],
  );

  const load = useCallback(
    (signal: AbortSignal) => api.listTransactions(query(PAGE_SIZE, (page - 1) * PAGE_SIZE), signal),
    [api, query, page],
  );
  const transactions = useResource(load);
  const data = transactions.data;
  const pageCount = data === undefined ? 1 : Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  /*
   * The kind filter is applied here rather than on the server: the log is
   * already narrowed by item, person and date, and adding a query parameter for
   * it would mean paging counts that disagree with the rows on screen.
   */
  const rows = (data?.rows ?? []).filter((row) => kind.length === 0 || row.kind === kind);

  const handleExport = (): void => {
    void fetchAllRows((limit, offset) => api.listTransactions(query(limit, offset))).then(
      (exported) => {
        downloadCsv(
          "stockcontrol-transactions.csv",
          toCsv(
            [
              "When",
              "What",
              "Item",
              "Name",
              "Quantity",
              "Unit",
              "From",
              "To",
              "Job",
              "Who",
              "Reason",
            ],
            exported
              .filter((row) => kind.length === 0 || row.kind === kind)
              .map((row) => [
                row.occurredAt,
                row.kind,
                row.itemReference,
                row.itemName,
                row.quantity,
                row.unit,
                row.fromLocationCode ?? "",
                row.toLocationCode ?? "",
                row.jobNumber ?? "",
                row.actorName,
                row.reason ?? "",
              ]),
          ),
        );
      },
    );
  };

  return (
    <Box>
      <PageHeader
        eyebrow="Transactions"
        title={seesEveryone ? "Every change, and who made it" : "Your activity"}
        description={
          seesEveryone
            ? "An append-only record. Mistakes are corrected with a new adjustment, never by editing history."
            : "Everything you have received, issued, collected or reserved. An append-only record — nothing here can be edited."
        }
        actions={
          <Button variant="outlined" startIcon={<FileDownloadRounded />} onClick={handleExport}>
            Export CSV
          </Button>
        }
      />

      <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ mb: 2.5 }}>
        <TextField
          label="Item"
          value={itemId}
          onChange={(event) => setFilter("itemId", event.target.value)}
          helperText="An item reference such as ITM-0001"
          sx={{ flex: 2 }}
        />
        <TextField
          select
          label="What"
          value={kind}
          onChange={(event) => setFilter("kind", event.target.value)}
          sx={{ flex: 1, minWidth: 140 }}
        >
          <MenuItem value="">Anything</MenuItem>
          {transactionKinds.map((option: TransactionKind) => (
            <MenuItem key={option} value={option}>
              {option}
            </MenuItem>
          ))}
        </TextField>
        {seesEveryone && (
          <TextField
            select
            label="Who"
            value={actorUserId}
            onChange={(event) => setFilter("actorUserId", event.target.value)}
            sx={{ flex: 1, minWidth: 160 }}
          >
            <MenuItem value="">Anyone</MenuItem>
            {(people.data?.users ?? []).map((person) => (
              <MenuItem key={person.id} value={person.id}>
                {person.displayName}
              </MenuItem>
            ))}
          </TextField>
        )}
        <TextField
          type="date"
          label="From"
          value={from}
          onChange={(event) => setFilter("from", event.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ flex: 1 }}
        />
        <TextField
          type="date"
          label="To"
          value={to}
          onChange={(event) => setFilter("to", event.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ flex: 1 }}
        />
      </Stack>

      {transactions.status === "error" && transactions.error !== undefined && (
        <ErrorState error={transactions.error} onRetry={transactions.reload} />
      )}

      {transactions.status === "loading" && data === undefined && <LoadingRows rows={10} />}

      {data !== undefined && rows.length === 0 && (
        <EmptyState
          title="No transactions match"
          description="Widen the date range, or clear the item and kind filters."
        />
      )}

      {data !== undefined && rows.length > 0 && (
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
                  {seesEveryone && <TableCell>Who</TableCell>}
                  <TableCell>Reason</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((transaction) => (
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
                    {seesEveryone && <TableCell>{transaction.actorName}</TableCell>}
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
                onChange={(_, next) => setFilter("page", String(next))}
                size="small"
              />
            )}
          </Stack>
        </Paper>
      )}
    </Box>
  );
}
