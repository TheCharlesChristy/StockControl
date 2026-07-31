import type { MapRegionView } from "@stockcontrol/contracts";
import { memo, useSyncExternalStore, type ReactElement } from "react";

import { formatQuantity } from "../../components/DataStates";
import { selectionStroke, shapeStroke } from "./constants";
import { MAP_UNITS, polylinePoints } from "./geometry";
import type { LiveGeometryStore } from "./live-geometry-store";

const NAME_FONT_SIZE = 2.8;
const SUMMARY_FONT_SIZE = 2.2;
/** Below this, a shape cannot show two lines without them spilling out of it. */
const TWO_LINE_MIN_HEIGHT = 9;
/**
 * Rough advance width of one character as a fraction of the font size. The
 * label is a plain sans-serif, so this is close enough to keep text inside its
 * shape without measuring — and measuring would mean a layout read per region
 * on every frame of a drag.
 */
const CHARACTER_WIDTH_RATIO = 0.55;

/**
 * How much room a label really has, and how tall the shape is.
 *
 * For a polygon the answer is the width of the shape *at the line the label
 * sits on*, not the width of its bounding box: a trapezoid that tapers towards
 * the bottom is far narrower where the text lands than at its widest point, and
 * measuring the box let the label run out over the edge.
 */
function labelSpace(
  geometry: MapRegionView["geometry"],
  labelY: number,
): { readonly width: number; readonly height: number } {
  if (geometry.kind === "Rectangle") {
    return { width: geometry.width, height: geometry.height };
  }

  const ys = geometry.points.map((point) => point.y);
  const height = Math.max(...ys) - Math.min(...ys);

  /* Where each edge crosses the label's line, giving the span available there. */
  const crossings: number[] = [];
  for (let index = 0; index < geometry.points.length; index += 1) {
    const start = geometry.points[index];
    const end = geometry.points[(index + 1) % geometry.points.length];
    if (start === undefined || end === undefined) continue;
    if (start.y === end.y) continue;
    if (labelY < Math.min(start.y, end.y) || labelY > Math.max(start.y, end.y)) continue;

    crossings.push(start.x + ((labelY - start.y) / (end.y - start.y)) * (end.x - start.x));
  }

  if (crossings.length < 2) {
    const xs = geometry.points.map((point) => point.x);
    return { width: Math.max(...xs) - Math.min(...xs), height };
  }

  return { width: Math.max(...crossings) - Math.min(...crossings), height };
}

/** Cuts `text` to what fits `width`, ending in an ellipsis when it had to. */
function truncateToWidth(text: string, width: number, fontSize: number): string {
  const fits = Math.floor((width * 0.92) / (fontSize * CHARACTER_WIDTH_RATIO));

  if (fits <= 1) return "";
  return text.length <= fits ? text : `${text.slice(0, fits - 1).trimEnd()}…`;
}

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

  /*
   * SVG text does not wrap and does not clip, so a name longer than its shape
   * used to run out across the floor plan — white on a pale grid, unreadable,
   * and overlapping whatever it crossed. Both lines are cut to what the shape
   * can hold, and the item summary is dropped when the shape is too short for
   * a second line at all. The full text stays in the group's aria-label, and
   * the inspector shows it in full, so nothing is actually lost.
   */
  const space = labelSpace(geometry, normalizedCenter.y);
  const nameLine = truncateToWidth(
    `${region.displayName}${locationCode === undefined ? "" : ` · ${locationCode}`}`,
    space.width * MAP_UNITS,
    NAME_FONT_SIZE,
  );
  const summaryLine =
    space.height * MAP_UNITS < TWO_LINE_MIN_HEIGHT
      ? undefined
      : truncateToWidth(`${itemSummary}${moreItems}`, space.width * MAP_UNITS, SUMMARY_FONT_SIZE);
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
      {nameLine.length > 0 && (
        <text
          x={normalizedCenter.x * MAP_UNITS}
          y={normalizedCenter.y * MAP_UNITS - (summaryLine === undefined ? 0 : 1.5)}
          textAnchor="middle"
          dominantBaseline="middle"
          pointerEvents="none"
          fill="#FFFFFF"
          fontSize={NAME_FONT_SIZE}
          fontWeight="700"
        >
          <tspan x={normalizedCenter.x * MAP_UNITS}>{nameLine}</tspan>
          {summaryLine !== undefined && summaryLine.length > 0 && (
            <tspan
              x={normalizedCenter.x * MAP_UNITS}
              dy="4"
              fontSize={SUMMARY_FONT_SIZE}
              fontWeight="500"
            >
              {summaryLine}
            </tspan>
          )}
        </text>
      )}
    </g>
  );
});
