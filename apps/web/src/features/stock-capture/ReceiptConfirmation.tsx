import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { LocationView } from "@stockcontrol/contracts";
import type { ReactElement } from "react";

import type { ReceiptDraft, ReceiptSelection } from "./capture-reducer";

interface ReceiptConfirmationProps {
  readonly selection: ReceiptSelection;
  readonly draft: ReceiptDraft;
  readonly locations: readonly LocationView[];
  readonly submitting: boolean;
  readonly error: string | null;
  readonly duplicatePartNumberConflict: boolean;
  readonly onSelectionChange: (selection: ReceiptSelection) => void;
  readonly onDraftChange: (draft: Partial<ReceiptDraft>) => void;
  readonly onSubmit: () => void;
  readonly onBack: () => void;
}

/** A location option with where it sits on the map underneath it. */
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

/**
 * The final screen, specification section 5.2 steps 11-14: item, quantity,
 * unit and full location path, all editable, none of it committed until this
 * form is submitted. A new item's fields stay editable here because nothing
 * from a candidate is trusted until a person saves it.
 */
export function ReceiptConfirmation({
  selection,
  draft,
  locations,
  submitting,
  error,
  duplicatePartNumberConflict,
  onSelectionChange,
  onDraftChange,
  onSubmit,
  onBack,
}: ReceiptConfirmationProps): ReactElement {
  const stores = locations.filter((location) => location.kind === "Store" && location.isActive);

  const canSubmit =
    draft.quantity.trim() !== "" &&
    draft.locationId !== "" &&
    (selection.kind === "ExistingItem" ||
      (selection.name.trim() !== "" && selection.unit.trim() !== "")) &&
    (!duplicatePartNumberConflict || draft.acknowledgedDuplicatePartNumber);

  return (
    <Stack spacing={2.5}>
      {selection.kind === "ExistingItem" ? (
        <Typography variant="subtitle1">{selection.label}</Typography>
      ) : (
        <Stack spacing={2}>
          <TextField
            required
            label="Name"
            value={selection.name}
            disabled={submitting}
            onChange={(event) => onSelectionChange({ ...selection, name: event.target.value })}
          />
          <TextField
            required
            label="Unit"
            value={selection.unit}
            disabled={submitting}
            helperText="How this item is counted — each, box, metre."
            onChange={(event) => onSelectionChange({ ...selection, unit: event.target.value })}
          />
          <TextField
            label="Reference"
            value={selection.reference ?? ""}
            disabled={submitting}
            helperText="Leave blank to have StockControl generate one."
            onChange={(event) =>
              onSelectionChange({
                ...selection,
                reference: event.target.value.trim() === "" ? null : event.target.value,
              })
            }
          />
          <TextField
            label="Barcode"
            value={selection.barcode ?? ""}
            disabled={submitting}
            onChange={(event) =>
              onSelectionChange({
                ...selection,
                barcode: event.target.value.trim() === "" ? null : event.target.value,
              })
            }
          />
          <TextField
            label="Part number"
            value={selection.partNumber ?? ""}
            disabled={submitting}
            onChange={(event) =>
              onSelectionChange({
                ...selection,
                partNumber: event.target.value.trim() === "" ? null : event.target.value,
              })
            }
          />
        </Stack>
      )}

      <TextField
        required
        label="Quantity"
        value={draft.quantity}
        inputMode="decimal"
        disabled={submitting}
        onChange={(event) => onDraftChange({ quantity: event.target.value })}
      />

      <TextField
        select
        required
        label="Location"
        value={draft.locationId}
        disabled={submitting}
        helperText="Choose the store where this stock arrived."
        onChange={(event) => onDraftChange({ locationId: event.target.value })}
      >
        {stores.length === 0 && (
          <MenuItem value="" disabled>
            No active stores are set up yet
          </MenuItem>
        )}
        {stores.map((store) => (
          <MenuItem key={store.id} value={store.id}>
            <LocationOption label={`${store.code} — ${store.name}`} path={store.path} />
          </MenuItem>
        ))}
      </TextField>

      {duplicatePartNumberConflict && (
        <FormControlLabel
          control={
            <Checkbox
              checked={draft.acknowledgedDuplicatePartNumber}
              disabled={submitting}
              onChange={(event) =>
                onDraftChange({ acknowledgedDuplicatePartNumber: event.target.checked })
              }
            />
          }
          label="Another active item already uses this part number. Create this one anyway."
        />
      )}

      {error !== null && <Alert severity="error">{error}</Alert>}

      <Stack direction="row" spacing={1.5} justifyContent="space-between">
        <Button onClick={onBack} disabled={submitting}>
          Back to suggestions
        </Button>
        <Button variant="contained" onClick={onSubmit} disabled={!canSubmit || submitting}>
          {submitting ? "Saving…" : "Confirm receipt"}
        </Button>
      </Stack>
    </Stack>
  );
}
