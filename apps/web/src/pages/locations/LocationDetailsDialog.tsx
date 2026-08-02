import { Dialog } from "@mui/material";
import type { MapLocationView } from "@stockcontrol/contracts";
import { memo, type ReactElement } from "react";

import { LocationInspector } from "./LocationInspector";
import type { LocationChanges } from "./editor-state";

interface LocationDetailsDialogProps {
  readonly location: MapLocationView | null;
  readonly open: boolean;
  readonly canEdit: boolean;
  readonly dirty: boolean;
  readonly onPatch: (id: string, changes: LocationChanges) => void;
  readonly onReorder: (id: string, direction: "raise" | "lower") => void;
  readonly onRemove: (id: string) => void;
  readonly onClose: () => void;
  readonly onSave: () => void;
}

export const LocationDetailsDialog = memo(function LocationDetailsDialog({
  location,
  open,
  canEdit,
  dirty,
  onPatch,
  onReorder,
  onRemove,
  onClose,
  onSave,
}: LocationDetailsDialogProps): ReactElement {
  return (
    <Dialog
      open={open && location !== null}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="location-details-title"
    >
      <LocationInspector
        location={location}
        canEdit={canEdit}
        dirty={dirty}
        onPatch={onPatch}
        onReorder={onReorder}
        onRemove={onRemove}
        onClose={onClose}
        onSave={onSave}
      />
    </Dialog>
  );
});
