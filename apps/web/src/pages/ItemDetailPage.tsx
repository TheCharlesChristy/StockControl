import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded";
import DeleteOutlineRounded from "@mui/icons-material/DeleteOutlineRounded";
import MoreHorizRounded from "@mui/icons-material/MoreHorizRounded";
import PhotoCameraRounded from "@mui/icons-material/PhotoCameraRounded";
import PrintRounded from "@mui/icons-material/PrintRounded";
import StarBorderRounded from "@mui/icons-material/StarBorderRounded";
import StarRounded from "@mui/icons-material/StarRounded";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Menu,
  MenuItem,
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
import type { ItemDetailView, ItemPhotoView, LocationView } from "@stockcontrol/contracts";
import { useCallback, useState, type ChangeEvent, type ReactElement } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";

import { useApi, useResource } from "../api/ApiContext";
import { useAuth } from "../auth/AuthContext";
import { useCapability } from "../auth/useCapability";
import { ApiError } from "../api/ApiClient";
import { CreateItemDialog } from "../components/CreateItemDialog";
import {
  ErrorState,
  formatDateTime,
  formatQuantity,
  LoadingRows,
  PageHeader,
  StatTile,
  transactionKindLabels,
} from "../components/DataStates";
import { ItemQrCode } from "../components/ItemQrCode";
import { ItemAvatar } from "../components/ItemAvatar";
import { ImagePreview } from "../components/ImagePreview";
import { isValidEan13, ItemBarcode } from "../components/ItemBarcode";
import { readImageFile } from "../components/photo-files";
import { StockOperationDialog, type StockOperation } from "../components/StockOperationDialog";
import { StockRequestDialog } from "../components/StockRequestDialog";
import { ItemLocationButton, ItemLocationDialog } from "./ItemLocationDialog";

