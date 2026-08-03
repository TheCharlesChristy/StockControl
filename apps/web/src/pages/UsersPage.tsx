import PersonAddRounded from "@mui/icons-material/PersonAddRounded";
import SearchRounded from "@mui/icons-material/SearchRounded";
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
  InputAdornment,
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
import { useCallback, useState, type FormEvent, type ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";

import { ApiError } from "../api/ApiClient";
import { useApi, useResource } from "../api/ApiContext";
import { useAuth } from "../auth/AuthContext";
import {
  EmptyState,
  ErrorState,
  formatDate,
  LoadingRows,
  PageHeader,
} from "../components/DataStates";
import { ImagePreview } from "../components/ImagePreview";

function asApiError(caught: unknown): ApiError {
  return caught instanceof ApiError
    ? caught
    : new ApiError(0, "network.unreachable", "Could not reach StockControl.");
}

function initials(displayName: string): string {
  return displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

/** Mounted only while open, so its fields need no resetting. */
function CreateUserDialog({
  onClose,
  onDone,
}: {
  readonly onClose: () => void;
  readonly onDone: () => void;
}): ReactElement {
  const api = useApi();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<UserRole>("Engineer");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | undefined>(undefined);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);

    void api
      .createUser({ email, displayName, role, password })
      .then(() => {
        onDone();
        onClose();
      })
      .catch((caught: unknown) => setError(asApiError(caught)))
      .finally(() => setSubmitting(false));
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>New user</DialogTitle>
      <form onSubmit={handleSubmit} noValidate>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            {error !== undefined && !error.hasFieldErrors && (
              <Alert severity={error.isPermissionDenied ? "warning" : "error"} role="alert">
                {error.message}
              </Alert>
            )}
            <TextField
              required
              autoFocus
              type="email"
              label="Work email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting}
              error={error?.fieldError("email") !== undefined}
              helperText={error?.fieldError("email")}
            />
            <TextField
              required
              label="Name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              disabled={submitting}
              error={error?.fieldError("displayName") !== undefined}
              helperText={error?.fieldError("displayName")}
            />
            <TextField
              select
              required
              label="Role"
              value={role}
              onChange={(event) => setRole(event.target.value as UserRole)}
              disabled={submitting}
              error={error?.fieldError("role") !== undefined}
              helperText={error?.fieldError("role")}
            >
              {userRoles.map((option) => (
                <MenuItem key={option} value={option}>
                  {option}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              required
              type="password"
              label="Initial password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
              autoComplete="new-password"
              slotProps={{
                htmlInput: {
                  minLength: passwordPolicy.minimumCharacters,
                  maxLength: passwordPolicy.maximumCharacters,
                },
              }}
              error={error?.fieldError("password") !== undefined}
              helperText={
                error?.fieldError("password") ??
                "Use 15–128 characters. Passphrases are welcome; share it securely."
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={submitting}>
            {submitting ? "Creating…" : "Create user"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/** A change to somebody's access, held until it has been confirmed. */
type PendingChange =
  | { readonly kind: "role"; readonly user: UserView; readonly role: UserRole }
  | { readonly kind: "active"; readonly user: UserView; readonly isActive: boolean };

export function UsersPage(): ReactElement {
  const api = useApi();
  const { user: signedInUser } = useAuth();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [actionError, setActionError] = useState<ApiError | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingChange | null>(null);

  const load = useCallback((signal: AbortSignal) => api.listUsers(signal), [api]);
  const users = useResource(load);
  const allUsers = users.data?.users ?? [];
  /*
   * Filtered here rather than on the server: a team is tens of people, not
   * thousands, so the whole list is already loaded and typing stays instant.
   */
  const term = search.trim().toLowerCase();
  const rows =
    term.length === 0
      ? allUsers
      : allUsers.filter((row) =>
          [row.displayName, row.email, row.role].some((field) =>
            field.toLowerCase().includes(term),
          ),
        );

  const update = (id: string, changes: { role?: UserRole; isActive?: boolean }): void => {
    setBusyId(id);
    setActionError(undefined);

    void api
      .updateUser(id, changes)
      .then(() => {
        setPending(null);
        return users.reload();
      })
      .catch((caught: unknown) => setActionError(asApiError(caught)))
      .finally(() => setBusyId(null));
  };

  /*
   * Both of these controls change what somebody can do the instant they move,
   * and disabling an account also ends whatever that person is in the middle
   * of. Ask first, and say plainly what will happen — an accidental brush of a
   * dropdown should not be able to demote a colleague.
   */
  const confirmation =
    pending === null
      ? null
      : pending.kind === "role"
        ? {
            title: `Change ${pending.user.displayName} to ${pending.role}?`,
            body: `They currently sign in as ${pending.user.role}. The new role applies to their next request — anything already open in their browser follows it immediately.`,
            action: "Change role",
            run: () => update(pending.user.id, { role: pending.role }),
          }
        : {
            title: pending.isActive
              ? `Turn ${pending.user.displayName}'s access back on?`
              : `Disable ${pending.user.displayName}?`,
            body: pending.isActive
              ? "They will be able to sign in again straight away."
              : "They are signed out immediately and cannot sign back in. Their history stays in the log.",
            action: pending.isActive ? "Enable" : "Disable",
            run: () => update(pending.user.id, { isActive: pending.isActive }),
          };

  return (
    <Box>
      <PageHeader
        eyebrow="Team & access"
        title="Who can do what"
        description="Three fixed roles. Permissions are decided by role and enforced on the server for every request."
        actions={
          <Button
            variant="contained"
            data-help-target="team-new-user"
            startIcon={<PersonAddRounded />}
            onClick={() => setCreating(true)}
          >
            New user
          </Button>
        }
      />

      <TextField
        data-help-target="team-search"
        fullWidth
        label="Search the team"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Name, email or role"
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

      {actionError !== undefined && (
        <Alert severity="error" role="alert" sx={{ mb: 2 }}>
          {actionError.message}
        </Alert>
      )}

      {users.status === "error" && users.error !== undefined && (
        <ErrorState error={users.error} onRetry={users.reload} />
      )}

      {users.status === "loading" && users.data === undefined && <LoadingRows rows={4} />}

      {users.data !== undefined && rows.length === 0 && (
        <EmptyState
          title="Nobody matched that search"
          description="Try part of a name, an email address, or a role such as Engineer."
        />
      )}

      {rows.length > 0 && (
        <Paper variant="outlined" data-help-target="team-results">
          {/*
           * Above the table, not below it: this explains what the controls in
           * the rows do, and an explanation read after the fact is no use.
           */}
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5 }}>
            Open a name to edit their details or review what they have done. Disabling someone ends
            their active sessions immediately. You cannot change your own role or disable yourself.
          </Typography>
          <Divider />
          <TableContainer>
            <Table aria-label="Users">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell align="right">Active</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => {
                  const isSelf = row.id === signedInUser?.id;

                  return (
                    <TableRow key={row.id} hover>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <ImagePreview
                            src={row.profilePhotoUrl}
                            alt={`${row.displayName} profile photo`}
                          >
                            <Avatar
                              src={row.profilePhotoUrl ?? undefined}
                              alt={`${row.displayName} profile photo`}
                              sx={{ width: 32, height: 32, fontSize: "0.72rem" }}
                            >
                              {initials(row.displayName)}
                            </Avatar>
                          </ImagePreview>
                          <Link
                            component={RouterLink}
                            to={`/team/${row.id}`}
                            underline="hover"
                            sx={{ fontWeight: 600 }}
                          >
                            {row.displayName}
                          </Link>
                          {isSelf && (
                            <Chip label="You" size="small" variant="outlined" sx={{ ml: 1 }} />
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell>{row.email}</TableCell>
                      <TableCell>
                        <TextField
                          select
                          size="small"
                          value={row.role}
                          onChange={(event) =>
                            setPending({
                              kind: "role",
                              user: row,
                              role: event.target.value as UserRole,
                            })
                          }
                          disabled={isSelf || busyId === row.id}
                          aria-label={`Role for ${row.displayName}`}
                          sx={{ minWidth: 130 }}
                        >
                          {userRoles.map((option) => (
                            <MenuItem key={option} value={option}>
                              {option}
                            </MenuItem>
                          ))}
                        </TextField>
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {formatDate(row.createdAt)}
                      </TableCell>
                      <TableCell align="right">
                        <Switch
                          checked={row.isActive}
                          onChange={(event) =>
                            setPending({
                              kind: "active",
                              user: row,
                              isActive: event.target.checked,
                            })
                          }
                          disabled={isSelf || busyId === row.id}
                          slotProps={{ input: { "aria-label": `Active: ${row.displayName}` } }}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {confirmation !== null && (
        <Dialog open onClose={() => setPending(null)} fullWidth maxWidth="xs">
          <DialogTitle>{confirmation.title}</DialogTitle>
          <DialogContent>
            <DialogContentText>{confirmation.body}</DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPending(null)} disabled={busyId !== null}>
              Cancel
            </Button>
            <Button variant="contained" onClick={confirmation.run} disabled={busyId !== null}>
              {confirmation.action}
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {creating && <CreateUserDialog onClose={() => setCreating(false)} onDone={users.reload} />}
    </Box>
  );
}
