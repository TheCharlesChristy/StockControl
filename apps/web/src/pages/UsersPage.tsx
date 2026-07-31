import PersonAddRounded from "@mui/icons-material/PersonAddRounded";
import SearchRounded from "@mui/icons-material/SearchRounded";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import { userRoles, type UserRole } from "@stockcontrol/contracts";
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

function asApiError(caught: unknown): ApiError {
  return caught instanceof ApiError
    ? caught
    : new ApiError(0, "network.unreachable", "Could not reach StockControl.");
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
            {error !== undefined && (
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
              error={error?.fieldError("password") !== undefined}
              helperText={
                error?.fieldError("password") ??
                "At least 10 characters. Tell them what it is — the demo sends no email."
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

export function UsersPage(): ReactElement {
  const api = useApi();
  const { user: signedInUser } = useAuth();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [actionError, setActionError] = useState<ApiError | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | null>(null);

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
      .then(() => users.reload())
      .catch((caught: unknown) => setActionError(asApiError(caught)))
      .finally(() => setBusyId(null));
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
            startIcon={<PersonAddRounded />}
            onClick={() => setCreating(true)}
          >
            New user
          </Button>
        }
      />

      <TextField
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
        <Paper variant="outlined">
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
                      </TableCell>
                      <TableCell>{row.email}</TableCell>
                      <TableCell>
                        <TextField
                          select
                          size="small"
                          value={row.role}
                          onChange={(event) =>
                            update(row.id, { role: event.target.value as UserRole })
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
                          onChange={(event) => update(row.id, { isActive: event.target.checked })}
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
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5 }}>
            Open a name to edit their details or review what they have done. Disabling someone ends
            their active sessions immediately. You cannot change your own role or disable yourself.
          </Typography>
        </Paper>
      )}

      {creating && <CreateUserDialog onClose={() => setCreating(false)} onDone={users.reload} />}
    </Box>
  );
}
