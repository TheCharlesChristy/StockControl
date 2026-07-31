import AddRounded from "@mui/icons-material/AddRounded";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import { useCallback, useState, type FormEvent, type ReactElement } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";

import { ApiError } from "../api/ApiClient";
import { useApi, useResource } from "../api/ApiContext";
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
            {error !== undefined && (
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
  const canManageJobs = useCapability("manageJobs");
  const [filter, setFilter] = useState<Filter>("Open");
  const [creating, setCreating] = useState(false);

  const load = useCallback(
    (signal: AbortSignal) => api.listJobs(filter === "All" ? undefined : filter, signal),
    [api, filter],
  );
  const jobs = useResource(load);
  const rows = jobs.data?.jobs ?? [];

  return (
    <Box>
      <PageHeader
        eyebrow="Jobs"
        title="Work, and the stock committed to it"
        description="Reserve stock against a job, hand it over, and close the job when it is done."
        actions={
          canManageJobs ? (
            <Button
              variant="contained"
              startIcon={<AddRounded />}
              onClick={() => setCreating(true)}
            >
              New job
            </Button>
          ) : undefined
        }
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
        sx={{ mb: 2.5 }}
      >
        <ToggleButton value="Open">Open</ToggleButton>
        <ToggleButton value="Closed">Closed</ToggleButton>
        <ToggleButton value="All">All</ToggleButton>
      </ToggleButtonGroup>

      {jobs.status === "error" && jobs.error !== undefined && (
        <ErrorState error={jobs.error} onRetry={jobs.reload} />
      )}

      {jobs.status === "loading" && jobs.data === undefined && <LoadingRows rows={5} />}

      {jobs.data !== undefined && rows.length === 0 && (
        <EmptyState
          title={filter === "Closed" ? "No closed jobs" : "No jobs yet"}
          description={
            canManageJobs
              ? "Create a job, then reserve the stock it needs."
              : "An Office user creates jobs. Ask them to set one up."
          }
        />
      )}

      {rows.length > 0 && (
        <Paper variant="outlined">
          <TableContainer>
            <Table aria-label="Jobs">
              <TableHead>
                <TableRow>
                  <TableCell>Number</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>Customer</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Open reservations</TableCell>
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
