import FileDownloadRounded from "@mui/icons-material/FileDownloadRounded";
import ClearRounded from "@mui/icons-material/ClearRounded";
import {
  Box,
  Button,
  Chip,
  IconButton,
  InputAdornment,
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
  transactionKindLabels,
} from "../components/DataStates";

const PAGE_SIZE = 50;

/** Converts the human-facing UK date into an unambiguous UTC timestamp. */
function parseUkDate(value: string, endOfDay = false): string | undefined {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(value.trim());
  if (match === null) return undefined;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(
    Date.UTC(
      year,
      month - 1,
      day,
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 999 : 0,
    ),
  );

  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date.toISOString()
    : undefined;
}

function normaliseDateQuery(value: string | null): string {
  if (value === null) return "";
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  return isoMatch === null ? value : `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
}

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
  const from = normaliseDateQuery(searchParams.get("from"));
  const to = normaliseDateQuery(searchParams.get("to"));
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
    (limit: number, offset: number) => {
      const fromTimestamp = parseUkDate(from);
      const toTimestamp = parseUkDate(to, true);
      return {
        ...(deferredItemId.trim().length === 0 ? {} : { itemId: deferredItemId.trim() }),
        ...(actorUserId.length === 0 ? {} : { actorUserId }),
        ...(fromTimestamp === undefined ? {} : { from: fromTimestamp }),
        ...(toTimestamp === undefined ? {} : { to: toTimestamp }),
        limit,
        offset,
      };
    },
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
              "Action",
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
                transactionKindLabels[row.kind],
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
            ? "Nothing here can be edited or deleted. A mistake is put right with a new adjustment, so the original stays visible alongside the correction."
            : "Everything you have received, taken out, collected or reserved. Nothing here can be edited or deleted."
        }
        actions={
          <Button variant="outlined" startIcon={<FileDownloadRounded />} onClick={handleExport}>
            Export CSV
          </Button>
        }
      />

      <Paper variant="outlined" sx={{ mb: 2.5, p: { xs: 1.5, sm: 2 } }}>
        <Typography variant="subtitle2" sx={{ mb: 1.25, fontWeight: 800 }}>
          Narrow the list
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Search by the item code, name, barcode, or part number. Dates use
          <strong> dd/mm/yyyy</strong>.
        </Typography>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
          <TextField
            label="Item"
            value={itemId}
            onChange={(event) => setFilter("itemId", event.target.value)}
            placeholder="e.g. A2 Hex Bolt or ITM-0"
            helperText="Partial matches are supported"
            size="small"
            sx={{ flex: 2 }}
          />
          <TextField
            select
            label="Action"
            value={kind}
            onChange={(event) => setFilter("kind", event.target.value)}
            size="small"
            sx={{ flex: 1, minWidth: 140 }}
          >
            <MenuItem value="">Anything</MenuItem>
            {transactionKinds.map((option: TransactionKind) => (
              <MenuItem key={option} value={option}>
                {transactionKindLabels[option]}
              </MenuItem>
            ))}
          </TextField>
          {seesEveryone && (
            <TextField
              select
              label="Who"
              value={actorUserId}
              onChange={(event) => setFilter("actorUserId", event.target.value)}
              size="small"
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
            label="From date"
            value={from}
            onChange={(event) => setFilter("from", event.target.value)}
            placeholder="dd/mm/yyyy"
            size="small"
            slotProps={{
              htmlInput: { inputMode: "numeric", pattern: "[0-9/]*", "aria-label": "From date" },
              input: {
                endAdornment: from.length > 0 && (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      aria-label="Clear from date"
                      onClick={() => setFilter("from", "")}
                    >
                      <ClearRounded fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
            helperText={from.length > 0 && parseUkDate(from) === undefined ? "Use dd/mm/yyyy" : " "}
            sx={{ flex: 1, minWidth: 150 }}
          />
          <TextField
            label="To date"
            value={to}
            onChange={(event) => setFilter("to", event.target.value)}
            placeholder="dd/mm/yyyy"
            size="small"
            slotProps={{
              htmlInput: { inputMode: "numeric", pattern: "[0-9/]*", "aria-label": "To date" },
              input: {
                endAdornment: to.length > 0 && (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      aria-label="Clear to date"
                      onClick={() => setFilter("to", "")}
                    >
                      <ClearRounded fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
            helperText={
              to.length > 0 && parseUkDate(to, true) === undefined ? "Use dd/mm/yyyy" : " "
            }
            sx={{ flex: 1, minWidth: 150 }}
          />
        </Stack>
      </Paper>

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
                  <TableCell>Action</TableCell>
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
                      <Chip
                        label={transactionKindLabels[transaction.kind]}
                        size="small"
                        variant="outlined"
                      />
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
