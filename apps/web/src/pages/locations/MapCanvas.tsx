import type { MapGeometry, MapView } from "@stockcontrol/contracts";
import { Box } from "@mui/material";
import { memo, useMemo, type ReactElement, type RefObject } from "react";

import { canvasSurfaceSx, gridLine, mapBorder } from "./constants";
import { DrawPreviewLayer } from "./DrawPreviewLayer";
import { MAP_UNITS, boundsOf } from "./geometry";
import type { EditorMode } from "./editor-state";
import { sortedByZOrder } from "./editor-state";
import type { LiveGeometryStore } from "./live-geometry-store";
import { MapLocationLabel, MapLocationShape, type MapLabelPlacement } from "./MapLocationShape";
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
  readonly onOpenDetails: (id: string) => void;
  readonly onOpenContextMenu: (
    id: string,
    position: { readonly top: number; readonly left: number },
  ) => void;
  readonly onCommitGeometry: (id: string, geometry: MapGeometry) => void;
  readonly onCreateLocation: (geometry: MapGeometry) => void;
  readonly onRemoveLocation: (id: string) => void;
  readonly onProblem: (message: string) => void;
}

const GRID_ID = "map-editor-grid";
/** Grid spacing in map units — one square is the snap step. */
const GRID_STEP = 1;

const geometryCentre = (geometry: MapGeometry): { readonly x: number; readonly y: number } => {
  if (geometry.kind === "Rectangle") {
    return { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 };
  }
  const total = geometry.points.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 },
  );
  return {
    x: total.x / geometry.points.length,
    y: total.y / geometry.points.length,
  };
};

const LABEL_PLACEMENTS: readonly MapLabelPlacement[] = ["center", "bottom", "top"];

interface LabelBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

const labelCentreY = (
  geometry: MapGeometry,
  placement: MapLabelPlacement,
  hasCode: boolean,
): number => {
  const bounds = boundsOf(geometry);
  const inset = (hasCode ? 4 : 2) / MAP_UNITS;
  if (placement === "bottom") return bounds.maxY - inset;
  if (placement === "top") return bounds.minY + inset;
  return geometryCentre(geometry).y;
};

const estimatedLabelBox = (
  location: MapView["locations"][number],
  placement: MapLabelPlacement,
): LabelBox => {
  const bounds = boundsOf(location.geometry);
  const centre = geometryCentre(location.geometry);
  const longestLine = Math.max(location.name.length, location.code.length);
  const estimatedWidth = Math.max(
    0.04,
    Math.min(bounds.maxX - bounds.minX, (longestLine * 1.55 + 2) / MAP_UNITS),
  );
  const estimatedHeight = (location.code.length > 0 ? 7 : 4) / MAP_UNITS;
  const y = labelCentreY(location.geometry, placement, location.code.length > 0);
  return {
    minX: centre.x - estimatedWidth / 2,
    minY: y - estimatedHeight / 2,
    maxX: centre.x + estimatedWidth / 2,
    maxY: y + estimatedHeight / 2,
  };
};

const overlapArea = (left: LabelBox, right: LabelBox): number => {
  const width = Math.max(0, Math.min(left.maxX, right.maxX) - Math.max(left.minX, right.minX));
  const height = Math.max(0, Math.min(left.maxY, right.maxY) - Math.max(left.minY, right.minY));
  return width * height;
};

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
  onOpenDetails,
  onOpenContextMenu,
  onCommitGeometry,
  onCreateLocation,
  onRemoveLocation,
  onProblem,
}: MapCanvasProps): ReactElement {
  const locations = useMemo(() => sortedByZOrder(map.locations), [map.locations]);
  const labelPlacements = useMemo(() => {
    const placements = new Map<string, MapLabelPlacement>();
    const occupiedLabels: LabelBox[] = [];

    for (const location of locations) {
      const children = locations.filter(
        (candidate) => candidate.derivedParentId === location.id && candidate.status === "Active",
      );
      const best = LABEL_PLACEMENTS.map((placement) => {
        const labelBox = estimatedLabelBox(location, placement);
        const childOverlap = children.reduce(
          (total, child) =>
            total +
            overlapArea(labelBox, {
              ...boundsOf(child.geometry),
            }),
          0,
        );
        const labelOverlap = occupiedLabels.reduce(
          (total, occupied) => total + overlapArea(labelBox, occupied),
          0,
        );
        const distancePenalty = placement === "center" ? 0 : 0.001;
        return {
          placement,
          labelBox,
          score: childOverlap * 1000 + labelOverlap * 100 + distancePenalty,
        };
      }).sort((left, right) => left.score - right.score)[0];

      if (best === undefined) continue;
      placements.set(location.id, best.placement);
      occupiedLabels.push(best.labelBox);
    }

    return placements;
  }, [locations]);
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

  const locationIdFromTarget = (target: EventTarget | null): string | null => {
    if (!(target instanceof Element)) return null;
    const shapeElement = target.closest("[data-location-id], [data-location-group-id]");
    return (
      shapeElement?.getAttribute("data-location-id") ??
      shapeElement?.getAttribute("data-location-group-id") ??
      null
    );
  };

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
          userSelect: "none",
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
        onDoubleClick={(event) => {
          const locationId = locationIdFromTarget(event.target);
          if (locationId === null) return;
          event.preventDefault();
          onSelect(locationId);
          onOpenDetails(locationId);
        }}
        onContextMenu={(event) => {
          const locationId = locationIdFromTarget(event.target);
          if (locationId === null) return;
          event.preventDefault();
          onSelect(locationId);
          onOpenContextMenu(locationId, { top: event.clientY, left: event.clientX });
        }}
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
          <g data-testid="map-location-labels" pointerEvents="none" aria-hidden="true">
            {locations.map((location) => (
              <MapLocationLabel
                key={location.id}
                location={location}
                placement={labelPlacements.get(location.id) ?? "center"}
                store={store}
              />
            ))}
          </g>
          {canEdit && selectedLocation !== null && selectedLocation.status === "Active" && (
            <SelectionHandles location={selectedLocation} scale={scale} store={store} />
          )}
          <DrawPreviewLayer scale={scale} store={store} />
        </g>
      </svg>
    </Box>
  );
});
