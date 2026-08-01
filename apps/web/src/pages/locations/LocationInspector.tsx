import ArchiveRounded from "@mui/icons-material/ArchiveRounded";
import ArrowDownwardRounded from "@mui/icons-material/ArrowDownwardRounded";
import ArrowUpwardRounded from "@mui/icons-material/ArrowUpwardRounded";
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import CloseRounded from "@mui/icons-material/CloseRounded";
import DeleteOutlineRounded from "@mui/icons-material/DeleteOutlineRounded";
import MapRounded from "@mui/icons-material/MapRounded";
import RemoveCircleOutlineRounded from "@mui/icons-material/RemoveCircleOutlineRounded";
import WarningAmberRounded from "@mui/icons-material/WarningAmberRounded";
import { Box, Button, Chip, IconButton, Stack, TextField, Typography } from "@mui/material";
import type { MapLocationView } from "@stockcontrol/contracts";
import { memo, type ReactElement } from "react";

import { panelBorder } from "./constants";
import type { LocationChanges } from "./editor-state";
import { geometrySummary } from "./geometry";

interface LocationInspectorProps {
  readonly location: MapLocationView | null;
  readonly canEdit: boolean;
  readonly dirty: boolean;
  readonly onPatch: (id: string, changes: LocationChanges) => void;
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

export const LocationInspector = memo(function LocationInspector({
  location,
  canEdit,
  dirty,
  onPatch,
  onReorder,
  onRemove,
  onClose,
  onSave,
}: LocationInspectorProps): ReactElement {
  return (
    <Box sx={{ p: 1.75 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="start">
        <Box>
          <Typography variant="overline" color="text.secondary">
            Location details
          </Typography>
          {location !== null && (
            <>
              <Typography variant="h3" component="h2" sx={{ mt: 0.25 }}>
                {location.name}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                {location.code === "" ? "Code set on save" : location.code}
              </Typography>
            </>
          )}
        </Box>
        <IconButton size="small" aria-label="Close location details" onClick={onClose}>
          <CloseRounded fontSize="small" />
        </IconButton>
      </Stack>
      {location === null ? (
        <Stack spacing={1.25} sx={{ pt: 7, pb: 5 }}>
          <MapRounded color="primary" sx={{ fontSize: 36 }} />
          <Typography sx={{ fontWeight: 800 }}>Nothing selected</Typography>
          <Typography variant="body2" color="text.secondary">
            Select a shape on the map to see where it sits, what it holds, and its dimensions.
          </Typography>
        </Stack>
      ) : (
        <Stack spacing={1.75} sx={{ mt: 1.5 }}>
          {/*
            Read-only on purpose. Where a location sits is decided by where its
            shape is drawn, so this reflects the map rather than offering a
            second, contradictory way to set it.
          */}
          <Box sx={sectionSx}>
            <Typography variant="overline" color="text.secondary">
              Sits inside
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 700 }} data-testid="breadcrumb">
              {location.path === "" ? location.name : location.path}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {location.derivedParentId === null
                ? "Not inside anything else. Drag it into another shape to nest it."
                : "Worked out from the map. Drag the shape to change it."}
            </Typography>
          </Box>
          <Box sx={sectionSx}>
            <Typography variant="overline" color="text.secondary">
              Stock status
            </Typography>
            <Chip
              icon={<StockStatusIcon status={location.stock.status} />}
              label={location.stock.text}
              sx={{
                mt: 0.75,
                alignSelf: "start",
                bgcolor: location.stock.colour,
                color: "#fff",
                "& .MuiChip-icon": { color: "inherit" },
              }}
            />
            <Stack direction="row" spacing={2.5} sx={{ mt: 1.5 }}>
              <Box>
                <Typography variant="h4">{location.stock.itemCount}</Typography>
                <Typography variant="caption" color="text.secondary">
                  item types
                </Typography>
              </Box>
              <Box>
                <Typography variant="h4">{location.stock.quantity}</Typography>
                <Typography variant="caption" color="text.secondary">
                  total units
                </Typography>
              </Box>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Includes everything drawn inside this shape.
            </Typography>
          </Box>
          <Box sx={sectionSx}>
            <Typography variant="overline" color="text.secondary">
              Mapped area
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 700 }}>
              {geometrySummary(location.geometry)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Drag the shape or its corner handles, or nudge it with the arrow keys.
            </Typography>
          </Box>
          {canEdit && (
            <Stack spacing={1.25}>
              <Typography variant="overline" color="text.secondary">
                Properties
              </Typography>
              <TextField
                fullWidth
                label="Location name"
                size="small"
                value={location.name}
                onChange={(event) => {
                  onPatch(location.id, { name: event.target.value });
                }}
              />
              <TextField
                fullWidth
                label="Search aliases"
                size="small"
                value={location.searchAliases.join(", ")}
                helperText="Separate aliases with commas"
                onChange={(event) => {
                  onPatch(location.id, {
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
                    onReorder(location.id, "raise");
                  }}
                  sx={actionSx}
                >
                  Raise
                </Button>
                <Button
                  size="small"
                  startIcon={<ArrowDownwardRounded />}
                  onClick={() => {
                    onReorder(location.id, "lower");
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
                    onPatch(location.id, {
                      status: location.status === "Archived" ? "Active" : "Archived",
                    });
                  }}
                  sx={actionSx}
                >
                  {location.status === "Archived" ? "Restore" : "Archive"}
                </Button>
                <Button
                  size="small"
                  color="error"
                  variant="outlined"
                  startIcon={<DeleteOutlineRounded />}
                  onClick={() => {
                    onRemove(location.id);
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
                Arrow keys move the selected shape, Shift + Arrow moves farther, Delete removes it.
                A location that has held stock is archived rather than erased.
              </Typography>
            </Stack>
          )}
        </Stack>
      )}
    </Box>
  );
});
