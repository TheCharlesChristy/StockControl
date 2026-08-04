import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded";
import DeleteOutlineRounded from "@mui/icons-material/DeleteOutlineRounded";
import PhotoCameraRounded from "@mui/icons-material/PhotoCameraRounded";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControlLabel,
  Link,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { passwordPolicy, userRoles, type UserRole, type UserView } from "@stockcontrol/contracts";
import { useCallback, useState, type ChangeEvent, type FormEvent, type ReactElement } from "react";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";

import { ApiError } from "../api/ApiClient";
import { useApi, useResource } from "../api/ApiContext";
import { useAuth } from "../auth/AuthContext";
import {
  ErrorState,
  formatDateTime,
  formatQuantity,
  LoadingRows,
  PageHeader,
  StatTile,
} from "../components/DataStates";
import { ItemAvatar } from "../components/ItemAvatar";
import { ImagePreview } from "../components/ImagePreview";
import { StockRequestList } from "../components/StockRequestList";
import { readImageFile } from "../components/photo-files";

function asApiError(caught: unknown): ApiError {
  return caught instanceof ApiError
    ? caught
    : new ApiError(0, "network.unreachable", "Could not reach StockControl.");
}

/** Editable identity and access for one person. */
function DetailsForm({
  user,
  isSelf,
  onSaved,
}: {
  readonly user: UserView;
  readonly isSelf: boolean;
  readonly onSaved: () => void;
}): ReactElement {
  const api = useApi();
  const [email, setEmail] = useState(user.email);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [role, setRole] = useState<UserRole>(user.role);
  const [isActive, setIsActive] = useState(user.isActive);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<ApiError | undefined>(undefined);

  const uploadPhoto = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined) return;
    setSaving(true);
    setError(undefined);
    void readImageFile(file)
      .then((input) => api.uploadProfilePhoto(user.id, input))
      .then(() => onSaved())
      .catch((caught: unknown) => setError(asApiError(caught)))
      .finally(() => setSaving(false));
  };

  const removePhoto = (): void => {
    setSaving(true);
    setError(undefined);
    void api
      .deleteProfilePhoto(user.id)
      .then(() => onSaved())
      .catch((caught: unknown) => setError(asApiError(caught)))
      .finally(() => setSaving(false));
  };

  const handleSave = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(undefined);

    void api
      .updateUser(user.id, { email, displayName, role, isActive })
      .then(() => {
        setSaved(true);
        onSaved();
      })
      .catch((caught: unknown) => setError(asApiError(caught)))
      .finally(() => setSaving(false));
  };

  return (
    <Paper variant="outlined" data-help-target="user-details-form">
      <Typography variant="h3" component="h2" sx={{ px: 2.5, py: 2 }}>
        Details
      </Typography>
      <Divider />
      <Box component="form" onSubmit={handleSave} sx={{ px: 2.5, py: 2.5 }} noValidate>
        <Stack spacing={2.5} sx={{ maxWidth: 480 }}>
          {error !== undefined && !error.hasFieldErrors && (
            <Alert severity={error.isPermissionDenied ? "warning" : "error"} role="alert">
              {error.message}
            </Alert>
          )}
          {saved && <Alert severity="success">Saved.</Alert>}

          <Stack direction="row" spacing={2} alignItems="center">
            <ImagePreview src={user.profilePhotoUrl} alt={`${user.displayName} profile photo`}>
              <Avatar
                src={user.profilePhotoUrl ?? undefined}
                alt={`${user.displayName} profile photo`}
                sx={{ width: 64, height: 64 }}
              >
                {user.displayName
                  .split(" ")
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((part) => part.charAt(0).toUpperCase())
                  .join("")}
              </Avatar>
            </ImagePreview>
            <Stack direction="row" spacing={1}>
              <Button
                component="label"
                variant="outlined"
                startIcon={<PhotoCameraRounded />}
                disabled={saving}
              >
                Choose photo
                <input hidden type="file" accept="image/png,image/jpeg" onChange={uploadPhoto} />
              </Button>
              {user.profilePhotoUrl !== null && (
                <Button color="error" onClick={removePhoto} disabled={saving}>
                  Remove
                </Button>
              )}
            </Stack>
          </Stack>

          <TextField
            required
            type="email"
            label="Work email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={saving}
            error={error?.fieldError("email") !== undefined}
            helperText={error?.fieldError("email")}
          />
          <TextField
            required
            label="Name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            disabled={saving}
            error={error?.fieldError("displayName") !== undefined}
            helperText={error?.fieldError("displayName")}
          />
          <TextField
            select
            required
            label="Role"
            value={role}
            onChange={(event) => setRole(event.target.value as UserRole)}
            disabled={saving || isSelf}
            error={error?.fieldError("role") !== undefined}
            helperText={
              error?.fieldError("role") ?? (isSelf ? "You cannot change your own role." : undefined)
            }
          >
            {userRoles.map((option) => (
              <MenuItem key={option} value={option}>
                {option}
              </MenuItem>
            ))}
          </TextField>
          <FormControlLabel
            control={
              <Switch
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
                disabled={saving || isSelf}
              />
            }
            label="Account is active"
          />
          <Typography variant="body2" color="text.secondary">
            Disabling an account ends its sessions immediately and blocks new sign-ins. The
            person&rsquo;s history stays exactly where it is.
          </Typography>

          <Box>
            <Button type="submit" variant="contained" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </Box>
        </Stack>
      </Box>

      {!isSelf && <PasswordReset user={user} />}
    </Paper>
  );
}