function ItemPhotoGallery({
  item,
  canManage,
  onChanged,
}: {
  readonly item: ItemDetailView;
  readonly canManage: boolean;
  readonly onChanged: () => void;
}): ReactElement {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const upload = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length === 0) return;
    setBusy(true);
    setError(undefined);
    void (async (): Promise<void> => {
      const failures: string[] = [];
      for (const file of files) {
        try {
          const input = await readImageFile(file);
          await api.uploadItemPhoto(item.id, input);
        } catch (caught: unknown) {
          failures.push(
            caught instanceof ApiError
              ? caught.message
              : caught instanceof Error
                ? caught.message
                : `${file.name} could not be uploaded.`,
          );
        }
      }
      if (failures.length > 0) setError(failures.join(" "));
      onChanged();
    })().finally(() => setBusy(false));
  };

  const remove = (photo: ItemPhotoView): void => {
    setBusy(true);
    setError(undefined);
    void api
      .deleteItemPhoto(item.id, photo.id)
      .then(onChanged)
      .catch((caught: unknown) =>
        setError(caught instanceof ApiError ? caught.message : "Photo could not be removed."),
      )
      .finally(() => setBusy(false));
  };

  const setCover = (photo: ItemPhotoView): void => {
    setBusy(true);
    setError(undefined);
    void api
      .setItemPhotoCover(item.id, photo.id)
      .then(onChanged)
      .catch((caught: unknown) =>
        setError(caught instanceof ApiError ? caught.message : "Cover photo could not be changed."),
      )
      .finally(() => setBusy(false));
  };

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1.5}>
        <Box>
          <Typography variant="h3" component="h2">
            Photos
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {item.photos.length === 0
              ? "No photos yet."
              : `${String(item.photos.length)} of 10 photos`}
          </Typography>
        </Box>
        {canManage && item.photos.length < 10 && (
          <Button
            component="label"
            variant="outlined"
            startIcon={<PhotoCameraRounded />}
            disabled={busy}
          >
            Add photos
            <input hidden type="file" multiple accept="image/png,image/jpeg" onChange={upload} />
          </Button>
        )}
      </Stack>
      {error !== undefined && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}
      {item.photos.length > 0 && (
        <Stack direction="row" flexWrap="wrap" useFlexGap gap={2} sx={{ mt: 2 }}>
          {item.photos.map((photo) => (
            <Paper
              key={photo.id}
              variant="outlined"
              sx={{ width: { xs: "100%", sm: 190 }, overflow: "hidden" }}
            >
              <ImagePreview
                src={photo.url}
                alt={`${item.name} — ${photo.originalFileName}`}
                sx={{ display: "flex", width: "100%" }}
              >
                <Box
                  component="img"
                  src={photo.url}
                  alt={`${item.name} — ${photo.originalFileName}`}
                  sx={{
                    display: "block",
                    width: "100%",
                    height: 145,
                    objectFit: "cover",
                    bgcolor: "action.hover",
                  }}
                />
              </ImagePreview>
              <Stack spacing={0.75} sx={{ p: 1.25 }}>
                <Typography variant="caption" noWrap title={photo.originalFileName}>
                  {photo.originalFileName}
                </Typography>
                {photo.isCover ? (
                  <Typography
                    variant="caption"
                    color="primary.main"
                    sx={{ fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 0.5 }}
                  >
                    <StarRounded fontSize="inherit" /> Primary photo
                  </Typography>
                ) : canManage ? (
                  <Button
                    size="small"
                    startIcon={<StarBorderRounded />}
                    onClick={() => setCover(photo)}
                    disabled={busy}
                  >
                    Set as primary
                  </Button>
                ) : null}
                {canManage && (
                  <Button
                    size="small"
                    color="error"
                    startIcon={<DeleteOutlineRounded />}
                    onClick={() => remove(photo)}
                    disabled={busy}
                  >
                    Remove
                  </Button>
                )}
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}
    </Paper>
  );
}

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
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [moreActionsAnchor, setMoreActionsAnchor] = useState<HTMLElement | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [locationMapOpen, setLocationMapOpen] = useState(false);

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
    setActionError(null);
    void api
      .updateItem(data.id, { isActive: !data.isActive })
      .then(() => {
        setConfirmingArchive(false);
        return item.reload();
      })
      .catch((caught: unknown) => {
        setActionError(
          caught instanceof ApiError ? caught.message : "The item could not be updated.",
        );
      })
      .finally(() => setArchiving(false));
  };

  const closeMoreActions = (): void => {
    setMoreActionsAnchor(null);
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
            leading={<ItemAvatar name={data.name} photoUrl={data.coverPhotoUrl} size={56} />}
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
                <Box data-help-target="item-location">
                  <ItemLocationButton onClick={() => setLocationMapOpen(true)} />
                </Box>
                {canManageStock && (
                  <Button
                    variant="contained"
                    data-help-target="item-receive"
                    onClick={() => setOperation("receive")}
                  >
                    Receive
                  </Button>
                )}
                {canIssue && (
                  <Button
                    variant="outlined"
                    data-help-target="item-take"
                    onClick={() => setOperation("issue")}
                  >
                    Take from store
                  </Button>
                )}
                {canRequestStock && (
                  <Button
                    variant={canManageStock ? "outlined" : "contained"}
                    data-help-target="item-request"
                    onClick={() => setRequesting(true)}
                  >
                    Request stock
                  </Button>
                )}
                {(canManageStock || canManageCatalogue) && (
                  <>
                    <Button
                      variant="outlined"
                      data-help-target="item-more"
                      startIcon={<MoreHorizRounded />}
                      onClick={(event) => setMoreActionsAnchor(event.currentTarget)}
                      aria-haspopup="menu"
                      aria-expanded={moreActionsAnchor !== null}
                    >
                      More actions
                    </Button>
                    <Menu
                      anchorEl={moreActionsAnchor}
                      open={moreActionsAnchor !== null}
                      onClose={closeMoreActions}
                    >
                      {canManageStock && [
                        <MenuItem
                          key="transfer"
                          onClick={() => {
                            closeMoreActions();
                            setOperation("transfer");
                          }}
                        >
                          Transfer between stores
                        </MenuItem>,
                        <MenuItem
                          key="adjust"
                          onClick={() => {
                            closeMoreActions();
                            setOperation("adjust");
                          }}
                        >
                          Correct a counted quantity
                        </MenuItem>,
                      ]}
                      {canManageCatalogue && [
                        <MenuItem
                          key="edit"
                          onClick={() => {
                            closeMoreActions();
                            setEditing(true);
                          }}
                        >
                          Edit item details
                        </MenuItem>,
                        <MenuItem
                          key="archive"
                          onClick={() => {
                            closeMoreActions();
                            if (data.isActive) {
                              setConfirmingArchive(true);
                            } else {
                              toggleArchived();
                            }
                          }}
                          disabled={archiving}
                        >
                          {data.isActive ? "Archive item" : "Restore item"}
                        </MenuItem>,
                      ]}
                    </Menu>
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

          {actionError !== null && (
            <Alert severity="error" role="alert" sx={{ mb: 2.5 }} className="no-print">
              {actionError}
            </Alert>
          )}

          <Stack spacing={3}>
            <ItemPhotoGallery item={data} canManage={canManageCatalogue} onChanged={item.reload} />
            {/*
             * Five figures that only make sense in relation to each other, so
             * each says what it counts. Every one carries the unit: a row where
             * the first tile reads "677 ea" and the rest read "677" invites you
             * to read them as different things.
             */}
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <StatTile
                label="Total in stock"
                value={`${formatQuantity(data.onHand)} ${data.unit}`}
                caption="Everything, everywhere"
              />
              <StatTile
                label="In stores"
                value={`${formatQuantity(data.inStores)} ${data.unit}`}
                caption="Back at the stores"
              />
              <StatTile
                label="At job sites"
                value={`${formatQuantity(data.atJobSites)} ${data.unit}`}
                caption="Already collected to site"
              />
              <StatTile
                label="Committed to jobs"
                value={`${formatQuantity(data.reserved)} ${data.unit}`}
                caption="Reserved for a job, not yet moved"
              />
              <StatTile
                label="Ready to use"
                value={`${formatQuantity(data.available)} ${data.unit}`}
                tone={data.belowThreshold ? "warning" : "primary"}
                caption={
                  data.lowStockThreshold === null
                    ? "Free to take from stores"
                    : `Free to take · minimum ${formatQuantity(data.lowStockThreshold)}`
                }
              />
            </Stack>

            <Stack direction={{ xs: "column", md: "row" }} spacing={3} alignItems="flex-start">
              <Paper
                variant="outlined"
                data-help-target="item-stock-balances"
                sx={{ flex: 1, width: "100%" }}
                className="no-print"
              >
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
                          <TableCell>Type</TableCell>
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
                data-help-target="item-scan"
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

            <Paper variant="outlined" className="no-print" data-help-target="item-transactions">
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
                            <Chip
                              label={transactionKindLabels[transaction.kind]}
                              size="small"
                              variant="outlined"
                            />
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

          <ItemLocationDialog
            open={locationMapOpen}
            item={data}
            api={api}
            onClose={() => setLocationMapOpen(false)}
          />

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

          {/*
           * Archiving is undone by the Restore button next to it, so this is a
           * short question rather than a warning — but it sits one pixel from
           * Edit, and it stops the item being used, so it should not fire on a
           * misclick.
           */}
          <Dialog
            open={confirmingArchive}
            onClose={() => setConfirmingArchive(false)}
            fullWidth
            maxWidth="xs"
          >
            <DialogTitle>Archive {data.reference}?</DialogTitle>
            <DialogContent>
              <DialogContentText>
                It cannot be received, taken out or reserved while archived, and it drops out of the
                catalogue search. Its history is kept, and Restore brings it back.
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirmingArchive(false)} disabled={archiving}>
                Cancel
              </Button>
              <Button variant="contained" onClick={toggleArchived} disabled={archiving}>
                {archiving ? "Archiving…" : "Archive"}
              </Button>
            </DialogActions>
          </Dialog>
        </>
      )}
    </Box>
  );
}
