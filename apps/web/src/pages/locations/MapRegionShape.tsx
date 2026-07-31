import type { MapRegionView } from "@stockcontrol/contracts";
import { memo, useSyncExternalStore, type ReactElement } from "react";

import { formatQuantity } from "../../components/DataStates";
import { selectionStroke, shapeStroke } from "./constants";
import { MAP_UNITS, polylinePoints } from "./geometry";
import type { LiveGeometryStore } from "./live-geometry-store";

interface MapRegionShapeProps {
  readonly region: MapRegionView;
  readonly locationCode: string | undefined;
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
  locationCode,
  selected,
  editable,
  store,
}: MapRegionShapeProps): ReactElement {
  const live = useSyncExternalStore(store.subscribe, () => store.getRegionGeometry(region.id));
  const geometry = live ?? region.geometry;
  const center =
    geometry.kind === "Rectangle"
      ? { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 }
      : geometry.points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), {
          x: 0,
          y: 0,
        });
  const normalizedCenter =
    geometry.kind === "Polygon"
      ? { x: center.x / geometry.points.length, y: center.y / geometry.points.length }
      : center;
  const itemSummary =
    region.stock.items.length === 0
      ? "Empty"
      : region.stock.items
          .slice(0, 2)
          .map((item) => `${item.name} (${formatQuantity(item.quantity)})`)
          .join(", ");
  const moreItems =
    region.stock.items.length > 2 ? ` +${String(region.stock.items.length - 2)}` : "";
  const shapeProps = {
    "data-region-id": region.id,
    fill: region.stock.colour,
    fillOpacity: region.status === "Archived" ? 0.42 : 0.82,
    stroke: selected ? selectionStroke : shapeStroke,
    strokeWidth: selected ? 2 : 1,
    vectorEffect: "non-scaling-stroke" as const,
    style: { cursor: editable ? "move" : "pointer" },
  };

  return (
    <g
      id={`map-region-${region.id}`}
      data-region-group-id={region.id}
      role="button"
      aria-label={`${region.displayName}${locationCode === undefined ? "" : `, ${locationCode}`}, ${region.stock.text}, ${itemSummary}`}
      style={{ cursor: editable ? "move" : "pointer" }}
    >
      {geometry.kind === "Rectangle" ? (
        <rect
          {...shapeProps}
          x={geometry.x * MAP_UNITS}
          y={geometry.y * MAP_UNITS}
          width={geometry.width * MAP_UNITS}
          height={geometry.height * MAP_UNITS}
        />
      ) : (
        <polygon {...shapeProps} points={polylinePoints(geometry.points)} />
      )}
      <text
        x={normalizedCenter.x * MAP_UNITS}
        y={normalizedCenter.y * MAP_UNITS - 1.5}
        textAnchor="middle"
        dominantBaseline="middle"
        pointerEvents="none"
        fill="#FFFFFF"
        fontSize="2.8"
        fontWeight="700"
      >
        <tspan x={normalizedCenter.x * MAP_UNITS}>
          {region.displayName}{locationCode === undefined ? "" : ` · ${locationCode}`}
        </tspan>
        <tspan x={normalizedCenter.x * MAP_UNITS} dy="4" fontSize="2.2" fontWeight="500">
          {itemSummary}
          {moreItems}
        </tspan>
      </text>
    </g>
  );
});
