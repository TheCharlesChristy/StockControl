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
import { ItemAvatar } from "./ItemAvatar";

export type StockOperation = "receive" | "issue" | "transfer" | "adjust";

const titles: Readonly<Record<StockOperation, string>> = {
  receive: "Receive stock",
  issue: "Take from store",
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
  issue: "Take from store",
  transfer: "Transfer",
  adjust: "Save new count",
};

/** A location option, with where it sits on the map underneath it. */
function LocationOption({
  label,
  path,
}: {
  readonly label: string;
  readonly path: string;
}): ReactElement {
  return (
    <Stack spacing={0} sx={{ minWidth: 0 }}>
      <Typography variant="body2">{label}</Typography>
      {path !== "" && (
        <Typography variant="caption" color="text.secondary" noWrap>
          {path}
        </Typography>
      )}
    </Stack>
  );
}

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
  /*
   * The breadcrumb comes from where the shape is drawn on the map, so a picker
   * reads as a hierarchy — "Main Store › Aisle 3 › Shelf B" — without one being
   * maintained anywhere.
   */
  const pathById = new Map(locations.map((location) => [location.id, location.path]));
  const sourceOptions =
    operation === "receive"
      ? stores.map((store) => ({
          id: store.id,
          label: `${store.code} — ${store.name}`,
          path: store.path,
        }))
      : holding.map((balance) => ({
          id: balance.locationId,
          label: `${balance.locationCode} (${formatQuantity(balance.quantity)} ${item.unit})`,
          path: pathById.get(balance.locationId) ?? "",
        }));

  const selectedLocationId = locationId || sourceOptions[0]?.id || "";
  const firstDestination = stores.find((store) => store.id !== selectedLocationId);
  const selectedDestinationId = destinationId || firstDestination?.id || "";
  const currentAtLocation = item.balances.find(
    (balance) => balance.locationId === selectedLocationId,
  )?.quantity;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);

    const run = async (): Promise<{ item: ItemDetailView }> => {
      switch (operation) {
        case "receive":
          return api.receive({ itemId: item.id, locationId: selectedLocationId, quantity });
        case "issue":
          return api.issue({ itemId: item.id, locationId: selectedLocationId, quantity });
        case "transfer":
          return api.transfer({
            itemId: item.id,
            fromLocationId: selectedLocationId,
            toLocationId: selectedDestinationId,
            quantity,
          });
        case "adjust":
          return api.adjust({
            itemId: item.id,
            locationId: selectedLocationId,
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
            <Stack direction="row" spacing={1} alignItems="center">
              <ItemAvatar name={item.name} photoUrl={item.coverPhotoUrl} size={32} />
              <Typography variant="body2" color="text.secondary">
                {item.reference} — {item.name}
              </Typography>
            </Stack>

            {error !== undefined && !error.hasFieldErrors && (
              <Alert severity={error.isPermissionDenied ? "warning" : "error"} role="alert">
                {error.message}
              </Alert>
            )}

            <TextField
              select
              required
              label={operation === "transfer" ? "From location" : "Location"}
              value={selectedLocationId}
              onChange={(event) => setLocationId(event.target.value)}
              disabled={submitting}
              error={error?.fieldError("locationId") !== undefined}
              helperText={
                error?.fieldError("locationId") ??
                error?.fieldError("fromLocationId") ??
                (operation === "receive"
                  ? "Choose the store where this stock arrived."
                  : currentAtLocation === undefined
                    ? "Choose where to take the stock from."
                    : `${formatQuantity(currentAtLocation)} ${item.unit} is held here.`)
              }
            >
              {sourceOptions.length === 0 && (
                <MenuItem value="" disabled>
                  No stock is held anywhere yet
                </MenuItem>
              )}
              {sourceOptions.map((option) => (
                <MenuItem key={option.id} value={option.id}>
                  <LocationOption label={option.label} path={option.path} />
                </MenuItem>
              ))}
            </TextField>

            {operation === "transfer" && (
              <TextField
                select
                required
                label="To location"
                value={selectedDestinationId}
                onChange={(event) => setDestinationId(event.target.value)}
                disabled={submitting}
                error={error?.fieldError("toLocationId") !== undefined}
                helperText={error?.fieldError("toLocationId")}
              >
                {stores
                  .filter((store) => store.id !== selectedLocationId)
                  .map((store) => (
                    <MenuItem key={store.id} value={store.id}>
                      <LocationOption label={`${store.code} — ${store.name}`} path={store.path} />
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
                  : currentAtLocation === undefined
                    ? `Quantity in ${item.unit}`
                    : `${formatQuantity(currentAtLocation)} ${item.unit} is available at this location.`)
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
          <Button
            type="submit"
            variant="contained"
            disabled={
              submitting ||
              selectedLocationId === "" ||
              quantity.trim() === "" ||
              (operation === "transfer" && selectedDestinationId === "") ||
              (operation === "adjust" && reason.trim() === "")
            }
          >
            {submitting ? "Working…" : submitLabels[operation]}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
