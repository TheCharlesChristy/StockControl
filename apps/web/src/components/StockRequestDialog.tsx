import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from "@mui/material";
import type { ItemDetailView, JobSummaryView } from "@stockcontrol/contracts";
import { useCallback, useState, type FormEvent, type ReactElement } from "react";

import { ApiError } from "../api/ApiClient";
import { useApi, useResource } from "../api/ApiContext";

interface StockRequestDialogProps {
  readonly item: ItemDetailView;
  readonly onClose: () => void;
  readonly onCreated: () => void;
}

/**
 * Asking for stock rather than taking it. Naming a job turns an approval into a
 * reservation against that job; leaving it blank records the demand without
 * committing anything, which is how a "we are running out of these" note gets
 * to the Office.
 */
export function StockRequestDialog({
  item,
  onClose,
  onCreated,
}: StockRequestDialogProps): ReactElement {
  const api = useApi();
  const loadJobs = useCallback(
    (signal: AbortSignal) => api.listJobs({ status: "Open" }, signal),
    [api],
  );
  const jobs = useResource(loadJobs);
  const [quantity, setQuantity] = useState("");
  const [jobId, setJobId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const openJobs: readonly JobSummaryView[] = jobs.data?.jobs ?? [];

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    api
      .createStockRequest({
        itemId: item.id,
        quantity,
        jobId: jobId.length === 0 ? null : jobId,
        note: note.length === 0 ? null : note,
      })
      .then(() => onCreated())
      .catch((cause: unknown) => {
        setError(
          cause instanceof ApiError
            ? cause
            : new ApiError(0, "network.unreachable", "Could not reach StockControl."),
        );
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <Stack component="form" onSubmit={handleSubmit}>
        <DialogTitle>Request stock</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            {item.reference} — {item.name}
          </DialogContentText>
          <Stack spacing={2}>
            <TextField
              label={`Quantity (${item.unit})`}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              required
              autoFocus
              error={error?.fieldError("quantity") !== undefined}
              helperText={error?.fieldError("quantity")}
              fullWidth
            />
            <TextField
              select
              label="For a job (optional)"
              value={jobId}
              onChange={(event) => setJobId(event.target.value)}
              error={error?.fieldError("jobId") !== undefined}
              helperText={
                error?.fieldError("jobId") ??
                "Naming a job reserves the stock against it once approved."
              }
              fullWidth
            >
              <MenuItem value="">No job</MenuItem>
              {openJobs.map((job) => (
                <MenuItem key={job.id} value={job.id}>
                  {job.number} — {job.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Note (optional)"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              multiline
              minRows={2}
              placeholder="Why you need it, or when by"
              fullWidth
            />

            {error !== null && error.errors === undefined && (
              <Alert severity={error.isPermissionDenied ? "warning" : "error"}>
                {error.message}
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={submitting}>
            Send request
          </Button>
        </DialogActions>
      </Stack>
    </Dialog>
  );
}
