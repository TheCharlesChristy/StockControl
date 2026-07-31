import type { MapRegionView } from "@stockcontrol/contracts";
import { memo, useSyncExternalStore, type ReactElement } from "react";

import { selectionStroke } from "./constants";
import { MAP_UNITS, type ResizeHandle } from "./geometry";
import type { LiveGeometryStore } from "./live-geometry-store";

interface SelectionHandlesProps {
  readonly region: MapRegionView;
  readonly scale: number;
  readonly store: LiveGeometryStore;
}

/** Handle size in screen pixels, so the grab target does not shrink when zoomed out. */
const HANDLE_RADIUS_PIXELS = 6;

const cursorFor: Readonly<Record<ResizeHandle, string>> = {
  nw: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  se: "nwse-resize",
};

/**
 * Corner handles for the selected rectangle. Split from the shape so that a
 * zoom, which changes the handle radius, re-renders only this one component
 * rather than every region on the map.
 */
export const SelectionHandles = memo(function SelectionHandles({
  region,
  scale,
  store,
}: SelectionHandlesProps): ReactElement | null {
  const live = useSyncExternalStore(store.subscribe, () => store.getRegionGeometry(region.id));
  const geometry = live ?? region.geometry;
  if (geometry.kind !== "Rectangle") return null;

  const radius = HANDLE_RADIUS_PIXELS / scale;
  const corners: readonly (readonly [ResizeHandle, number, number])[] = [
    ["nw", geometry.x, geometry.y],
    ["ne", geometry.x + geometry.width, geometry.y],
    ["sw", geometry.x, geometry.y + geometry.height],
    ["se", geometry.x + geometry.width, geometry.y + geometry.height],
  ];

  return (
    <g aria-hidden="true">
      {corners.map(([handle, x, y]) => (
        <circle
          key={handle}
          data-handle={handle}
          data-handle-region={region.id}
          cx={x * MAP_UNITS}
          cy={y * MAP_UNITS}
          r={radius}
          fill="#FFFFFF"
          stroke={selectionStroke}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          style={{ cursor: cursorFor[handle] }}
        />
      ))}
    </g>
  );
});
