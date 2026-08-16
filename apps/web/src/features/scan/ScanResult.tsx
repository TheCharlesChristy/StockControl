import AddBoxRounded from "@mui/icons-material/AddBoxRounded";
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import OpenInNewRounded from "@mui/icons-material/OpenInNewRounded";
import { Alert, Button, Chip, Paper, Stack, Typography } from "@mui/material";
import type { ItemDetailView } from "@stockcontrol/contracts";
import type { ReactElement } from "react";

import { formatQuantity } from "../../components/DataStates";
import { ItemAvatar } from "../../components/ItemAvatar";

interface ScanResultProps {
  readonly item: ItemDetailView;
  /** Set once stock has been received against this item in this sheet, so the
   *  card reports the outcome instead of offering the same action again. */
  readonly received: boolean;
  readonly canAddStock: boolean;
  readonly onOpen: () => void;
  readonly onAddStock: () => void;
  readonly onScanAnother: () => void;
}

/**
 * What a scanned label turns into.
 *
 * The card exists because there is a decision to make: an Office or Admin user
 * standing over a delivery usually wants to put stock in, not read the record.
 * Where there is no decision — a role that can only look — the sheet opens the
 * item directly instead of rendering this, so nobody pays a tap for a choice
 * they do not have.
 */
export function ScanResult({
  item,
  received,
  canAddStock,
  onOpen,
  onAddStock,
  onScanAnother,
}: ScanResultProps): ReactElement {
  return (
    <Stack spacing={1.5}>
      {received && (
        <Alert severity="success" icon={<CheckCircleRounded fontSize="inherit" />}>
          Stock received. {item.reference} now holds {formatQuantity(item.onHand)} {item.unit}.
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 1.75 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <ItemAvatar name={item.name} photoUrl={item.coverPhotoUrl} size={44} />
          <Stack sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontWeight: 750 }} noWrap>
              {item.name}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {item.reference} — {formatQuantity(item.onHand)} {item.unit} on hand
            </Typography>
          </Stack>
          {!item.isActive && <Chip size="small" color="warning" label="Archived" />}
        </Stack>
      </Paper>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        {canAddStock && !received && (
          /* First, and primary: standing in front of a delivery, this is the
           * reason the label was scanned. Archived items cannot receive stock,
           * which the item page explains and offers to undo. */
          <Button
            variant="contained"
            startIcon={<AddBoxRounded />}
            disabled={!item.isActive}
            onClick={onAddStock}
            sx={{ flex: 1 }}
          >
            Add stock
          </Button>
        )}
        <Button
          variant={canAddStock && !received ? "outlined" : "contained"}
          startIcon={<OpenInNewRounded />}
          onClick={onOpen}
          sx={{ flex: 1 }}
        >
          Open item
        </Button>
        <Button onClick={onScanAnother} sx={{ flex: 1 }}>
          Scan another
        </Button>
      </Stack>

      {canAddStock && !item.isActive && !received && (
        <Typography variant="body2" color="text.secondary">
          This item is archived, so it cannot take stock. Open it to bring it back into use first.
        </Typography>
      )}
    </Stack>
  );
}
