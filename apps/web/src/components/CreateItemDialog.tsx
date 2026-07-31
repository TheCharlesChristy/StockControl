import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from "@mui/material";
import type { ItemDetailView } from "@stockcontrol/contracts";
import { useState, type FormEvent, type ReactElement } from "react";

import { ApiError } from "../api/ApiClient";
import { useApi } from "../api/ApiContext";

interface CreateItemDialogProps {
  readonly onClose: () => void;
  readonly onCreated: (item: ItemDetailView) => void;
}

/** Mounted only while it is open, so its fields need no resetting. */
export function CreateItemDialog({ onClose, onCreated }: CreateItemDialogProps): ReactElement {
  const api = useApi();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("ea");
  const [barcode, setBarcode] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [threshold, setThreshold] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | undefined>(undefined);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);

    void api
      .createItem({
        name,
        unit,
        barcode: barcode.trim().length === 0 ? null : barcode,
        partNumber: partNumber.trim().length === 0 ? null : partNumber,
        lowStockThreshold: threshold.trim().length === 0 ? null : threshold,
      })
      .then(onCreated)
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
      <DialogTitle>New catalogue item</DialogTitle>
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
              label="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={submitting}
              error={error?.fieldError("name") !== undefined}
              helperText={error?.fieldError("name") ?? "For example, M6 × 30 mm zinc-plated bolt"}
            />
            <TextField
              required
              label="Unit"
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
              disabled={submitting}
              error={error?.fieldError("unit") !== undefined}
              helperText={error?.fieldError("unit") ?? "ea, m, L, kg — one unit per item"}
            />
            <TextField
              label="Barcode"
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
              disabled={submitting}
              error={error?.fieldError("barcode") !== undefined}
              helperText={error?.fieldError("barcode") ?? "Optional, and searchable"}
            />
            <TextField
              label="Manufacturer part number"
              value={partNumber}
              onChange={(event) => setPartNumber(event.target.value)}
              disabled={submitting}
              helperText="Optional, and searchable"
            />
            <TextField
              label="Low-stock threshold"
              value={threshold}
              onChange={(event) => setThreshold(event.target.value)}
              disabled={submitting}
              inputMode="decimal"
              error={error?.fieldError("lowStockThreshold") !== undefined}
              helperText={
                error?.fieldError("lowStockThreshold") ??
                "Optional. Below this, the item is flagged on the dashboard."
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={submitting}>
            {submitting ? "Creating…" : "Create item"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
