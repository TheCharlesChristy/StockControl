import ArchiveRounded from "@mui/icons-material/ArchiveRounded";
import ArrowDownwardRounded from "@mui/icons-material/ArrowDownwardRounded";
import ArrowUpwardRounded from "@mui/icons-material/ArrowUpwardRounded";
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import CloseRounded from "@mui/icons-material/CloseRounded";
import DeleteOutlineRounded from "@mui/icons-material/DeleteOutlineRounded";
import MapRounded from "@mui/icons-material/MapRounded";
import RemoveCircleOutlineRounded from "@mui/icons-material/RemoveCircleOutlineRounded";
import WarningAmberRounded from "@mui/icons-material/WarningAmberRounded";
import {
  Box,
  Button,
  Chip,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { HierarchyNodeView, MapRegionView } from "@stockcontrol/contracts";
import { memo, type ReactElement } from "react";

import { panelBorder } from "./constants";
import type { RegionChanges } from "./editor-state";
import { geometrySummary } from "./geometry";

interface RegionInspectorProps {
  readonly region: MapRegionView | null;
  readonly canEdit: boolean;
  readonly dirty: boolean;
  readonly locationCode: string;
  readonly nodeOptions: readonly HierarchyNodeView[];
  readonly parentOptions: readonly MapRegionView[];
  readonly onPatch: (id: string, changes: RegionChanges) => void;
  readonly onReorder: (id: string, direction: "raise" | "lower") => void;
  readonly onRemove: (id: string) => void;
  readonly onClose: () => void;
  readonly onSave: () => void;
}

const sectionSx = { pb: 1.75, borderBottom: `1px solid ${panelBorder}` } as const;
const actionSx = { minHeight: 36, px: 1.25 } as const;

function StockStatusIcon({ status }: { readonly status: string }): ReactElement {
  if (status === "Available") return <CheckCircleRounded fontSize="small" />;
  if (status === "LowStock") return <WarningAmberRounded fontSize="small" />;
  if (status === "Archived") return <ArchiveRounded fontSize="small" />;
  return <RemoveCircleOutlineRounded fontSize="small" />;
}

export const RegionInspector = memo(function RegionInspector({
  region,
  canEdit,
  dirty,
  locationCode,
  nodeOptions,
  parentOptions,
  onPatch,
  onReorder,
  onRemove,
  onClose,
  onSave,
}: RegionInspectorProps): ReactElement {
  return (
    <Box sx={{ p: 1.75 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="start">
        <Box>
          <Typography variant="overline" color="text.secondary">
            Region details
          </Typography>
          {region !== null && (
            <>
              <Typography variant="h3" component="h2" sx={{ mt: 0.25 }}>
                {region.displayName}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                {locationCode}
              </Typography>
            </>
          )}
        </Box>
        <IconButton size="small" aria-label="Close region details" onClick={onClose}>
          <CloseRounded fontSize="small" />
        </IconButton>
      </Stack>
      {region === null ? (
        <Stack spacing={1.25} sx={{ pt: 7, pb: 5 }}>
          <MapRounded color="primary" sx={{ fontSize: 36 }} />
          <Typography sx={{ fontWeight: 800 }}>Nothing selected</Typography>
          <Typography variant="body2" color="text.secondary">
            Select a region on the map to view its assigned location, stock status, item quantities
            and dimensions.
          </Typography>
        </Stack>
      ) : (
        <Stack spacing={1.75} sx={{ mt: 1.5 }}>
          <Box sx={sectionSx}>
            <Typography variant="overline" color="text.secondary">
              Stock status
            </Typography>
            <Chip
              icon={<StockStatusIcon status={region.stock.status} />}
              label={region.stock.text}
              sx={{
                mt: 0.75,
                alignSelf: "start",
                bgcolor: region.stock.colour,
                color: "#fff",
                "& .MuiChip-icon": { color: "inherit" },
              }}
            />
            <Stack direction="row" spacing={2.5} sx={{ mt: 1.5 }}>
              <Box>
                <Typography variant="h4">{region.stock.itemCount}</Typography>
                <Typography variant="caption" color="text.secondary">
                  item types
                </Typography>
              </Box>
              <Box>
                <Typography variant="h4">{region.stock.quantity}</Typography>
                <Typography variant="caption" color="text.secondary">
                  total units
                </Typography>
              </Box>
            </Stack>
          </Box>
          <Box sx={sectionSx}>
            <Typography variant="overline" color="text.secondary">
              Mapped area
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 700 }}>
              {geometrySummary(region.geometry)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Drag the region or its corner handles, or nudge it with the arrow keys.
            </Typography>
          </Box>
          {canEdit && (
            <Stack spacing={1.25}>
              <Typography variant="overline" color="text.secondary">
                Properties
              </Typography>
              <TextField
                fullWidth
                label="Region name"
                size="small"
                value={region.displayName}
                onChange={(event) => {
                  onPatch(region.id, { displayName: event.target.value });
                }}
              />
              <FormControl fullWidth size="small">
                <InputLabel id="region-location-label">Location assignment</InputLabel>
                <Select
                  labelId="region-location-label"
                  label="Location assignment"
                  value={region.hierarchyNodeId}
                  onChange={(event) => {
                    onPatch(region.id, { hierarchyNodeId: event.target.value });
                  }}
                >
                  {nodeOptions.map((node) => (
                    <MenuItem key={node.id} value={node.id}>
                      {node.name} · {node.code}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel id="region-parent-label">Visual parent</InputLabel>
                <Select
                  labelId="region-parent-label"
                  label="Visual parent"
                  value={region.parentRegionId ?? "none"}
                  onChange={(event) => {
                    onPatch(region.id, {
                      parentRegionId: event.target.value === "none" ? null : event.target.value,
                    });
                  }}
                >
                  <MenuItem value="none">None</MenuItem>
                  {parentOptions.map((candidate) => (
                    <MenuItem key={candidate.id} value={candidate.id}>
                      {candidate.displayName}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                fullWidth
                label="Search aliases"
                size="small"
                value={region.searchAliases.join(", ")}
                helperText="Separate aliases with commas"
                onChange={(event) => {
                  onPatch(region.id, {
                    searchAliases: event.target.value
                      .split(",")
                      .map((alias) => alias.trim())
                      .filter((alias) => alias.length > 0),
                  });
                }}
              />
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                <Button
                  size="small"
                  startIcon={<ArrowUpwardRounded />}
                  onClick={() => {
                    onReorder(region.id, "raise");
                  }}
                  sx={actionSx}
                >
                  Raise
                </Button>
                <Button
                  size="small"
                  startIcon={<ArrowDownwardRounded />}
                  onClick={() => {
                    onReorder(region.id, "lower");
                  }}
                  sx={actionSx}
                >
                  Lower
                </Button>
                <Button
                  size="small"
                  color="error"
                  startIcon={<ArchiveRounded />}
                  onClick={() => {
                    onPatch(region.id, {
                      status: region.status === "Archived" ? "Active" : "Archived",
                    });
                  }}
                  sx={actionSx}
                >
                  {region.status === "Archived" ? "Restore" : "Archive"}
                </Button>
                <Button
                  size="small"
                  color="error"
                  variant="outlined"
                  startIcon={<DeleteOutlineRounded />}
                  onClick={() => {
                    onRemove(region.id);
                  }}
                  sx={actionSx}
                >
                  Delete
                </Button>
              </Stack>
              <Button
                fullWidth
                variant="contained"
                onClick={onSave}
                disabled={!dirty}
                sx={{ mt: 0.5 }}
              >
                Save changes
              </Button>
              <Typography variant="caption" color="text.secondary">
                Arrow keys move the selected region, Shift + Arrow moves farther, Delete removes it.
              </Typography>
            </Stack>
          )}
        </Stack>
      )}
    </Box>
  );
});
