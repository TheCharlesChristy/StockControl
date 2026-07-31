import FitScreenRounded from "@mui/icons-material/FitScreenRounded";
import GridOnRounded from "@mui/icons-material/GridOnRounded";
import LoginRounded from "@mui/icons-material/LoginRounded";
import LogoutRounded from "@mui/icons-material/LogoutRounded";
import PanToolRounded from "@mui/icons-material/PanToolRounded";
import PolylineRounded from "@mui/icons-material/PolylineRounded";
import NearMeRounded from "@mui/icons-material/NearMeRounded";
import UploadFileRounded from "@mui/icons-material/UploadFileRounded";
import ZoomInRounded from "@mui/icons-material/ZoomInRounded";
import ZoomOutRounded from "@mui/icons-material/ZoomOutRounded";
import {
  Box,
  Button,
  Chip,
  IconButton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { memo, type ReactElement } from "react";

import { toggleGroupSx, toolbarGroupSx, toolbarSx } from "./constants";
import type { EditorMode } from "./editor-state";

interface MapToolbarProps {
  readonly canEdit: boolean;
  readonly hasMap: boolean;
  readonly dirty: boolean;
  readonly mode: EditorMode;
  readonly snapEnabled: boolean;
  readonly zoomPercentage: number;
  readonly onModeChange: (mode: EditorMode) => void;
  readonly onToggleSnap: () => void;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onFit: () => void;
  readonly onSave: () => void;
  readonly onRevert: () => void;
  readonly onUploadClick: () => void;
}

function ToolbarButton({
  label,
  onClick,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactElement;
}): ReactElement {
  return (
    <Tooltip title={label}>
      <IconButton aria-label={label} onClick={onClick} size="small">
        {children}
      </IconButton>
    </Tooltip>
  );
}

export const MapToolbar = memo(function MapToolbar({
  canEdit,
  hasMap,
  dirty,
  mode,
  snapEnabled,
  zoomPercentage,
  onModeChange,
  onToggleSnap,
  onZoomIn,
  onZoomOut,
  onFit,
  onSave,
  onRevert,
  onUploadClick,
}: MapToolbarProps): ReactElement {
  return (
    <Box component="nav" aria-label="Map toolbar" sx={toolbarSx}>
      <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
        <Box sx={toolbarGroupSx}>
          {canEdit ? (
            <ToggleButtonGroup
              exclusive
              size="small"
              value={mode === "select" || mode === "pan" ? mode : null}
              onChange={(_, value: EditorMode | null) => {
                if (value !== null) onModeChange(value);
              }}
              aria-label="Navigation tools"
              sx={toggleGroupSx}
            >
              <ToggleButton value="select" aria-label="Select mode" title="Select">
                <NearMeRounded fontSize="small" />
              </ToggleButton>
              <ToggleButton value="pan" aria-label="Pan map" title="Pan (or hold space)">
                <PanToolRounded fontSize="small" />
              </ToggleButton>
            </ToggleButtonGroup>
          ) : (
            <Chip size="small" label="View only" variant="outlined" />
          )}
        </Box>
        {canEdit && (
          <Box sx={toolbarGroupSx}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={mode === "rectangle" || mode === "polygon" ? mode : null}
              onChange={(_, value: EditorMode | null) => {
                if (value !== null) onModeChange(value);
              }}
              aria-label="Drawing tools"
              sx={toggleGroupSx}
            >
              <ToggleButton value="rectangle" aria-label="Draw rectangle" title="Rectangle">
                <Box
                  component="span"
                  sx={{ width: 16, height: 12, border: "2px solid currentColor" }}
                />
              </ToggleButton>
              <ToggleButton value="polygon" aria-label="Draw polygon" title="Polygon">
                <PolylineRounded fontSize="small" />
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>
        )}
        {canEdit && (
          <Box sx={toolbarGroupSx}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={mode === "entrance" || mode === "exit" ? mode : null}
              onChange={(_, value: EditorMode | null) => {
                if (value !== null) onModeChange(value);
              }}
              aria-label="Building access point tools"
              sx={toggleGroupSx}
            >
              <ToggleButton value="entrance" aria-label="Place entrance" title="Place entrance">
                <LoginRounded fontSize="small" />
              </ToggleButton>
              <ToggleButton value="exit" aria-label="Place exit" title="Place exit">
                <LogoutRounded fontSize="small" />
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>
        )}
        <Stack direction="row" spacing={0.25} alignItems="center">
          <ToolbarButton label="Zoom out" onClick={onZoomOut}>
            <ZoomOutRounded fontSize="small" />
          </ToolbarButton>
          <Typography
            variant="caption"
            aria-live="polite"
            sx={{ minWidth: 46, textAlign: "center", fontWeight: 800, color: "text.secondary" }}
          >
            {String(zoomPercentage)}%
          </Typography>
          <ToolbarButton label="Zoom in" onClick={onZoomIn}>
            <ZoomInRounded fontSize="small" />
          </ToolbarButton>
          <ToolbarButton label="Fit map to canvas" onClick={onFit}>
            <FitScreenRounded fontSize="small" />
          </ToolbarButton>
        </Stack>
        {canEdit && (
          <ToggleButton
            value="snap"
            selected={snapEnabled}
            onChange={onToggleSnap}
            size="small"
            aria-label="Snap to grid"
            title="Snap to grid (hold Alt to override)"
            sx={toggleGroupSx}
          >
            <GridOnRounded fontSize="small" />
          </ToggleButton>
        )}
      </Stack>
      <Stack direction="row" spacing={0.75} alignItems="center">
        {dirty && <Chip size="small" label="Unsaved changes" color="warning" />}
        {canEdit && hasMap && (
          <>
            <Button
              size="small"
              startIcon={<UploadFileRounded />}
              onClick={onUploadClick}
              sx={{ minHeight: 34, px: 1.25, display: { xs: "none", sm: "inline-flex" } }}
            >
              Upload floor plan
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={onSave}
              sx={{ minHeight: 34, px: 1.5 }}
            >
              Save
            </Button>
            <Button
              size="small"
              onClick={onRevert}
              disabled={!dirty}
              sx={{ minHeight: 34, px: 1.25, display: { xs: "none", sm: "inline-flex" } }}
            >
              Revert
            </Button>
          </>
        )}
      </Stack>
    </Box>
  );
});
