import MapRounded from "@mui/icons-material/MapRounded";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import type {
  ItemDetailView,
  MapGeometry,
  MapLocationView,
  MapView,
} from "@stockcontrol/contracts";
import { useEffect, useMemo, useState, type ReactElement } from "react";

import { ApiError, type ApiClient } from "../api/ApiClient";
import { formatQuantity } from "../components/DataStates";
import { ItemAvatar } from "../components/ItemAvatar";

interface ItemLocationDialogProps {
  readonly open: boolean;
  readonly item: ItemDetailView;
  readonly api: ApiClient;
  readonly onClose: () => void;
}

const MAP_UNITS = 100;

const pointsFor = (geometry: MapGeometry): string => {
  if (geometry.kind === "Polygon") {
    return geometry.points
      .map((point) => `${point.x * MAP_UNITS},${point.y * MAP_UNITS}`)
      .join(" ");
  }
  return "";
};

function PreviewShape({
  location,
  highlighted,
}: {
  readonly location: MapLocationView;
  readonly highlighted: boolean;
}): ReactElement {
  const shapeProps = {
    fill: highlighted ? "#1976D2" : "#D9E2EC",
    fillOpacity: highlighted ? 0.9 : 0.75,
    stroke: highlighted ? "#0D47A1" : "#7A8A9E",
    strokeWidth: highlighted ? 1.5 : 0.7,
    vectorEffect: "non-scaling-stroke" as const,
  };

  return (
    <g>
      <title>{highlighted ? `${location.name} — item stock location` : location.name}</title>
      {location.geometry.kind === "Rectangle" ? (
        <rect
          {...shapeProps}
          x={location.geometry.x * MAP_UNITS}
          y={location.geometry.y * MAP_UNITS}
          width={location.geometry.width * MAP_UNITS}
          height={location.geometry.height * MAP_UNITS}
        />
      ) : (
        <polygon {...shapeProps} points={pointsFor(location.geometry)} />
      )}
    </g>
  );
}

