import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded";
import PrintRounded from "@mui/icons-material/PrintRounded";
import {
  Box,
  Button,
  Chip,
  Divider,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import type { ItemDetailView, LocationView } from "@stockcontrol/contracts";
import { useCallback, useState, type ReactElement } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";

import { useApi, useResource } from "../api/ApiContext";
import { useCapability } from "../auth/useCapability";
import {
  ErrorState,
  formatDateTime,
  formatQuantity,
  LoadingRows,
  PageHeader,
  StatTile,
} from "../components/DataStates";
import { ItemQrCode } from "../components/ItemQrCode";
import { StockOperationDialog, type StockOperation } from "../components/StockOperationDialog";

export function ItemDetailPage(): ReactElement {
  const api = useApi();
  const { itemId = "" } = useParams<{ itemId: string }>();
  const canManageStock = useCapability("manageStock");
  const canIssue = useCapability("issue");
  const [operation, setOperation] = useState<StockOperation | null>(null);

  const loadItem = useCallback((signal: AbortSignal) => api.getItem(itemId, signal), [api, itemId]);
  const loadLocations = useCallback((signal: AbortSignal) => api.listLocations(signal), [api]);
  const item = useResource(loadItem);
  const locations = useResource(loadLocations);

  const data = item.data;
  const locationList: readonly LocationView[] = locations.data?.locations ?? [];

  const handleCompleted = (updated: ItemDetailView): void => {
    void updated;
    item.reload();
  };

  return (
    <Box>
      <Button
        component={RouterLink}
        to="/inventory"
        startIcon={<ArrowBackRounded />}
        sx={{ mb: 1.5 }}
        className="no-print"
      >
        Back to inventory
      </Button>

      {item.status === "error" && item.error !== undefined && (
        <ErrorState error={item.error} onRetry={item.reload} />
      )}

      {item.status === "loading" && data === undefined && <LoadingRows rows={8} />}

      {data !== undefined && (
        <>
          <PageHeader
            eyebrow={data.reference}
            title={data.name}
            description={[
              data.barcode === null ? undefined : `Barcode ${data.barcode}`,
              data.partNumber === null ? undefined : `Part ${data.partNumber}`,
            ]
              .filter((part) => part !== undefined)
              .join(" · ")}
            actions={
              // Wraps onto a second line rather than pushing the page wider: a
              // role with all four operations does not fit one row on a phone.
              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                flexWrap="wrap"
                justifyContent={{ xs: "flex-start", sm: "flex-end" }}
                className="no-print"
              >
                {canManageStock && (
                  <Button variant="contained" onClick={() => setOperation("receive")}>
                    Receive
                  </Button>
                )}
                {canIssue && (
                  <Button variant="outlined" onClick={() => setOperation("issue")}>
                    Issue
                  </Button>
                )}
                {canManageStock && (
                  <>
                    <Button variant="outlined" onClick={() => setOperation("transfer")}>
                      Transfer
                    </Button>
                    <Button variant="outlined" onClick={() => setOperation("adjust")}>
                      Adjust
                    </Button>
                  </>
                )}
              </Stack>
            }
          />

          <Stack spacing={3}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <StatTile label="On hand" value={`${formatQuantity(data.onHand)} ${data.unit}`} />
              <StatTile label="In stores" value={formatQuantity(data.inStores)} />
              <StatTile label="At job sites" value={formatQuantity(data.atJobSites)} />
              <StatTile label="Reserved" value={formatQuantity(data.reserved)} />
              <StatTile
                label="Available"
                value={formatQuantity(data.available)}
                tone={data.belowThreshold ? "warning" : "primary"}
                caption={
                  data.lowStockThreshold === null
                    ? undefined
                    : `Threshold ${formatQuantity(data.lowStockThreshold)}`
                }
              />
            </Stack>

            <Stack direction={{ xs: "column", md: "row" }} spacing={3} alignItems="flex-start">
              <Paper variant="outlined" sx={{ flex: 1, width: "100%" }}>
                <Typography variant="h3" component="h2" sx={{ px: 2.5, py: 2 }}>
                  Where it is
                </Typography>
                <Divider />
                {data.balances.length === 0 ? (
                  <Box sx={{ px: 2.5, py: 3 }}>
                    <Typography color="text.secondary">
                      No stock is held anywhere for this item yet.
                    </Typography>
                  </Box>
                ) : (
                  <TableContainer>
                    <Table size="small" aria-label="Stock by location">
                      <TableHead>
                        <TableRow>
                          <TableCell>Location</TableCell>
                          <TableCell>Kind</TableCell>
                          <TableCell align="right">Quantity</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {data.balances.map((balance) => (
                          <TableRow key={balance.locationId}>
                            <TableCell>
                              <strong>{balance.locationCode}</strong>
                              <Typography variant="body2" color="text.secondary">
                                {balance.locationName}
                              </Typography>
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
                              {formatQuantity(balance.quantity)} {data.unit}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </Paper>

              <Paper
                variant="outlined"
                className="print-label"
                sx={{ p: 3, width: { xs: "100%", md: 260 }, flexShrink: 0 }}
              >
                <Typography variant="h3" component="h2" sx={{ mb: 2 }}>
                  Scan
                </Typography>
                <ItemQrCode reference={data.reference} url={window.location.href} />
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 2, textAlign: "center" }}
                  className="no-print"
                >
                  Point a phone camera at this to open the item.
                </Typography>
                <Button
                  fullWidth
                  variant="outlined"
                  startIcon={<PrintRounded />}
                  onClick={() => window.print()}
                  sx={{ mt: 2 }}
                  className="no-print"
                >
                  Print label
                </Button>
              </Paper>
            </Stack>

            <Paper variant="outlined" className="no-print">
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ px: 2.5, py: 2 }}
              >
                <Typography variant="h3" component="h2">
                  Recent transactions
                </Typography>
                <Button
                  component={RouterLink}
                  to={`/transactions?itemId=${encodeURIComponent(data.reference)}`}
                  size="small"
                >
                  See the full log
                </Button>
              </Stack>
              <Divider />
              {data.recentTransactions.length === 0 ? (
                <Box sx={{ px: 2.5, py: 3 }}>
                  <Typography color="text.secondary">
                    Nothing has moved for this item yet.
                  </Typography>
                </Box>
              ) : (
                <TableContainer>
                  <Table size="small" aria-label="Recent transactions">
                    <TableHead>
                      <TableRow>
                        <TableCell>When</TableCell>
                        <TableCell>What</TableCell>
                        <TableCell align="right">Quantity</TableCell>
                        <TableCell>From</TableCell>
                        <TableCell>To</TableCell>
                        <TableCell>Who</TableCell>
                        <TableCell>Reason</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.recentTransactions.map((transaction) => (
                        <TableRow key={transaction.id}>
                          <TableCell sx={{ whiteSpace: "nowrap" }}>
                            {formatDateTime(transaction.occurredAt)}
                          </TableCell>
                          <TableCell>
                            <Chip label={transaction.kind} size="small" variant="outlined" />
                          </TableCell>
                          <TableCell align="right">
                            {formatQuantity(transaction.quantity)}
                          </TableCell>
                          <TableCell>{transaction.fromLocationCode ?? "—"}</TableCell>
                          <TableCell>{transaction.toLocationCode ?? "—"}</TableCell>
                          <TableCell>{transaction.actorName}</TableCell>
                          <TableCell>{transaction.reason ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Paper>
          </Stack>

          {operation !== null && (
            <StockOperationDialog
              operation={operation}
              item={data}
              locations={locationList}
              onClose={() => setOperation(null)}
              onCompleted={handleCompleted}
            />
          )}
        </>
      )}
    </Box>
  );
}