/**
 * Setting a password for somebody who cannot sign in.
 *
 * The only account recovery the product has: there is no email reset, and an
 * account with stock history cannot be deleted and recreated. The person is
 * required to replace what is set here the next time they sign in, because from
 * this moment the Admin knows it too.
 */
function PasswordReset({ user }: { readonly user: UserView }): ReactElement {
  const api = useApi();
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<ApiError | undefined>(undefined);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setSaving(true);
    setDone(false);
    setError(undefined);

    void api
      .resetUserPassword(user.id, { newPassword })
      .then(() => {
        setNewPassword("");
        setDone(true);
      })
      .catch((caught: unknown) => setError(asApiError(caught)))
      .finally(() => setSaving(false));
  };

  return (
    <Box component="form" onSubmit={submit} noValidate sx={{ mt: 4 }}>
      <Divider sx={{ mb: 3 }} />
      <Stack spacing={2}>
        <Typography variant="h4" component="h3">
          Reset password
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Use this when someone cannot sign in. It ends every session they have, and they must
          choose their own password before they can do anything else. Tell them the new password in
          person, not by message.
        </Typography>

        {done && (
          <Alert severity="success">
            Password reset. {user.displayName} must change it at their next sign-in.
          </Alert>
        )}
        {error !== undefined && !error.hasFieldErrors && (
          <Alert severity="error">{error.message}</Alert>
        )}

        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          error={error?.fieldError("newPassword") !== undefined}
          helperText={
            error?.fieldError("newPassword") ??
            `At least ${String(passwordPolicy.minimumCharacters)} characters.`
          }
          required
          sx={{ maxWidth: 420 }}
        />

        <Box>
          <Button
            type="submit"
            variant="outlined"
            color="warning"
            disabled={saving || newPassword.length === 0}
          >
            {saving ? "Resetting…" : "Reset password"}
          </Button>
        </Box>
      </Stack>
    </Box>
  );
}

/**
 * One person: who they are, what they may do, and what they have actually been
 * doing. The activity is the reason this screen exists — a role on its own does
 * not tell an Admin whether an account is still in use.
 */
