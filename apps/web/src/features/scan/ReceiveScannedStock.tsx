import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import type { ItemDetailView } from "@stockcontrol/contracts";
import { useCallback, type ReactElement } from "react";

import { useApi, useResource } from "../../api/ApiContext";
import { ErrorState, LoadingRows } from "../../components/DataStates";
import { StockOperationDialog } from "../../components/StockOperationDialog";

interface ReceiveScannedStockProps {
  readonly item: ItemDetailView;
  readonly onClose: () => void;
  readonly onReceived: (item: ItemDetailView) => void;
}

/**
 * The short way in: a label scanned in front of a delivery becomes a receipt
 * without a recognition round trip, because the item is already known. It is
 * the ordinary receive operation, recorded the same way from the same route.
 *
 * Locations load only once somebody asks for this, so the sheet costs one
 * request to open and nothing extra for the many scans that just look an item
 * up.
 */
export function ReceiveScannedStock({
  item,
  onClose,
  onReceived,
}: ReceiveScannedStockProps): ReactElement {
  const api = useApi();
  const loadLocations = useCallback((signal: AbortSignal) => api.listLocations(signal), [api]);
  const locations = useResource(loadLocations);

  if (locations.status !== "ready") {
    return (
      <Dialog open onClose={onClose} fullWidth maxWidth="sm">
        <DialogTitle>Receive stock</DialogTitle>
        <DialogContent dividers>
          {locations.error === undefined ? (
            <LoadingRows rows={3} label="Loading stores" />
          ) : (
            <ErrorState error={locations.error} onRetry={locations.reload} />
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose}>Cancel</Button>
        </DialogActions>
      </Dialog>
    );
  }

  return (
    <StockOperationDialog
      operation="receive"
      item={item}
      locations={locations.data?.locations ?? []}
      onClose={onClose}
      onCompleted={onReceived}
    />
  );
}
