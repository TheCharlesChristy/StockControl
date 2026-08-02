import AddRounded from "@mui/icons-material/AddRounded";
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
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import type { JobStatus } from "@stockcontrol/contracts";
import { useCallback, useDeferredValue, useState, type FormEvent, type ReactElement } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";

import { ApiError } from "../api/ApiClient";
import { useApi, useResource } from "../api/ApiContext";
import { useAuth } from "../auth/AuthContext";
import { useCapability } from "../auth/useCapability";
import {
  EmptyState,
  ErrorState,
  formatDate,
  LoadingRows,
  PageHeader,
} from "../components/DataStates";

type Filter = JobStatus | "All";

/** Mounted only while open, so its fields need no resetting. */
function CreateJobDialog({ onClose }: { readonly onClose: () => void }): ReactElement {
  const api = useApi();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [customer, setCustomer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | undefined>(undefined);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);

    void api
      .createJob({ name, customer })
      .then((job) => {
        onClose();
        void navigate(`/jobs/${job.id}`);
      })
      .catch((caught: unknown) => {
        setError(
          caught instanceof ApiError
            ? caught
            : new ApiError(0, "network.unreachable", "Could not reach StockControl."),
        );
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>New job</DialogTitle>
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
              label="Job name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={submitting}
              error={error?.fieldError("name") !== undefined}
              helperText={error?.fieldError("name")}
            />
            <TextField
              required
              label="Customer"
              value={customer}
              onChange={(event) => setCustomer(event.target.value)}
              disabled={submitting}
              error={error?.fieldError("customer") !== undefined}
              helperText={
                error?.fieldError("customer") ??
                "A job number and its job-site location are created automatically."
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={submitting}>
            {submitting ? "Creating…" : "Create job"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export function JobsPage(): ReactElement {
  const api = useApi();
  const { user } = useAuth();
  const canManageJobs = useCapability("manageJobs");
  const [filter, setFilter] = useState<Filter>("Open");
  const [search, setSearch] = useState("");
  /* An Engineer opens this page to find their own work, so start there. */
  const [mineOnly, setMineOnly] = useState(user?.role === "Engineer");
  const [creating, setCreating] = useState(false);
  const deferredSearch = useDeferredValue(search);
  const assignedTo = mineOnly ? user?.id : undefined;

  const load = useCallback(
    (signal: AbortSignal) =>
      api.listJobs(
        {
          ...(filter === "All" ? {} : { status: filter }),
          search: deferredSearch,
          ...(assignedTo === undefined ? {} : { assignedTo }),
        },
        signal,
      ),
    [api, filter, deferredSearch, assignedTo],
  );
  const jobs = useResource(load);
  const rows = jobs.data?.jobs ?? [];

  return (
    <Box>
      <PageHeader
        eyebrow="Jobs"
        title="Jobs and their stock"
        description="Open a job to reserve stock for it, collect stock to site, or close it."
        actions={
          canManageJobs ? (
            <Button
              variant="contained"
              data-help-target="jobs-new"
              startIcon={<AddRounded />}
              onClick={() => setCreating(true)}
            >
              New job
            </Button>
          ) : undefined
        }
      />

      <Stack
        data-help-target="jobs-filters"
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        alignItems={{ xs: "stretch", md: "center" }}
        sx={{ mb: 2.5 }}
      >
        <TextField
          label="Search jobs"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Number, name or customer"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRounded fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
          sx={{ flex: 1 }}
        />

        <ToggleButtonGroup
          exclusive
          size="small"
          value={filter}
          onChange={(_, next: Filter | null) => {
            if (next !== null) {
              setFilter(next);
            }
          }}
          aria-label="Filter jobs by status"
        >
          <ToggleButton value="Open">Open</ToggleButton>
          <ToggleButton value="Closed">Closed</ToggleButton>
          <ToggleButton value="All">All</ToggleButton>
        </ToggleButtonGroup>

        <ToggleButton
          value="mine"
          size="small"
          selected={mineOnly}
          onChange={() => setMineOnly((only) => !only)}
          aria-label="Show only jobs assigned to me"
        >
          Assigned to me
        </ToggleButton>
      </Stack>

      {jobs.status === "error" && jobs.error !== undefined && (
        <ErrorState error={jobs.error} onRetry={jobs.reload} />
      )}

      {jobs.status === "loading" && jobs.data === undefined && <LoadingRows rows={5} />}

      {jobs.data !== undefined && rows.length === 0 && (
        <EmptyState
          title={
            search.length > 0
              ? "No jobs matched that search"
              : mineOnly
                ? "You are not on any jobs"
                : filter === "Closed"
                  ? "No closed jobs"
                  : "No jobs yet"
          }
          description={
            mineOnly
              ? "Turn off “Assigned to me” to see every job, or ask an Office user to put you on one."
              : canManageJobs
                ? "Create a job, then reserve the stock it needs."
                : "An Office user creates jobs. Ask them to set one up."
          }
        />
      )}

      {rows.length > 0 && (
        <Paper variant="outlined" data-help-target="jobs-results">
          <TableContainer>
            <Table aria-label="Jobs">
              <TableHead>
                <TableRow>
                  <TableCell>Number</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>Customer</TableCell>
                  <TableCell sx={{ display: { xs: "none", md: "table-cell" } }}>
                    Assigned to
                  </TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Open commitments</TableCell>
                  <TableCell>Created</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((job) => (
                  <TableRow key={job.id} hover>
                    <TableCell>
                      <Link component={RouterLink} to={`/jobs/${job.id}`} underline="hover">
                        {job.number}
                      </Link>
                    </TableCell>
                    <TableCell>{job.name}</TableCell>
                    <TableCell>{job.customer}</TableCell>
                    <TableCell sx={{ display: { xs: "none", md: "table-cell" } }}>
                      {job.assignees.length === 0
                        ? "—"
                        : job.assignees.map((person) => person.displayName).join(", ")}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={job.status}
                        size="small"
                        color={job.status === "Open" ? "primary" : "default"}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell align="right">{job.openReservationCount}</TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>{formatDate(job.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {creating && (
        <CreateJobDialog
          onClose={() => {
            setCreating(false);
            jobs.reload();
          }}
        />
      )}
    </Box>
  );
}
