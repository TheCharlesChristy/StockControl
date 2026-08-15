import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
} from "@mui/material";
import { useState, type FormEvent, type ReactElement } from "react";

import { ApiError } from "../api/ApiClient";
import { useApi } from "../api/ApiContext";

interface ReportIssueDialogProps {
  readonly onClose: () => void;
  readonly page: string;
  readonly initialTitle?: string;
  readonly initialDescription?: string;
}

export function ReportIssueDialog({
  onClose,
  page,
  initialTitle = "",
  initialDescription = "",
}: ReportIssueDialogProps): ReactElement {
  const api = useApi();
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | undefined>(undefined);
  const [issueUrl, setIssueUrl] = useState<string | undefined>(undefined);

  const handleClose = (): void => {
    if (!submitting) {
      onClose();
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);

    void api
      .reportIssue({ title, description, page })
      .then((response) => setIssueUrl(response.issueUrl))
      .catch((caught: unknown) => {
        setError(
          caught instanceof ApiError
            ? caught
            : new ApiError(0, "network.unreachable", "Could not reach StockControl."),
        );
      })
      .finally(() => setSubmitting(false));
  };

  if (issueUrl !== undefined) {
    return (
      <Dialog open onClose={handleClose} fullWidth maxWidth="sm">
        <DialogTitle>Issue reported</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Alert severity="success">
              Thanks — your report has been submitted to the StockControl repository.
            </Alert>
            <Button
              component="a"
              href={issueUrl}
              target="_blank"
              rel="noreferrer"
              variant="outlined"
              sx={{ alignSelf: "flex-start" }}
            >
              Open GitHub issue
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Close</Button>
        </DialogActions>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>Report an issue</DialogTitle>
      <form onSubmit={handleSubmit} noValidate>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            <DialogContentText>
              Tell us what went wrong and we’ll create an issue for the team to review.
            </DialogContentText>
            {error !== undefined && !error.hasFieldErrors && (
              <Alert severity="error" role="alert">
                {error.message}
              </Alert>
            )}
            <TextField
              required
              autoFocus
              fullWidth
              label="Title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={submitting}
              error={error?.fieldError("title") !== undefined}
              helperText={error?.fieldError("title") ?? "A short summary of the problem"}
            />
            <TextField
              required
              fullWidth
              multiline
              minRows={5}
              label="What happened?"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={submitting}
              error={error?.fieldError("description") !== undefined}
              helperText={
                error?.fieldError("description") ??
                "Include what you expected, what happened, and any steps to reproduce it."
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={submitting}>
            {submitting ? "Submitting…" : "Submit issue"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
