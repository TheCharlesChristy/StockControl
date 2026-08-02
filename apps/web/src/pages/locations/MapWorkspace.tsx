import AddRounded from "@mui/icons-material/AddRounded";
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded";
import MapRounded from "@mui/icons-material/MapRounded";
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Collapse,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import type { MapGeometry, MapView } from "@stockcontrol/contracts";
import { useCallback, useRef, useState, type ReactElement, type RefObject } from "react";

import { emptyCanvasSx, floatingPanel } from "./constants";
import type { EditorMode } from "./editor-state";
import { createLiveGeometryStore } from "./live-geometry-store";
import { MapCanvas } from "./MapCanvas";
import { MapLegend } from "./MapLegend";
import { MapToolbar } from "./MapToolbar";
import type { MapRuleViolation } from "./map-rules";
import { useMapViewport } from "./use-map-viewport";

interface MapWorkspaceProps {
  readonly map: MapView | null;
  readonly canEdit: boolean;
  readonly dirty: boolean;
  readonly mode: EditorMode;
  readonly snapEnabled: boolean;
  readonly selectedLocationId: string | null;
  readonly canCreateMap: boolean;
  readonly svgRef: RefObject<SVGSVGElement | null>;
  readonly onModeChange: (mode: EditorMode) => void;
  readonly onToggleSnap: () => void;
  readonly onSelect: (id: string | null) => void;
  readonly onOpenDetails: (id: string) => void;
  readonly onOpenContextMenu: (
    id: string,
    position: { readonly top: number; readonly left: number },
  ) => void;
  readonly onCommitGeometry: (id: string, geometry: MapGeometry) => void;
  readonly onCreateLocation: (geometry: MapGeometry) => void;
  readonly onRemoveLocation: (id: string) => void;
  readonly onSave: () => void;
  readonly onRevert: () => void;
  readonly onUploadFile: (file: File) => void;
  readonly onCreateMap: () => void;
  readonly onProblem: (message: string) => void;
  readonly ruleViolations: readonly MapRuleViolation[];
}

const hintSx = { ...floatingPanel, left: 16, bottom: 16, maxWidth: "min(340px, 55%)" } as const;

/**
 * Toolbar plus canvas. Owns the viewport and the live-geometry store, so pan,
 * zoom and drags all stay below the page that loads the data.
 */
