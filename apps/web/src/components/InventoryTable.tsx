import KeyboardArrowDownRounded from "@mui/icons-material/KeyboardArrowDownRounded";
import KeyboardArrowRightRounded from "@mui/icons-material/KeyboardArrowRightRounded";
import SearchRounded from "@mui/icons-material/SearchRounded";
import {
  Box,
  Chip,
  Collapse,
  IconButton,
  InputAdornment,
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
import type { ItemSummaryView } from "@stockcontrol/contracts";
import {
  useCallback,
  useDeferredValue,
  useImperativeHandle,
  useState,
  type ReactElement,
  type Ref,
} from "react";
import { Link as RouterLink } from "react-router-dom";

import { useApi, useResource } from "../api/ApiContext";
import { downloadCsv, fetchAllRows, toCsv } from "../csv";
import { EmptyState, ErrorState, formatQuantity, LoadingRows } from "./DataStates";

const PAGE_SIZE = 25;

export interface InventoryTableHandle {
  readonly reload: () => void;
  /** Exports every row matching the current search, not just the page shown. */
  readonly exportCsv: () => Promise<void>;
}

interface InventoryTableProps {
  /**
   * Whether to show the "reserved for you" column. It answers "how much of this
   * is already waiting for me", which only matters to the person doing the
   * collecting.
   */
  readonly showReservedForYou?: boolean;
  readonly handleRef?: Ref<InventoryTableHandle>;
}

interface ItemRowProps {
  readonly item: ItemSummaryView;
  readonly showReservedForYou: boolean;
  readonly columnCount: number;
}

function ItemRow({ item, showReservedForYou, columnCount }: ItemRowProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const api = useApi();
  /* Only fetches once the row is open, so a long list stays one request. */
  const load = useCallback(
    (signal: AbortSignal) => (expanded ? api.getItem(item.id, signal) : Promise.resolve(undefined)),
    [api, item.id, expanded],
  );
  const detail = useResource(load);

  return (
    <>
      <TableRow hover>
        <TableCell padding="checkbox">
          <IconButton
            size="small"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            aria-label={
              expanded
                ? `Hide locations for ${item.reference}`
                : `Show locations for ${item.reference}`
            }
          >
            {expanded ? <KeyboardArrowDownRounded /> : <KeyboardArrowRightRounded />}
          </IconButton>
        </TableCell>
        <TableCell sx={{ whiteSpace: "nowrap" }}>
          <Link component={RouterLink} to={`/inventory/${item.id}`} underline="hover">
            {item.reference}
          </Link>
        </TableCell>
        <TableCell sx={{ minWidth: { xs: 0, sm: 220 } }}>
          {item.name}
          {!item.isActive && (
            <Chip label="Archived" size="small" variant="outlined" sx={{ ml: 1 }} />
          )}
          {item.belowThreshold && (
            <Chip label="Low" size="small" color="warning" variant="outlined" sx={{ ml: 1 }} />
          )}
        </TableCell>
        <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" } }}>
          {formatQuantity(item.onHand)}
        </TableCell>
        <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" } }}>
          {formatQuantity(item.reserved)}
        </TableCell>
        {showReservedForYou && (
          <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
            {formatQuantity(item.reservedForYou)}
          </TableCell>
        )}
        <TableCell align="right" sx={{ fontWeight: 750, whiteSpace: "nowrap" }}>
          {formatQuantity(item.available)}{" "}
          <Box component="span" sx={{ display: { sm: "none" }, fontWeight: 400 }}>
            {item.unit}
          </Box>
        </TableCell>
        <TableCell sx={{ display: { xs: "none", sm: "table-cell" } }}>{item.unit}</TableCell>
      </TableRow>
      <TableRow>
        <TableCell
          colSpan={columnCount}
          sx={{ py: 0, borderBottom: expanded ? undefined : "none" }}
        >
          <Collapse in={expanded} unmountOnExit>
            <Box sx={{ py: 2, pl: { xs: 0, sm: 6 } }}>
              {detail.status === "loading" && <LoadingRows rows={2} label="Loading locations" />}
              {detail.data !== undefined && detail.data.balances.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  No stock is held anywhere for this item.
                </Typography>
              )}
              {detail.data !== undefined && detail.data.balances.length > 0 && (
                <Table size="small" aria-label={`Locations holding ${item.reference}`}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Location</TableCell>
                      <TableCell>Kind</TableCell>
                      <TableCell align="right">Quantity</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {detail.data.balances.map((balance) => (
                      <TableRow key={balance.locationId}>
                        <TableCell>
                          {balance.locationCode} — {balance.locationName}
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={balance.kind === "Store" ? "Store" : "Job site"}
                            size="small"
                            variant="outlined"
                            color={balance.kind === "Store" ? "default" : "secondary"}
                          />
                        </TableCell>
                        <TableCell align="right">
                          {formatQuantity(balance.quantity)} {item.unit}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

/**
 * The searchable stock list. It is the whole of an Engineer's Overview and the
 * body of the Inventory section, so it lives here rather than inside either
 * screen and fetches its own page of results.
 */
export function InventoryTable({
  showReservedForYou = false,
  handleRef,
}: InventoryTableProps): ReactElement {
  const api = useApi();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search);

  const load = useCallback(
    (signal: AbortSignal) =>
      api.listItems(
        { search: deferredSearch, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE },
        signal,
      ),
    [api, deferredSearch, page],
  );
  const items = useResource(load);

  const exportCsv = useCallback(async (): Promise<void> => {
    const rows = await fetchAllRows((limit, offset) =>
      api.listItems({ search: deferredSearch, limit, offset }),
    );

    downloadCsv(
      "stockcontrol-inventory.csv",
      toCsv(
        [
          "Item code",
          "Name",
          "Unit",
          "On hand",
          "In stores",
          "At job sites",
          "Reserved",
          "Available",
        ],
        rows.map((item) => [
          item.reference,
          item.name,
          item.unit,
          item.onHand,
          item.inStores,
          item.atJobSites,
          item.reserved,
          item.available,
        ]),
      ),
    );
  }, [api, deferredSearch]);

  useImperativeHandle(handleRef, () => ({ reload: items.reload, exportCsv }), [
    items.reload,
    exportCsv,
  ]);

  const data = items.data;
  const pageCount = data === undefined ? 1 : Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  /* Expander, ID, name, on hand, reserved, available, unit — plus the optional column. */
  const columnCount = showReservedForYou ? 8 : 7;

  return (
    <Box>
      <TextField
        fullWidth
        label="Search inventory"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
        }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchRounded fontSize="small" />
              </InputAdornment>
            ),
          },
        }}
        helperText="Search by item name, code, barcode or part number."
        sx={{ mb: 1 }}
      />

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
        Ready to use means stock in stores minus stock already committed to jobs.
      </Typography>

      {items.status === "error" && items.error !== undefined && (
        <ErrorState error={items.error} onRetry={items.reload} />
      )}

      {items.status === "loading" && data === undefined && <LoadingRows rows={8} />}

      {data !== undefined && data.rows.length === 0 && (
        <EmptyState
          title={search.length > 0 ? "Nothing matched that search" : "The catalogue is empty"}
          description={
            search.length > 0
              ? "Try part of an item name, its reference, or a barcode."
              : "Create your first item and receive some stock against it."
          }
        />
      )}

      {data !== undefined && data.rows.length > 0 && (
        <Paper variant="outlined">
          <TableContainer>
            {/* Tightened on a phone so the available figure stays on screen. */}
            <Table
              aria-label="Inventory"
              sx={{
                "& .MuiTableCell-root": {
                  px: { xs: 1, sm: 2 },
                },
              }}
            >
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" />
                  <TableCell sx={{ whiteSpace: "nowrap" }}>Item code</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" } }}>
                    Total in stock
                  </TableCell>
                  <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" } }}>
                    Committed to jobs
                  </TableCell>
                  {showReservedForYou && (
                    <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                      Committed for you
                    </TableCell>
                  )}
                  <TableCell align="right">Ready to use</TableCell>
                  <TableCell sx={{ display: { xs: "none", sm: "table-cell" } }}>Unit</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.rows.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    showReservedForYou={showReservedForYou}
                    columnCount={columnCount}
                  />
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
              {data.total} item{data.total === 1 ? "" : "s"}
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