function MapPreview({
  map,
  locationIds,
  balanceByLocationId,
  itemUnit,
}: {
  readonly map: MapView;
  readonly locationIds: ReadonlySet<string>;
  readonly balanceByLocationId: ReadonlyMap<string, ItemDetailView["balances"][number]>;
  readonly itemUnit: string;
}): ReactElement {
  const mapLocations = map.locations.filter((location) => locationIds.has(location.id));

  return (
    <Paper variant="outlined" sx={{ overflow: "hidden" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ p: 2 }}>
        <Box>
          <Typography variant="h3" component="h3">
            {map.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {map.code}
          </Typography>
        </Box>
        <Typography variant="caption" color="primary.main" fontWeight={700}>
          {mapLocations.length} location{mapLocations.length === 1 ? "" : "s"} highlighted
        </Typography>
      </Stack>
      <Divider />
      <Box sx={{ p: { xs: 1.5, sm: 2.5 }, bgcolor: "#F8FAFC" }}>
        <Box
          sx={{
            width: "100%",
            aspectRatio: "1 / 0.72",
            minHeight: 220,
            maxHeight: 440,
            border: "1px solid",
            borderColor: "divider",
            bgcolor: "#FFFFFF",
          }}
        >
          <svg
            viewBox="0 0 100 100"
            role="img"
            aria-label={`${map.name} showing where ${mapLocations.length === 1 ? "the item is" : "the item is stored"}`}
            style={{ width: "100%", height: "100%", display: "block" }}
          >
            <rect x="0" y="0" width="100" height="100" fill="#FFFFFF" />
            {map.background.kind === "FloorPlan" && map.background.downloadPath !== undefined && (
              <image
                href={map.background.downloadPath}
                x="0"
                y="0"
                width="100"
                height="100"
                preserveAspectRatio="xMidYMid slice"
                opacity={0.25}
                aria-label={map.background.originalFileName ?? "Floor plan"}
              />
            )}
            {map.locations.map((location) => (
              <PreviewShape
                key={location.id}
                location={location}
                highlighted={locationIds.has(location.id)}
              />
            ))}
          </svg>
        </Box>
        <Stack spacing={0.75} sx={{ mt: 1.5 }}>
          {mapLocations.map((location) => {
            const balance = balanceByLocationId.get(location.id);
            return (
              <Stack
                key={location.id}
                direction="row"
                justifyContent="space-between"
                alignItems="baseline"
                sx={{ px: 1, py: 0.5, borderRadius: 1, bgcolor: "rgba(25,118,210,0.08)" }}
              >
                <Box>
                  <Typography variant="body2" fontWeight={700}>
                    {location.code}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {location.name}
                  </Typography>
                </Box>
                <Typography variant="body2" fontWeight={700}>
                  {balance === undefined ? "—" : `${formatQuantity(balance.quantity)} ${itemUnit}`}
                </Typography>
              </Stack>
            );
          })}
        </Stack>
      </Box>
    </Paper>
  );
}

export function ItemLocationDialog({
  open,
  item,
  api,
  onClose,
}: ItemLocationDialogProps): ReactElement {
  const [maps, setMaps] = useState<readonly MapView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void api
      .listMaps(controller.signal)
      .then((summaries) =>
        Promise.all(summaries.map((summary) => api.getMap(summary.id, controller.signal))),
      )
      .then((loadedMaps) => {
        setMaps(loadedMaps);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          caught instanceof ApiError ? caught.message : "The location map could not be loaded.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, open]);

  const balanceByLocationId = useMemo(
    () => new Map(item.balances.map((balance) => [balance.locationId, balance] as const)),
    [item.balances],
  );
  const mappedLocationIds = useMemo(
    () => new Set(maps.flatMap((map) => map.locations.map((location) => location.id))),
    [maps],
  );
  const mapsWithItemLocations = maps.filter((map) =>
    map.locations.some((location) => balanceByLocationId.has(location.id)),
  );
  const unmappedBalances = item.balances.filter(
    (balance) => !mappedLocationIds.has(balance.locationId),
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      aria-labelledby="item-location-title"
    >
      <DialogTitle id="item-location-title" sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <ItemAvatar name={item.name} photoUrl={item.coverPhotoUrl} size={32} />
          <Box>
            Where is {item.reference}?
            <Typography component="span" color="text.secondary">
              {` — ${item.name}`}
            </Typography>
          </Box>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {loading && (
          <Stack alignItems="center" spacing={1.5} sx={{ py: 6 }}>
            <CircularProgress size={28} />
            <Typography color="text.secondary">Loading storage maps…</Typography>
          </Stack>
        )}
        {!loading && error !== null && <Alert severity="error">{error}</Alert>}
        {!loading && error === null && mapsWithItemLocations.length === 0 && (
          <Alert severity="info">
            This item is not currently held in a mapped storage location.
          </Alert>
        )}
        {!loading && error === null && mapsWithItemLocations.length > 0 && (
          <Stack spacing={2}>
            <Typography color="text.secondary">
              Blue areas show where this item is stored. Quantities are shown below each map.
            </Typography>
            {mapsWithItemLocations.map((map) => (
              <MapPreview
                key={map.id}
                map={map}
                locationIds={
                  new Set(
                    map.locations
                      .filter((location) => balanceByLocationId.has(location.id))
                      .map((location) => location.id),
                  )
                }
                balanceByLocationId={balanceByLocationId}
                itemUnit={item.unit}
              />
            ))}
          </Stack>
        )}
        {!loading && error === null && unmappedBalances.length > 0 && (
          <Box sx={{ mt: mapsWithItemLocations.length > 0 ? 2 : 0 }}>
            <Typography variant="h3" component="h3" sx={{ mb: 1 }}>
              Other locations
            </Typography>
            <Stack spacing={0.5}>
              {unmappedBalances.map((balance) => (
                <Stack key={balance.locationId} direction="row" justifyContent="space-between">
                  <Typography>
                    <strong>{balance.locationCode}</strong> — {balance.locationName}
                  </Typography>
                  <Typography fontWeight={700}>
                    {formatQuantity(balance.quantity)} {item.unit}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export function ItemLocationButton({ onClick }: { readonly onClick: () => void }): ReactElement {
  return (
    <Button variant="outlined" startIcon={<MapRounded />} onClick={onClick}>
      Show on map
    </Button>
  );
}