export function MapWorkspace({
  map,
  canEdit,
  dirty,
  mode,
  snapEnabled,
  selectedLocationId,
  canCreateMap,
  svgRef,
  onModeChange,
  onToggleSnap,
  onSelect,
  onOpenDetails,
  onOpenContextMenu,
  onCommitGeometry,
  onCreateLocation,
  onRemoveLocation,
  onSave,
  onRevert,
  onUploadFile,
  onCreateMap,
  onProblem,
  ruleViolations,
}: MapWorkspaceProps): ReactElement {
  const viewport = useMapViewport();
  const [store] = useState(createLiveGeometryStore);
  const [rulesExpanded, setRulesExpanded] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const zoomIn = useCallback(() => {
    viewport.zoomByStep(1);
  }, [viewport]);
  const zoomOut = useCallback(() => {
    viewport.zoomByStep(-1);
  }, [viewport]);
  const openFilePicker = useCallback(() => {
    fileInput.current?.click();
  }, []);

  return (
    <Box
      component="section"
      aria-label="Location map"
      data-help-target="locations-map"
      sx={{
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)",
        minWidth: 0,
        minHeight: { xs: 600, lg: 0 },
        overflow: "hidden",
        userSelect: "none",
      }}
    >
      <MapToolbar
        canEdit={canEdit}
        hasMap={map !== null}
        dirty={dirty}
        mode={mode}
        snapEnabled={snapEnabled}
        zoomPercentage={viewport.zoomPercentage}
        onModeChange={onModeChange}
        onToggleSnap={onToggleSnap}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFit={viewport.fit}
        onSave={onSave}
        onRevert={onRevert}
        onUploadClick={openFilePicker}
      />
      {/*
       * Mounted only for a role that may upload. Being `hidden` keeps it out of
       * sight either way, but a control nobody is allowed to use should not be
       * in the tree at all — the guard here matches the button that opens it.
       */}
      {canEdit && (
        <input
          ref={fileInput}
          hidden
          type="file"
          accept="image/png,image/jpeg"
          aria-label="Upload floor plan"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file !== undefined) onUploadFile(file);
          }}
        />
      )}
      {map === null ? (
        <Box sx={emptyCanvasSx}>
          {canCreateMap ? (
            <Stack
              alignItems="center"
              justifyContent="center"
              spacing={1.25}
              sx={{ position: "absolute", inset: 0, p: 4, textAlign: "center" }}
            >
              <Box
                sx={{
                  display: "grid",
                  placeItems: "center",
                  width: 52,
                  height: 52,
                  borderRadius: "50%",
                  color: "primary.main",
                  bgcolor: "#E8EEF9",
                }}
              >
                <MapRounded />
              </Box>
              <Typography variant="h3" component="h2">
                No map yet
              </Typography>
              <Typography color="text.secondary" sx={{ maxWidth: 420 }}>
                Create a blank canvas, then draw a shape for every place stock sits. Anything drawn
                inside another shape belongs to it.
              </Typography>
              <Button startIcon={<AddRounded />} variant="contained" onClick={onCreateMap}>
                Create blank map
              </Button>
            </Stack>
          ) : (
            <Typography
              color="text.secondary"
              sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}
            >
              Loading map…
            </Typography>
          )}
        </Box>
      ) : (
        <Box sx={{ position: "relative", minWidth: 0, minHeight: 0 }}>
          <MapCanvas
            map={map}
            canEdit={canEdit}
            mode={mode}
            snapEnabled={snapEnabled}
            selectedLocationId={selectedLocationId}
            store={store}
            viewport={viewport}
            svgRef={svgRef}
            onSelect={onSelect}
            onOpenDetails={onOpenDetails}
            onOpenContextMenu={onOpenContextMenu}
            onCommitGeometry={onCommitGeometry}
            onCreateLocation={onCreateLocation}
            onRemoveLocation={onRemoveLocation}
            onProblem={onProblem}
          />
          {mode === "polygon" && (
            <Typography variant="caption" color="text.secondary" sx={hintSx}>
              Click to add points. Click the first point or press Enter to finish.
            </Typography>
          )}
          {ruleViolations.length > 0 && (
            <Alert
              severity="error"
              sx={{
                position: "fixed",
                right: 16,
                top: { xs: 72, sm: 84 },
                zIndex: (theme) => theme.zIndex.snackbar,
                width: "min(360px, calc(100% - 32px))",
                py: 0.75,
                px: 1.25,
              }}
            >
              <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                <AlertTitle sx={{ m: 0 }}>
                  {ruleViolations.length} map rule violation
                  {ruleViolations.length === 1 ? "" : "s"}
                </AlertTitle>
                <IconButton
                  size="small"
                  color="inherit"
                  aria-label={
                    rulesExpanded ? "Collapse map rule violations" : "Expand map rule violations"
                  }
                  onClick={() => setRulesExpanded((expanded) => !expanded)}
                  sx={{
                    transform: rulesExpanded ? "rotate(180deg)" : "none",
                    transition: "transform 150ms ease",
                  }}
                >
                  <ExpandMoreRounded />
                </IconButton>
              </Stack>
              <Collapse in={rulesExpanded} unmountOnExit>
                <Box component="ul" sx={{ m: "6px 0 0", pl: 2.25 }}>
                  {ruleViolations.map((violation) => (
                    <Box
                      component="li"
                      key={`${violation.code}-${violation.locationIds.join("-")}`}
                    >
                      {violation.shortMessage}
                    </Box>
                  ))}
                </Box>
              </Collapse>
            </Alert>
          )}
          <MapLegend />
        </Box>
      )}
    </Box>
  );
}
