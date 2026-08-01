import type { MapGeometry, MapView } from "@stockcontrol/contracts";
import { Box } from "@mui/material";
import { memo, useMemo, type ReactElement, type RefObject } from "react";

import { canvasSurfaceSx, gridLine, mapBorder } from "./constants";
import { DrawPreviewLayer } from "./DrawPreviewLayer";
import { MAP_UNITS } from "./geometry";
import type { EditorMode } from "./editor-state";
import { sortedByZOrder } from "./editor-state";
import type { LiveGeometryStore } from "./live-geometry-store";
import { MapLocationShape } from "./MapLocationShape";
import { SelectionHandles } from "./SelectionHandles";
import { useCanvasInteraction } from "./use-canvas-interaction";
import type { MapViewportController } from "./use-map-viewport";
import { transformAttribute } from "./viewport";

interface MapCanvasProps {
  readonly map: MapView;
  readonly canEdit: boolean;
  readonly mode: EditorMode;
  readonly snapEnabled: boolean;
  readonly selectedLocationId: string | null;
  readonly store: LiveGeometryStore;
  readonly viewport: MapViewportController;
  readonly svgRef: RefObject<SVGSVGElement | null>;
  readonly onSelect: (id: string | null) => void;
  readonly onCommitGeometry: (id: string, geometry: MapGeometry) => void;
  readonly onCreateLocation: (geometry: MapGeometry) => void;
  readonly onRemoveLocation: (id: string) => void;
  readonly onProblem: (message: string) => void;
}

const GRID_ID = "map-editor-grid";
/** Grid spacing in map units — one square is the snap step. */
const GRID_STEP = 1;

export const MapCanvas = memo(function MapCanvas({
  map,
  canEdit,
  mode,
  snapEnabled,
  selectedLocationId,
  store,
  viewport,
  svgRef,
  onSelect,
  onCommitGeometry,
  onCreateLocation,
  onRemoveLocation,
  onProblem,
}: MapCanvasProps): ReactElement {
  const locations = useMemo(() => sortedByZOrder(map.locations), [map.locations]);
  const selectedLocation = useMemo(
    () => locations.find((location) => location.id === selectedLocationId) ?? null,
    [locations, selectedLocationId],
  );

  const interaction = useCanvasInteraction({
    canEdit,
    mode,
    snapEnabled,
    locations,
    selectedLocationId,
    store,
    viewport,
    onSelect,
    onCommitGeometry,
    onCreateLocation,
    onRemoveLocation,
    onProblem,
  });

  const { scale } = viewport.viewport;

  return (
    <Box ref={viewport.attachContainer} sx={canvasSurfaceSx}>
      <svg
        ref={svgRef}
        role="application"
        aria-label={`${map.name} map`}
        aria-activedescendant={
          selectedLocationId === null ? undefined : `map-location-${selectedLocationId}`
        }
        tabIndex={0}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          touchAction: "none",
          outlineOffset: -2,
          cursor: interaction.cursor,
        }}
        onPointerDown={interaction.onPointerDown}
        onPointerMove={interaction.onPointerMove}
        onPointerUp={interaction.onPointerUp}
        onPointerCancel={interaction.onPointerCancel}
        onLostPointerCapture={interaction.onLostPointerCapture}
        onKeyDown={interaction.onKeyDown}
        onKeyUp={interaction.onKeyUp}
      >
        <defs>
          {/*
           * The grid lives inside the transformed group so it pans and zooms
           * with the map. As a CSS background on the container it stayed put
           * while the content moved, which read as the map sliding on glass.
           */}
          <pattern id={GRID_ID} width={GRID_STEP} height={GRID_STEP} patternUnits="userSpaceOnUse">
            <path
              d={`M ${String(GRID_STEP)} 0 L 0 0 0 ${String(GRID_STEP)}`}
              fill="none"
              stroke={gridLine}
              strokeWidth={0.5}
              vectorEffect="non-scaling-stroke"
            />
          </pattern>
        </defs>
        <g transform={transformAttribute(viewport.viewport)}>
          <rect
            x={0}
            y={0}
            width={MAP_UNITS}
            height={MAP_UNITS}
            fill="#FFFFFF"
            stroke={mapBorder}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <rect x={0} y={0} width={MAP_UNITS} height={MAP_UNITS} fill={`url(#${GRID_ID})`} />
          {map.background.kind === "FloorPlan" && map.background.downloadPath !== undefined && (
            <image
              href={map.background.downloadPath}
              x={0}
              y={0}
              width={MAP_UNITS}
              height={MAP_UNITS}
              preserveAspectRatio="xMidYMid slice"
              opacity={0.28}
              aria-label={map.background.originalFileName ?? "Floor plan"}
            />
          )}
          {locations.map((location) => (
            <MapLocationShape
              key={location.id}
              location={location}
              selected={location.id === selectedLocationId}
              editable={canEdit}
              store={store}
            />
          ))}
          {canEdit && selectedLocation !== null && selectedLocation.status === "Active" && (
            <SelectionHandles location={selectedLocation} scale={scale} store={store} />
          )}
          <DrawPreviewLayer scale={scale} store={store} />
        </g>
      </svg>
    </Box>
  );
});
