import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { ItemDetailView, LocationView } from "@stockcontrol/contracts";
import { useState, type FormEvent, type ReactElement } from "react";

import { ApiError } from "../api/ApiClient";
import { useApi } from "../api/ApiContext";
import { formatQuantity } from "./DataStates";

export type StockOperation = "receive" | "issue" | "transfer" | "adjust";

const titles: Readonly<Record<StockOperation, string>> = {
  receive: "Receive stock",
  issue: "Take out stock",
  transfer: "Transfer stock",
  /*
   * "Adjust" on its own suggests a difference — add three, take two away — but
   * the field below is the new total. Someone who counts five boxes on a shelf
   * holding six hundred should be in no doubt which number to type.
   */
  adjust: "Correct the counted quantity",
};

const submitLabels: Readonly<Record<StockOperation, string>> = {
  receive: "Receive",
  issue: "Take out",
  transfer: "Transfer",
  adjust: "Save new count",
};

interface StockOperationDialogProps {
  readonly operation: StockOperation;
  readonly item: ItemDetailView;
  readonly locations: readonly LocationView[];
  readonly onClose: () => void;
  readonly onCompleted: (item: ItemDetailView) => void;
}

/**
 * One dialog for all four direct stock operations. They share a shape — pick a
 * location, enter a quantity, submit — and differ only in which locations are
 * offered and whether a reason is required.
 *
 * The parent mounts this only while an operation is chosen, so every field
 * starts from its initial value and there is no state to reset.
 */
export function StockOperationDialog({
  operation,
  item,
  locations,
  onClose,
  onCompleted,
}: StockOperationDialogProps): ReactElement {
  const api = useApi();
  const [locationId, setLocationId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | undefined>(undefined);

  /* Stock can only be received into a store; it can be taken from anywhere holding it. */
  const stores = locations.filter((location) => location.kind === "Store" && location.isActive);
  const holding = item.balances.filter((balance) => Number(balance.quantity) > 0);
  const sourceOptions =
    operation === "receive"
      ? stores.map((store) => ({ id: store.id, label: `${store.code} — ${store.name}` }))
      : holding.map((balance) => ({
          id: balance.locationId,
          label: `${balance.locationCode} (${formatQuantity(balance.quantity)} ${item.unit})`,
        }));

  const currentAtLocation = item.balances.find(
    (balance) => balance.locationId === locationId,
  )?.quantity;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);

    const run = async (): Promise<{ item: ItemDetailView }> => {
      switch (operation) {
        case "receive":
          return api.receive({ itemId: item.id, locationId, quantity });
        case "issue":
          return api.issue({ itemId: item.id, locationId, quantity });
        case "transfer":
          return api.transfer({
            itemId: item.id,
            fromLocationId: locationId,
            toLocationId: destinationId,
            quantity,
          });
        case "adjust":
          return api.adjust({
            itemId: item.id,
            locationId,
            countedQuantity: quantity,
            reason,
          });
      }
    };

    void run()
      .then((result) => {
        onCompleted(result.item);
        onClose();
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
      <DialogTitle>{titles[operation]}</DialogTitle>
      <form onSubmit={handleSubmit} noValidate>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            <Typography variant="body2" color="text.secondary">
              {item.reference} — {item.name}
            </Typography>

            {error !== undefined && !error.hasFieldErrors && (
              <Alert severity={error.isPermissionDenied ? "warning" : "error"} role="alert">
                {error.message}
              </Alert>
            )}

            <TextField
              select
              required
              label={operation === "transfer" ? "From location" : "Location"}
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
              disabled={submitting}
              error={error?.fieldError("locationId") !== undefined}
              helperText={error?.fieldError("locationId") ?? error?.fieldError("fromLocationId")}
            >
              {sourceOptions.length === 0 && (
                <MenuItem value="" disabled>
                  No stock is held anywhere yet
                </MenuItem>
              )}
              {sourceOptions.map((option) => (
                <MenuItem key={option.id} value={option.id}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>

            {operation === "transfer" && (
              <TextField
                select
                required
                label="To location"
                value={destinationId}
                onChange={(event) => setDestinationId(event.target.value)}
                disabled={submitting}
                error={error?.fieldError("toLocationId") !== undefined}
                helperText={error?.fieldError("toLocationId")}
              >
                {stores
                  .filter((store) => store.id !== locationId)
                  .map((store) => (
                    <MenuItem key={store.id} value={store.id}>
                      {store.code} — {store.name}
                    </MenuItem>
                  ))}
              </TextField>
            )}

            <TextField
              required
              label={operation === "adjust" ? "Total counted" : "Quantity"}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              disabled={submitting}
              inputMode="decimal"
              error={
                error?.fieldError("quantity") !== undefined ||
                error?.fieldError("countedQuantity") !== undefined
              }
              /*
               * The replaces-not-adds sentence shows whether or not a location
               * has been picked yet. It is the one thing a person must know
               * before typing, so it cannot wait for the figure to appear.
               */
              helperText={
                error?.fieldError("quantity") ??
                error?.fieldError("countedQuantity") ??
                (operation === "adjust"
                  ? `Enter the total you counted — it replaces the figure on record, it is not added to it.${
                      currentAtLocation === undefined
                        ? ""
                        : ` Currently recorded: ${formatQuantity(currentAtLocation)} ${item.unit}.`
                    }`
                  : `Quantity in ${item.unit}`)
              }
            />

            {operation === "adjust" && (
              <TextField
                required
                label="Reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={submitting}
                multiline
                minRows={2}
                error={error?.fieldError("reason") !== undefined}
                helperText={
                  error?.fieldError("reason") ?? "Every correction is recorded against your name."
                }
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={submitting}>
            {submitting ? "Working…" : submitLabels[operation]}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
