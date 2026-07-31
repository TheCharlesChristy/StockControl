import type { HierarchyNodeView, MapGeometry, MapSnapshot } from "@stockcontrol/contracts";
import { Box } from "@mui/material";
import { memo, useMemo, type ReactElement, type RefObject } from "react";

import { canvasSurfaceSx, gridLine, mapBorder } from "./constants";
import { DrawPreviewLayer } from "./DrawPreviewLayer";
import { MAP_UNITS } from "./geometry";
import type { EditorMode } from "./editor-state";
import { sortedByZOrder } from "./editor-state";
import type { LiveGeometryStore } from "./live-geometry-store";
import { MapRegionShape } from "./MapRegionShape";
import { SelectionHandles } from "./SelectionHandles";
import { useCanvasInteraction } from "./use-canvas-interaction";
import type { MapViewportController } from "./use-map-viewport";
import { transformAttribute } from "./viewport";

interface MapCanvasProps {
  readonly map: MapSnapshot;
  readonly canEdit: boolean;
  readonly mode: EditorMode;
  readonly snapEnabled: boolean;
  readonly selectedRegionId: string | null;
  readonly store: LiveGeometryStore;
  readonly viewport: MapViewportController;
  readonly svgRef: RefObject<SVGSVGElement | null>;
  readonly onSelect: (id: string | null) => void;
  readonly onCommitGeometry: (id: string, geometry: MapGeometry) => void;
  readonly onCreateRegion: (geometry: MapGeometry) => void;
  readonly onRemoveRegion: (id: string) => void;
  readonly onProblem: (message: string) => void;
}

const GRID_ID = "map-editor-grid";
/** Grid spacing in map units — one square is the snap step. */
const GRID_STEP = 1;

function hierarchyCodes(nodes: readonly HierarchyNodeView[]): Map<string, string> {
  const result = new Map<string, string>();
  const visit = (current: readonly HierarchyNodeView[]): void => {
    for (const node of current) {
      result.set(node.id, node.code);
      visit(node.children);
    }
  };
  visit(nodes);
  return result;
}

export const MapCanvas = memo(function MapCanvas({
  map,
  canEdit,
  mode,
  snapEnabled,
  selectedRegionId,
  store,
  viewport,
  svgRef,
  onSelect,
  onCommitGeometry,
  onCreateRegion,
  onRemoveRegion,
  onProblem,
}: MapCanvasProps): ReactElement {
  const regions = useMemo(() => sortedByZOrder(map.regions), [map.regions]);
  const hierarchyById = useMemo(() => hierarchyCodes(map.hierarchy), [map.hierarchy]);
  const selectedRegion = useMemo(
    () => regions.find((region) => region.id === selectedRegionId) ?? null,
    [regions, selectedRegionId],
  );

  const interaction = useCanvasInteraction({
    canEdit,
    mode,
    snapEnabled,
    regions,
    selectedRegionId,
    store,
    viewport,
    onSelect,
    onCommitGeometry,
    onCreateRegion,
    onRemoveRegion,
    onProblem,
  });

  const { scale } = viewport.viewport;

  return (
    <Box ref={viewport.attachContainer} sx={canvasSurfaceSx}>
      <svg
        ref={svgRef}
        role="application"
        aria-label={`${map.building.name} map`}
        aria-activedescendant={
          selectedRegionId === null ? undefined : `map-region-${selectedRegionId}`
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
          {regions.map((region) => (
            <MapRegionShape
              key={region.id}
              region={region}
              locationCode={hierarchyById.get(region.hierarchyNodeId)}
              selected={region.id === selectedRegionId}
              editable={canEdit}
              store={store}
            />
          ))}
          {canEdit && selectedRegion !== null && selectedRegion.status === "Active" && (
            <SelectionHandles region={selectedRegion} scale={scale} store={store} />
          )}
          <DrawPreviewLayer scale={scale} store={store} />
        </g>
      </svg>
    </Box>
  );
});
