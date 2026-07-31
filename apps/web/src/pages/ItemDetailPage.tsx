import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded";
import PrintRounded from "@mui/icons-material/PrintRounded";
import {
  Alert,
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
import { useAuth } from "../auth/AuthContext";
import { useCapability } from "../auth/useCapability";
import { CreateItemDialog } from "../components/CreateItemDialog";
import {
  ErrorState,
  formatDateTime,
  formatQuantity,
  LoadingRows,
  PageHeader,
  StatTile,
} from "../components/DataStates";
import { ItemQrCode } from "../components/ItemQrCode";
import { isValidEan13, ItemBarcode } from "../components/ItemBarcode";
import { StockOperationDialog, type StockOperation } from "../components/StockOperationDialog";
import { StockRequestDialog } from "../components/StockRequestDialog";

export function ItemDetailPage(): ReactElement {
  const api = useApi();
  const { user } = useAuth();
  const { itemId = "" } = useParams<{ itemId: string }>();
  const canManageStock = useCapability("manageStock");
  const canManageCatalogue = useCapability("manageCatalogue");
  const canIssue = useCapability("issue");
  const canRequestStock = useCapability("requestStock");
  const seesEveryonesActivity = useCapability("viewAllActivity");
  const [operation, setOperation] = useState<StockOperation | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const loadItem = useCallback((signal: AbortSignal) => api.getItem(itemId, signal), [api, itemId]);
  const loadLocations = useCallback((signal: AbortSignal) => api.listLocations(signal), [api]);
  const item = useResource(loadItem);
  const locations = useResource(loadLocations);

  const data = item.data;
  const locationList: readonly LocationView[] = locations.data?.locations ?? [];
  /* Engineers have no Inventory section, so their way back is the dashboard. */
  const backTo = user?.role === "Engineer" ? "/dashboard" : "/inventory";

  const handleCompleted = (updated: ItemDetailView): void => {
    void updated;
    item.reload();
  };

  const toggleArchived = (): void => {
    if (data === undefined) {
      return;
    }

    setArchiving(true);
    void api
      .updateItem(data.id, { isActive: !data.isActive })
      .then(() => item.reload())
      .finally(() => setArchiving(false));
  };

  return (
    <Box>
      <Button
        component={RouterLink}
        to={backTo}
        startIcon={<ArrowBackRounded />}
        sx={{ mb: 1.5 }}
        className="no-print"
      >
        {user?.role === "Engineer" ? "Back to overview" : "Back to inventory"}
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
                    Take out
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
                {canRequestStock && (
                  <Button
                    variant={canManageStock ? "outlined" : "contained"}
                    onClick={() => setRequesting(true)}
                  >
                    Request stock
                  </Button>
                )}
                {canManageCatalogue && (
                  <>
                    <Button variant="text" onClick={() => setEditing(true)}>
                      Edit
                    </Button>
                    <Button variant="text" onClick={toggleArchived} disabled={archiving}>
                      {data.isActive ? "Archive" : "Restore"}
                    </Button>
                  </>
                )}
              </Stack>
            }
          />

          {!data.isActive && (
            <Alert severity="info" sx={{ mb: 2.5 }} className="no-print">
              This item is archived. Its history is kept, but it cannot be received, taken out or
              reserved until it is restored.
            </Alert>
          )}

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
              <Paper variant="outlined" sx={{ flex: 1, width: "100%" }} className="no-print">
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
                <Box className="no-print">
                  <Typography variant="h3" component="h2" sx={{ mb: 2 }}>
                    Scan
                  </Typography>
                  <ItemQrCode reference={data.reference} url={window.location.href} />
                  {isValidEan13(data.barcode) && (
                    <Box sx={{ mt: 2, pt: 2, borderTop: "1px solid", borderColor: "divider" }}>
                      <Typography variant="caption" display="block" textAlign="center">
                        Barcode
                      </Typography>
                      <ItemBarcode value={data.barcode} />
                    </Box>
                  )}
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mt: 2, textAlign: "center" }}
                  >
                    Point a phone camera at the QR code or barcode to identify this item.
                  </Typography>
                  <Button
                    fullWidth
                    variant="outlined"
                    startIcon={<PrintRounded />}
                    onClick={() => window.print()}
                    sx={{ mt: 2 }}
                  >
                    Print label
                  </Button>
                </Box>
                <Box
                  className="print-only"
                  sx={{ display: "none" }}
                  aria-label="Printable item label"
                >
                  <Typography component="p" className="print-name">
                    {data.name}
                  </Typography>
                  <Typography component="p" className="print-reference">
                    {data.reference}
                  </Typography>
                  <Box className="print-qr">
                    <ItemQrCode
                      reference={data.reference}
                      url={window.location.href}
                      size={166}
                      showReference={false}
                    />
                  </Box>
                  {isValidEan13(data.barcode) && (
                    <Box className="print-barcode">
                      <ItemBarcode value={data.barcode} />
                    </Box>
                  )}
                </Box>
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
                  {seesEveryonesActivity ? "Recent transactions" : "Your activity on this item"}
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
                    {seesEveryonesActivity
                      ? "Nothing has moved for this item yet."
                      : "You have not moved any of this item yet."}
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
                        {seesEveryonesActivity && <TableCell>Who</TableCell>}
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
                          {seesEveryonesActivity && <TableCell>{transaction.actorName}</TableCell>}
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

          {requesting && (
            <StockRequestDialog
              item={data}
              onClose={() => setRequesting(false)}
              onCreated={() => {
                setRequesting(false);
                item.reload();
              }}
            />
          )}

          {editing && (
            <CreateItemDialog
              item={data}
              onClose={() => setEditing(false)}
              onCreated={() => {
                setEditing(false);
                item.reload();
              }}
            />
          )}
        </>
      )}
    </Box>
  );
}