export function UserDetailPage(): ReactElement {
  const api = useApi();
  const navigate = useNavigate();
  const { userId = "" } = useParams<{ userId: string }>();
  const { user: signedInUser, refresh: refreshSession } = useAuth();

  const load = useCallback(
    (signal: AbortSignal) => api.userActivity(userId, signal),
    [api, userId],
  );
  const activity = useResource(load);
  const data = activity.data;
  const isSelf = userId === signedInUser?.id;

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<ApiError | undefined>(undefined);

  const handleDelete = (): void => {
    setDeleteError(undefined);

    void api
      .deleteUser(userId)
      .then(() => navigate("/team", { replace: true }))
      .catch((caught: unknown) => setDeleteError(asApiError(caught)));
  };

  return (
    <Box>
      <Button component={RouterLink} to="/team" startIcon={<ArrowBackRounded />} sx={{ mb: 1.5 }}>
        Back to the team
      </Button>

      {activity.status === "error" && activity.error !== undefined && (
        <ErrorState error={activity.error} onRetry={activity.reload} />
      )}

      {activity.status === "loading" && data === undefined && <LoadingRows rows={8} />}

      {data !== undefined && (
        <>
          <PageHeader
            eyebrow={data.user.role}
            title={data.user.displayName}
            description={`${data.user.email} · joined ${formatDateTime(data.user.createdAt)}`}
            actions={
              <Button
                variant="outlined"
                color="error"
                startIcon={<DeleteOutlineRounded />}
                onClick={() => setConfirmingDelete(true)}
                disabled={isSelf}
              >
                Delete
              </Button>
            }
          />

          <Stack spacing={3}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <StatTile
                label="Status"
                value={data.user.isActive ? "Active" : "Disabled"}
                tone={data.user.isActive ? "primary" : "warning"}
              />
              <StatTile label="Stock movements" value={String(data.counts.transactions)} />
              <StatTile label="Open reservations" value={String(data.counts.openReservations)} />
              <StatTile label="Requests waiting" value={String(data.counts.pendingRequests)} />
            </Stack>

            {/*
             * Keyed by the person, so navigating from one to another builds a
             * fresh form with their values rather than syncing an old one.
             */}
            <DetailsForm
              key={data.user.id}
              user={data.user}
              isSelf={isSelf}
              onSaved={() => {
                activity.reload();
                if (isSelf) void refreshSession();
              }}
            />

            <Paper variant="outlined">
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ px: 2.5, py: 2 }}
              >
                <Typography variant="h3" component="h2">
                  Recent activity
                </Typography>
                <Button
                  component={RouterLink}
                  to={`/transactions?actorUserId=${encodeURIComponent(userId)}`}
                  data-help-target="user-full-log"
                  size="small"
                >
                  See the full log
                </Button>
              </Stack>
              <Divider />
              {data.recentTransactions.length === 0 ? (
                <Box sx={{ px: 2.5, py: 3 }}>
                  <Typography color="text.secondary">
                    This person has not moved any stock yet.
                  </Typography>
                </Box>
              ) : (
                <TableContainer>
                  <Table size="small" aria-label="Recent activity">
                    <TableHead>
                      <TableRow>
                        <TableCell>When</TableCell>
                        <TableCell>What</TableCell>
                        <TableCell>Item</TableCell>
                        <TableCell align="right">Quantity</TableCell>
                        <TableCell>Job</TableCell>
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
                          <TableCell>
                            <Stack direction="row" spacing={1} alignItems="center">
                              <ItemAvatar
                                name={transaction.itemName}
                                photoUrl={transaction.itemPhotoUrl}
                                size={32}
                              />
                              <Link
                                component={RouterLink}
                                to={`/inventory/${transaction.itemId}`}
                                underline="hover"
                              >
                                {transaction.itemReference}
                              </Link>
                            </Stack>
                          </TableCell>
                          <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                            {formatQuantity(transaction.quantity)} {transaction.unit}
                          </TableCell>
                          <TableCell>{transaction.jobNumber ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Paper>

            <Paper variant="outlined" data-help-target="user-activity">
              <Typography variant="h3" component="h2" sx={{ px: 2.5, py: 2 }}>
                Open reservations
              </Typography>
              <Divider />
              {data.openReservations.length === 0 ? (
                <Box sx={{ px: 2.5, py: 3 }}>
                  <Typography color="text.secondary">
                    Nothing is reserved and waiting for this person to collect it.
                  </Typography>
                </Box>
              ) : (
                <TableContainer>
                  <Table size="small" aria-label="Open reservations">
                    <TableHead>
                      <TableRow>
                        <TableCell>Item</TableCell>
                        <TableCell align="right">Reserved</TableCell>
                        <TableCell align="right">Collected</TableCell>
                        <TableCell align="right">Outstanding</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.openReservations.map((reservation) => (
                        <TableRow key={reservation.id}>
                          <TableCell>
                            <Stack direction="row" spacing={1} alignItems="center">
                              <ItemAvatar
                                name={reservation.itemName}
                                photoUrl={reservation.itemPhotoUrl}
                                size={32}
                              />
                              {reservation.itemReference} — {reservation.itemName}
                            </Stack>
                          </TableCell>
                          <TableCell align="right">
                            {formatQuantity(reservation.quantityReserved)}
                          </TableCell>
                          <TableCell align="right">
                            {formatQuantity(reservation.quantityCollected)}
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>
                            {formatQuantity(reservation.quantityOutstanding)} {reservation.unit}
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
                Stock requests
              </Typography>
              <Divider />
              {data.stockRequests.length === 0 ? (
                <Box sx={{ px: 2.5, py: 3 }}>
                  <Typography color="text.secondary">
                    This person has not asked for anything.
                  </Typography>
                </Box>
              ) : (
                <StockRequestList
                  requests={data.stockRequests}
                  canReview
                  onChanged={activity.reload}
                />
              )}
            </Paper>
          </Stack>

          <Dialog open={confirmingDelete} onClose={() => setConfirmingDelete(false)}>
            <DialogTitle>Delete {data.user.displayName}?</DialogTitle>
            <DialogContent>
              <DialogContentText>
                This removes the account entirely. It only works for someone who has never recorded
                any stock activity — history is never erased, so anyone who has worked in
                StockControl must be disabled instead.
              </DialogContentText>
              {deleteError !== undefined && (
                <Alert severity="error" role="alert" sx={{ mt: 2 }}>
                  {deleteError.fieldError("user") ?? deleteError.message}
                </Alert>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirmingDelete(false)}>Cancel</Button>
              <Button color="error" variant="contained" onClick={handleDelete}>
                Delete account
              </Button>
            </DialogActions>
          </Dialog>
        </>
      )}
    </Box>
  );
}
