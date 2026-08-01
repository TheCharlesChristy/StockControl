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
  /** Present when editing. The reference and its history never change. */
  readonly item?: ItemDetailView | undefined;
}

/** Mounted only while it is open, so its fields need no resetting. */
export function CreateItemDialog({
  onClose,
  onCreated,
  item,
}: CreateItemDialogProps): ReactElement {
  const api = useApi();
  const editing = item !== undefined;
  const [name, setName] = useState(item?.name ?? "");
  const [unit, setUnit] = useState(item?.unit ?? "ea");
  const [barcode, setBarcode] = useState(item?.barcode ?? "");
  const [partNumber, setPartNumber] = useState(item?.partNumber ?? "");
  const [threshold, setThreshold] = useState(item?.lowStockThreshold ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | undefined>(undefined);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);

    const fields = {
      name,
      unit,
      barcode: barcode.trim().length === 0 ? null : barcode,
      partNumber: partNumber.trim().length === 0 ? null : partNumber,
      lowStockThreshold: threshold.trim().length === 0 ? null : threshold,
    };

    void (item === undefined ? api.createItem(fields) : api.updateItem(item.id, fields))
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
      <DialogTitle>{editing ? `Edit ${item.reference}` : "New catalogue item"}</DialogTitle>
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
              label="Low-stock minimum"
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
            {submitting
              ? editing
                ? "Saving…"
                : "Creating…"
              : editing
                ? "Save changes"
                : "Create item"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
