import AddRounded from "@mui/icons-material/AddRounded";
import KeyboardArrowDownRounded from "@mui/icons-material/KeyboardArrowDownRounded";
import KeyboardArrowRightRounded from "@mui/icons-material/KeyboardArrowRightRounded";
import SearchRounded from "@mui/icons-material/SearchRounded";
import {
  Box,
  Button,
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
import { useCallback, useDeferredValue, useState, type ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";

import { useApi, useResource } from "../api/ApiContext";
import { useAuth } from "../auth/AuthContext";
import { useCapability } from "../auth/useCapability";
import { CreateItemDialog } from "../components/CreateItemDialog";
import {
  EmptyState,
  ErrorState,
  formatQuantity,
  LoadingRows,
  PageHeader,
} from "../components/DataStates";

const PAGE_SIZE = 25;

interface ItemRowProps {
  readonly item: ItemSummaryView;
}

function ItemRow({ item }: ItemRowProps): ReactElement {
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
        <TableCell align="right" sx={{ fontWeight: 750, whiteSpace: "nowrap" }}>
          {formatQuantity(item.available)}{" "}
          <Box component="span" sx={{ display: { sm: "none" }, fontWeight: 400 }}>
            {item.unit}
          </Box>
        </TableCell>
        <TableCell sx={{ display: { xs: "none", sm: "table-cell" } }}>{item.unit}</TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={7} sx={{ py: 0, borderBottom: expanded ? undefined : "none" }}>
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

export function InventoryPage(): ReactElement {
  const api = useApi();
  const { user } = useAuth();
  const canManageCatalogue = useCapability("manageCatalogue");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
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

  if (user === null) {
    return <LoadingRows />;
  }

  const data = items.data;
  const pageCount = data === undefined ? 1 : Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  return (
    <Box>
      <PageHeader
        eyebrow="Inventory"
        title="What you have, and where"
        description="Search by item ID, name, barcode or part number. Expand a row to see the per-location breakdown."
        actions={
          canManageCatalogue ? (
            <Button
              variant="contained"
              startIcon={<AddRounded />}
              onClick={() => setCreating(true)}
            >
              New item
            </Button>
          ) : undefined
        }
      />

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
        sx={{ mb: 2.5 }}
      />

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
                  <TableCell sx={{ whiteSpace: "nowrap" }}>Item ID</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" } }}>
                    On hand
                  </TableCell>
                  <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" } }}>
                    Reserved
                  </TableCell>
                  <TableCell align="right">Available</TableCell>
                  <TableCell sx={{ display: { xs: "none", sm: "table-cell" } }}>Unit</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.rows.map((item) => (
                  <ItemRow key={item.id} item={item} />
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

      {creating && (
        <CreateItemDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            items.reload();
          }}
        />
      )}
    </Box>
  );
}
