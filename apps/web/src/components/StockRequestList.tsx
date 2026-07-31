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
  List,
  ListItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { StockRequestStatus, StockRequestView } from "@stockcontrol/contracts";
import { useState, type ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";

import { ApiError } from "../api/ApiClient";
import { useApi } from "../api/ApiContext";
import { useAuth } from "../auth/AuthContext";
import { formatDateTime, formatQuantity } from "./DataStates";

type StatusColour = "default" | "success" | "warning" | "error";

const STATUS_COLOURS: Readonly<Record<StockRequestStatus, StatusColour>> = {
  Pending: "warning",
  Approved: "success",
  Rejected: "error",
  Cancelled: "default",
};

interface StockRequestListProps {
  readonly requests: readonly StockRequestView[];
  /** Whether to offer Approve and Reject. The server checks this again. */
  readonly canReview: boolean;
  readonly onChanged?: () => void;
}

interface DecisionDialogState {
  readonly request: StockRequestView;
  readonly kind: "approve" | "reject";
}

export function StockRequestList({
  requests,
  canReview,
  onChanged,
}: StockRequestListProps): ReactElement {
  const api = useApi();
  const { user } = useAuth();
  const [dialog, setDialog] = useState<DecisionDialogState | null>(null);
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const open = (request: StockRequestView, kind: "approve" | "reject"): void => {
    setDialog({ request, kind });
    setQuantity(request.quantity);
    setNote("");
    setError(null);
  };

  const close = (): void => {
    setDialog(null);
    setError(null);
  };

  const submit = (): void => {
    if (dialog === null) {
      return;
    }

    setBusy(true);
    setError(null);

    const action =
      dialog.kind === "approve"
        ? api.approveStockRequest(dialog.request.id, {
            quantity,
            decisionNote: note.length === 0 ? null : note,
          })
        : api.rejectStockRequest(dialog.request.id, note);

    action
      .then(() => {
        close();
        onChanged?.();
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof ApiError
            ? cause
            : new ApiError(0, "network.unreachable", "Could not reach StockControl."),
        );
      })
      .finally(() => setBusy(false));
  };

  const withdraw = (request: StockRequestView): void => {
    setBusy(true);
    api
      .cancelStockRequest(request.id)
      .then(() => onChanged?.())
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  return (
    <>
      <List disablePadding>
        {requests.map((request) => (
          <ListItem key={request.id} divider sx={{ display: "block", py: 2 }}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              justifyContent="space-between"
              alignItems={{ xs: "flex-start", sm: "center" }}
            >
              <Box>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
                  <Chip
                    label={request.status}
                    size="small"
                    color={STATUS_COLOURS[request.status]}
                    variant="outlined"
                  />
                  <Link
                    component={RouterLink}
                    to={`/inventory/${request.itemId}`}
                    underline="hover"
                  >
                    {request.itemReference} — {request.itemName}
                  </Link>
                  <Typography component="span" sx={{ fontWeight: 700 }}>
                    {formatQuantity(request.quantity)} {request.unit}
                  </Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {request.reference} · {request.requestedByName} ·{" "}
                  {formatDateTime(request.createdAt)}
                  {request.jobNumber !== null && ` · for ${request.jobNumber} ${request.jobName}`}
                </Typography>
                {request.note !== null && (
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    “{request.note}”
                  </Typography>
                )}
                {request.decisionNote !== null && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {request.decidedByName}: {request.decisionNote}
                  </Typography>
                )}
              </Box>

              {request.status === "Pending" && (
                <Stack direction="row" spacing={1}>
                  {canReview && (
                    <>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => open(request, "approve")}
                      >
                        Approve
                      </Button>
                      <Button size="small" onClick={() => open(request, "reject")}>
                        Reject
                      </Button>
                    </>
                  )}
                  {user?.id === request.requestedById && (
                    <Button size="small" disabled={busy} onClick={() => withdraw(request)}>
                      Withdraw
                    </Button>
                  )}
                </Stack>
              )}
            </Stack>
          </ListItem>
        ))}
      </List>

      <Dialog open={dialog !== null} onClose={close} fullWidth maxWidth="xs">
        <DialogTitle>
          {dialog?.kind === "approve" ? "Approve request" : "Turn down request"}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {dialog?.kind === "approve" && (
              <>
                <TextField
                  label="Quantity to approve"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  helperText={
                    dialog.request.jobNumber === null
                      ? "No job was named, so this records the decision without reserving anything."
                      : `Approving reserves this against ${dialog.request.jobNumber}.`
                  }
                  error={error?.fieldError("quantity") !== undefined}
                  fullWidth
                />
                <TextField
                  label="Note (optional)"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  multiline
                  minRows={2}
                  fullWidth
                />
              </>
            )}

            {dialog?.kind === "reject" && (
              <TextField
                label="Why is this being turned down?"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                multiline
                minRows={2}
                required
                error={error?.fieldError("decisionNote") !== undefined}
                helperText={error?.fieldError("decisionNote")}
                fullWidth
              />
            )}

            {error !== null && (
              <Alert severity={error.isPermissionDenied ? "warning" : "error"}>
                {error.message}
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="contained"
            onClick={submit}
            disabled={busy || (dialog?.kind === "reject" && note.trim().length === 0)}
          >
            {dialog?.kind === "approve" ? "Approve" : "Turn down"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
