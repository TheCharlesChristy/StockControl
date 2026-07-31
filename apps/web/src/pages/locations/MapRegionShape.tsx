import type { MapRegionView } from "@stockcontrol/contracts";
import { memo, useSyncExternalStore, type ReactElement } from "react";

import { selectionStroke, shapeStroke } from "./constants";
import { MAP_UNITS, polylinePoints } from "./geometry";
import type { LiveGeometryStore } from "./live-geometry-store";

interface MapRegionShapeProps {
  readonly region: MapRegionView;
  readonly selected: boolean;
  readonly editable: boolean;
  readonly store: LiveGeometryStore;
}

/**
 * One region on the map.
 *
 * Props are pure data — no handlers, no zoom — so this bails out of every
 * render except its own. While a drag is running it reads the moving geometry
 * from the live store; every other shape reads a stable `null` there and React
 * skips it entirely, which is what keeps a drag at one component render a frame.
 */
export const MapRegionShape = memo(function MapRegionShape({
  region,
  selected,
  editable,
  store,
}: MapRegionShapeProps): ReactElement {
  const live = useSyncExternalStore(store.subscribe, () => store.getRegionGeometry(region.id));
  const geometry = live ?? region.geometry;
  const shared = {
    "data-region-id": region.id,
    id: `map-region-${region.id}`,
    role: "button",
    "aria-label": `${region.displayName}, ${region.stock.text}`,
    fill: region.stock.colour,
    fillOpacity: region.status === "Archived" ? 0.42 : 0.82,
    stroke: selected ? selectionStroke : shapeStroke,
    strokeWidth: selected ? 2 : 1,
    vectorEffect: "non-scaling-stroke" as const,
    style: { cursor: editable ? "move" : "pointer" },
  };

  return geometry.kind === "Rectangle" ? (
    <rect
      {...shared}
      x={geometry.x * MAP_UNITS}
      y={geometry.y * MAP_UNITS}
      width={geometry.width * MAP_UNITS}
      height={geometry.height * MAP_UNITS}
    />
  ) : (
    <polygon {...shared} points={polylinePoints(geometry.points)} />
  );
});
