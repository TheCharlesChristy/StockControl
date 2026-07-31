import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Link,
  MenuItem,
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
import type { ItemSummaryView, JobDetailView, ReservationView } from "@stockcontrol/contracts";
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";

import { ApiError } from "../api/ApiClient";
import { useApi, useResource } from "../api/ApiContext";
import { useCapability } from "../auth/useCapability";
import {
  ErrorState,
  formatDateTime,
  formatQuantity,
  LoadingRows,
  PageHeader,
  StatTile,
  transactionKindLabels,
} from "../components/DataStates";

function asApiError(caught: unknown): ApiError {
  return caught instanceof ApiError
    ? caught
    : new ApiError(0, "network.unreachable", "Could not reach StockControl.");
}

/** Each dialog is mounted only while open, so no field ever needs resetting. */
function ReserveDialog({
  job,
  onClose,
  onDone,
}: {
  readonly job: JobDetailView;
  readonly onClose: () => void;
  readonly onDone: () => void;
}): ReactElement {
  const api = useApi();
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<readonly ItemSummaryView[]>([]);
  const [selected, setSelected] = useState<ItemSummaryView | null>(null);
  const [quantity, setQuantity] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();

    void api
      .listItems({ search, limit: 20 }, controller.signal)
      .then((result) => setOptions(result.rows))
      .catch(() => setOptions([]));

    return (): void => {
      controller.abort();
    };
  }, [api, search]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    if (selected === null) {
      return;
    }

    setSubmitting(true);
    setError(undefined);

    void api
      .reserve(job.id, { itemId: selected.id, quantity })
      .then(() => {
        onDone();
        onClose();
      })
      .catch((caught: unknown) => setError(asApiError(caught)))
      .finally(() => setSubmitting(false));
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Reserve stock for {job.number}</DialogTitle>
      <form onSubmit={handleSubmit} noValidate>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            {error !== undefined && !error.hasFieldErrors && (
              <Alert severity={error.isPermissionDenied ? "warning" : "error"} role="alert">
                {error.message}
              </Alert>
            )}
            <Autocomplete
              options={[...options]}
              value={selected}
              onChange={(_, next) => setSelected(next)}
              onInputChange={(_, next) => setSearch(next)}
              getOptionLabel={(option) => `${option.reference} — ${option.name}`}
              isOptionEqualToValue={(option, value) => option.id === value.id}
              renderOption={(props, option) => (
                <li {...props} key={option.id}>
                  <Box>
                    <Typography component="span" sx={{ fontWeight: 700 }}>
                      {option.reference}
                    </Typography>{" "}
                    {option.name}
                    <Typography variant="body2" color="text.secondary">
                      {formatQuantity(option.available)} {option.unit} available
                    </Typography>
                  </Box>
                </li>
              )}
              renderInput={(params) => (
                <TextField {...params} required autoFocus label="Item" disabled={submitting} />
              )}
            />
            <TextField
              required
              label="Quantity"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              disabled={submitting}
              inputMode="decimal"
              error={error?.fieldError("quantity") !== undefined}
              helperText={
                error?.fieldError("quantity") ??
                (selected === null
                  ? "Reserving reduces availability without moving anything."
                  : `${formatQuantity(selected.available)} ${selected.unit} available`)
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={submitting || selected === null}>
            {submitting ? "Reserving…" : "Reserve"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function CollectDialog({
  reservation,
  onClose,
  onDone,
}: {
  readonly reservation: ReservationView;
  readonly onClose: () => void;
  readonly onDone: () => void;
}): ReactElement {
  const api = useApi();
  const [sourceLocationId, setSourceLocationId] = useState("");
  /* Defaults to the whole remainder; a smaller collection is allowed. */
  const [quantity, setQuantity] = useState(formatQuantity(reservation.quantityOutstanding));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | undefined>(undefined);

  const loadItem = useCallback(
    (signal: AbortSignal) => api.getItem(reservation.itemId, signal),
    [api, reservation.itemId],
  );
  const item = useResource(loadItem);
  const stores = (item.data?.balances ?? []).filter(
    (balance) => balance.kind === "Store" && Number(balance.quantity) > 0,
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);

    void api
      .collect(reservation.id, { sourceLocationId, quantity })
      .then(() => {
        onDone();
        onClose();
      })
      .catch((caught: unknown) => setError(asApiError(caught)))
      .finally(() => setSubmitting(false));
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Collect stock</DialogTitle>
      <form onSubmit={handleSubmit} noValidate>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            <Typography variant="body2" color="text.secondary">
              {reservation.itemReference} — {reservation.itemName}.{" "}
              {formatQuantity(reservation.quantityOutstanding)} {reservation.unit} outstanding.
            </Typography>
            {error !== undefined && !error.hasFieldErrors && (
              <Alert severity={error.isPermissionDenied ? "warning" : "error"} role="alert">
                {error.message}
              </Alert>
            )}
            <TextField
              select
              required
              label="Collect from"
              value={sourceLocationId}
              onChange={(event) => setSourceLocationId(event.target.value)}
              disabled={submitting}
              error={error?.fieldError("sourceLocationId") !== undefined}
              helperText={error?.fieldError("sourceLocationId")}
            >
              {stores.length === 0 && (
                <MenuItem value="" disabled>
                  No store is holding this item
                </MenuItem>
              )}
              {stores.map((balance) => (
                <MenuItem key={balance.locationId} value={balance.locationId}>
                  {balance.locationCode} ({formatQuantity(balance.quantity)})
                </MenuItem>
              ))}
            </TextField>
            <TextField
              required
              label="Quantity"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              disabled={submitting}
              inputMode="decimal"
              error={error?.fieldError("quantity") !== undefined}
              helperText={
                error?.fieldError("quantity") ??
                "Collect part of it if you like — the rest stays reserved."
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={submitting}>
            {submitting ? "Collecting…" : "Collect"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function ReleaseDialog({
  reservation,
  onClose,
  onDone,
}: {
  readonly reservation: ReservationView;
  readonly onClose: () => void;
  readonly onDone: () => void;
}): ReactElement {
  const api = useApi();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | undefined>(undefined);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);

    void api
      .release(reservation.id, { reason })
      .then(() => {
        onDone();
        onClose();
      })
      .catch((caught: unknown) => setError(asApiError(caught)))
      .finally(() => setSubmitting(false));
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Release reservation</DialogTitle>
      <form onSubmit={handleSubmit} noValidate>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            <Typography variant="body2" color="text.secondary">
              Gives back the {formatQuantity(reservation.quantityOutstanding)} {reservation.unit}{" "}
              that has not been collected. Anything already collected stays at the job site.
            </Typography>
            {error !== undefined && !error.hasFieldErrors && (
              <Alert severity={error.isPermissionDenied ? "warning" : "error"} role="alert">
                {error.message}
              </Alert>
            )}
            <TextField
              required
              autoFocus
              multiline
              minRows={2}
              label="Reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={submitting}
              error={error?.fieldError("reason") !== undefined}
              helperText={error?.fieldError("reason") ?? "Recorded against your name."}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" color="warning" disabled={submitting}>
            {submitting ? "Releasing…" : "Release"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/**
 * Who is working this job. Assignment is what puts a job on somebody's Overview
 * and drives their "assigned to me" filter, so it is managed here rather than
 * buried in an edit form.
 */
function AssigneesPanel({
  job,
  canManage,
  onChanged,
}: {
  readonly job: JobDetailView;
  readonly canManage: boolean;
  readonly onChanged: () => void;
}): ReactElement {
  const api = useApi();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | undefined>(undefined);
  const loadUsers = useCallback(
    (signal: AbortSignal) => (adding ? api.listUsers(signal) : Promise.resolve(undefined)),
    [api, adding],
  );
  const users = useResource(loadUsers);
  const assignedIds = new Set(job.assignees.map((person) => person.userId));
  const candidates = (users.data?.users ?? []).filter(
    (person) => person.isActive && !assignedIds.has(person.id),
  );

  const change = (action: Promise<unknown>): void => {
    setBusy(true);
    setError(undefined);
    void action
      .then(() => {
        setAdding(false);
        onChanged();
      })
      .catch((caught: unknown) => setError(asApiError(caught)))
      .finally(() => setBusy(false));
  };

  return (
    <Paper variant="outlined">
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ px: 2.5, py: 2 }}
      >
        <Typography variant="h3" component="h2">
          Who is on this job
        </Typography>
        {canManage && job.status === "Open" && (
          <Button size="small" onClick={() => setAdding((open) => !open)}>
            {adding ? "Done" : "Assign someone"}
          </Button>
        )}
      </Stack>
      <Divider />
      <Box sx={{ px: 2.5, py: 2 }}>
        {error !== undefined && (
          <Alert severity="error" role="alert" sx={{ mb: 2 }}>
            {error.message}
          </Alert>
        )}

        {job.assignees.length === 0 ? (
          <Typography color="text.secondary">
            Nobody is assigned yet. Assigned people see this job on their Overview.
          </Typography>
        ) : (
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {job.assignees.map((person) => (
              <Chip
                key={person.userId}
                label={`${person.displayName} · ${person.role}`}
                variant="outlined"
                {...(canManage && job.status === "Open"
                  ? {
                      onDelete: () => change(api.unassignJob(job.id, person.userId)),
                      disabled: busy,
                    }
                  : {})}
              />
            ))}
          </Stack>
        )}

        {adding && (
          <Box sx={{ mt: 2, maxWidth: 360 }}>
            <TextField
              select
              fullWidth
              label="Add someone"
              value=""
              disabled={busy}
              onChange={(event) => change(api.assignJob(job.id, event.target.value))}
              helperText={
                candidates.length === 0 ? "Everyone active is already on this job." : undefined
              }
            >
              {candidates.map((person) => (
                <MenuItem key={person.id} value={person.id}>
                  {person.displayName} — {person.role}
                </MenuItem>
              ))}
            </TextField>
          </Box>
        )}
      </Box>
    </Paper>
  );
}

export function JobDetailPage(): ReactElement {
  const api = useApi();
  const { jobId = "" } = useParams<{ jobId: string }>();
  const canReserve = useCapability("reserve");
  const canCollect = useCapability("collect");
  const canRelease = useCapability("releaseReservation");
  const canManageJobs = useCapability("manageJobs");

  const [reserving, setReserving] = useState(false);
  const [collecting, setCollecting] = useState<ReservationView | null>(null);
  const [releasing, setReleasing] = useState<ReservationView | null>(null);
  const [closing, setClosing] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [closeError, setCloseError] = useState<ApiError | undefined>(undefined);

  const load = useCallback((signal: AbortSignal) => api.getJob(jobId, signal), [api, jobId]);
  const job = useResource(load);
  const data = job.data;

  const handleClose = (): void => {
    setClosing(true);
    setCloseError(undefined);

    void api
      .closeJob(jobId)
      .then(() => {
        setConfirmingClose(false);
        return job.reload();
      })
      .catch((caught: unknown) => setCloseError(asApiError(caught)))
      .finally(() => setClosing(false));
  };

  const openReservations = (data?.reservations ?? []).filter(
    (reservation) => reservation.status === "Open",
  );

  return (
    <Box>
      <Button component={RouterLink} to="/jobs" startIcon={<ArrowBackRounded />} sx={{ mb: 1.5 }}>
        Back to jobs
      </Button>

      {job.status === "error" && job.error !== undefined && (
        <ErrorState error={job.error} onRetry={job.reload} />
      )}

      {job.status === "loading" && data === undefined && <LoadingRows rows={8} />}

      {data !== undefined && (
        <>
          <PageHeader
            eyebrow={data.number}
            title={data.name}
            description={`${data.customer} · created ${formatDateTime(data.createdAt)}`}
            actions={
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                {data.status === "Open" && canReserve && (
                  <Button variant="contained" onClick={() => setReserving(true)}>
                    Reserve stock
                  </Button>
                )}
                {data.status === "Open" && canManageJobs && (
                  <Button
                    variant="outlined"
                    color="warning"
                    onClick={() => setConfirmingClose(true)}
                    disabled={closing}
                  >
                    {closing ? "Closing…" : "Close job"}
                  </Button>
                )}
              </Stack>
            }
          />

          <Stack spacing={3}>
            {closeError !== undefined && (
              <Alert severity="error" role="alert">
                {closeError.message}
              </Alert>
            )}

            {data.status === "Open" && data.jobSiteStock.length > 0 && (
              <Alert severity="info">
                {data.jobSiteStock.length} item
                {data.jobSiteStock.length === 1 ? " is" : "s are"} sitting at this job site. Closing
                the job releases uncollected reservations but leaves that stock where it is.
              </Alert>
            )}

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <StatTile
                label="Status"
                value={data.status}
                tone={data.status === "Open" ? "primary" : "neutral"}
                caption={data.closedAt === null ? undefined : `Closed ${formatDate(data.closedAt)}`}
              />
              <StatTile label="Open reservations" value={String(openReservations.length)} />
              <StatTile label="Items at site" value={String(data.jobSiteStock.length)} />
            </Stack>

            <AssigneesPanel job={data} canManage={canManageJobs} onChanged={job.reload} />

            <Paper variant="outlined">
              <Typography variant="h3" component="h2" sx={{ px: 2.5, py: 2 }}>
                Reservations
              </Typography>
              <Divider />
              {data.reservations.length === 0 ? (
                <Box sx={{ px: 2.5, py: 3 }}>
                  <Typography color="text.secondary">
                    Nothing has been reserved for this job yet.
                  </Typography>
                </Box>
              ) : (
                <TableContainer>
                  <Table size="small" aria-label="Reservations">
                    <TableHead>
                      <TableRow>
                        <TableCell>Item</TableCell>
                        <TableCell align="right">Reserved</TableCell>
                        <TableCell align="right">Collected</TableCell>
                        <TableCell align="right">Outstanding</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Reserved by</TableCell>
                        <TableCell align="right" />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.reservations.map((reservation) => (
                        <TableRow key={reservation.id}>
                          <TableCell>
                            <Link
                              component={RouterLink}
                              to={`/inventory/${reservation.itemId}`}
                              underline="hover"
                            >
                              {reservation.itemReference}
                            </Link>
                            <Typography variant="body2" color="text.secondary">
                              {reservation.itemName}
                            </Typography>
                          </TableCell>
                          {/*
                           * With the unit, because "127 · 50.8 · 76.2" on its
                           * own does not say whether those are metres or items,
                           * and the reservation has always carried it.
                           */}
                          <TableCell align="right">
                            {formatQuantity(reservation.quantityReserved)} {reservation.unit}
                          </TableCell>
                          <TableCell align="right">
                            {formatQuantity(reservation.quantityCollected)} {reservation.unit}
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 750 }}>
                            {formatQuantity(reservation.quantityOutstanding)} {reservation.unit}
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={reservation.status}
                              size="small"
                              variant="outlined"
                              color={reservation.status === "Open" ? "primary" : "default"}
                            />
                          </TableCell>
                          <TableCell>{reservation.createdByName}</TableCell>
                          <TableCell align="right">
                            {reservation.status === "Open" && (
                              <Stack direction="row" spacing={1} justifyContent="flex-end">
                                {canCollect && (
                                  <Button size="small" onClick={() => setCollecting(reservation)}>
                                    Collect
                                  </Button>
                                )}
                                {canRelease && (
                                  <Button
                                    size="small"
                                    color="warning"
                                    onClick={() => setReleasing(reservation)}
                                  >
                                    Release
                                  </Button>
                                )}
                              </Stack>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Paper>

            <Paper variant="outlined">
              <Typography variant="h3" component="h2" sx={{ px: 2.5, py: 2 }}>
                Stock at the job site
              </Typography>
              <Divider />
              {data.jobSiteStock.length === 0 ? (
                <Box sx={{ px: 2.5, py: 3 }}>
                  <Typography color="text.secondary">
                    Nothing has been collected onto this site.
                  </Typography>
                </Box>
              ) : (
                <TableContainer>
                  <Table size="small" aria-label="Stock at the job site">
                    <TableHead>
                      <TableRow>
                        <TableCell>Item</TableCell>
                        <TableCell align="right">Quantity</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.jobSiteStock.map((balance) => (
                        <TableRow key={`${balance.locationId}-${balance.locationName}`}>
                          <TableCell>{balance.locationName}</TableCell>
                          <TableCell align="right">
                            {formatQuantity(balance.quantity)}
                            {balance.unit === undefined ? "" : ` ${balance.unit}`}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Paper>

            <Paper variant="outlined">
              <Typography variant="h3" component="h2" sx={{ px: 2.5, py: 2 }}>
                Activity
              </Typography>
              <Divider />
              {data.recentTransactions.length === 0 ? (
                <Box sx={{ px: 2.5, py: 3 }}>
                  <Typography color="text.secondary">Nothing has happened yet.</Typography>
                </Box>
              ) : (
                <TableContainer>
                  <Table size="small" aria-label="Job activity">
                    <TableHead>
                      <TableRow>
                        <TableCell>When</TableCell>
                        <TableCell>What</TableCell>
                        <TableCell>Item</TableCell>
                        <TableCell align="right">Quantity</TableCell>
                        <TableCell>Who</TableCell>
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
                          <TableCell>{transaction.itemReference}</TableCell>
                          <TableCell align="right">
                            {formatQuantity(transaction.quantity)} {transaction.unit}
                          </TableCell>
                          <TableCell>{transaction.actorName}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Paper>
          </Stack>

          {reserving && (
            <ReserveDialog job={data} onClose={() => setReserving(false)} onDone={job.reload} />
          )}
          {collecting !== null && (
            <CollectDialog
              reservation={collecting}
              onClose={() => setCollecting(null)}
              onDone={job.reload}
            />
          )}
          {releasing !== null && (
            <ReleaseDialog
              reservation={releasing}
              onClose={() => setReleasing(null)}
              onDone={job.reload}
            />
          )}
          {/*
           * Releasing one reservation asks for a written reason; closing the job
           * releases every one of them at once. The larger act was the one with
           * no question attached, so it gets asked here — with the count, so the
           * consequence is a number rather than a warning.
           */}
          <Dialog
            open={confirmingClose}
            onClose={() => setConfirmingClose(false)}
            fullWidth
            maxWidth="xs"
          >
            <DialogTitle>Close {data.number}?</DialogTitle>
            <DialogContent>
              <DialogContentText>
                {openReservations.length === 0
                  ? "Nothing is still reserved against this job."
                  : `This releases ${String(openReservations.length)} uncollected reservation${
                      openReservations.length === 1 ? "" : "s"
                    } and gives that stock back to stores.`}
                {data.jobSiteStock.length > 0 &&
                  ` The ${String(data.jobSiteStock.length)} item${
                    data.jobSiteStock.length === 1 ? "" : "s"
                  } already collected stay at the job site.`}
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirmingClose(false)} disabled={closing}>
                Cancel
              </Button>
              <Button variant="contained" color="warning" onClick={handleClose} disabled={closing}>
                {closing ? "Closing…" : "Close job"}
              </Button>
            </DialogActions>
          </Dialog>
        </>
      )}
    </Box>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
