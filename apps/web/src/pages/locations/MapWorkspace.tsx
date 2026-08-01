import AddRounded from "@mui/icons-material/AddRounded";
import MapRounded from "@mui/icons-material/MapRounded";
import { Box, Button, Stack, Typography } from "@mui/material";
import type { MapGeometry, MapView } from "@stockcontrol/contracts";
import { useCallback, useRef, useState, type ReactElement, type RefObject } from "react";

import { emptyCanvasSx, floatingPanel } from "./constants";
import type { EditorMode } from "./editor-state";
import { createLiveGeometryStore } from "./live-geometry-store";
import { MapCanvas } from "./MapCanvas";
import { MapLegend } from "./MapLegend";
import { MapToolbar } from "./MapToolbar";
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
  readonly onCommitGeometry: (id: string, geometry: MapGeometry) => void;
  readonly onCreateLocation: (geometry: MapGeometry) => void;
  readonly onRemoveLocation: (id: string) => void;
  readonly onSave: () => void;
  readonly onRevert: () => void;
  readonly onUploadFile: (file: File) => void;
  readonly onCreateMap: () => void;
  readonly onProblem: (message: string) => void;
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
  onCommitGeometry,
  onCreateLocation,
  onRemoveLocation,
  onSave,
  onRevert,
  onUploadFile,
  onCreateMap,
  onProblem,
}: MapWorkspaceProps): ReactElement {
  const viewport = useMapViewport();
  const [store] = useState(createLiveGeometryStore);
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
      sx={{
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)",
        minWidth: 0,
        minHeight: { xs: 600, lg: 0 },
        overflow: "hidden",
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
          <MapLegend />
        </Box>
      )}
    </Box>
  );
}
