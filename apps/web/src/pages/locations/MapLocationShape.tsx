import type { MapLocationView } from "@stockcontrol/contracts";
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
 * shape without measuring — and measuring would mean a layout read per shape
 * on every frame of a drag.
 */
const CHARACTER_WIDTH_RATIO = 0.55;
/**
 * How much of the available slice a line may fill. The rest is breathing room:
 * text that ends exactly on the edge reads as though it has been cut off by it,
 * and the character-width estimate above is an estimate, so the margin also
 * absorbs the cases where it runs a little narrow.
 */
const FILL_RATIO = 0.86;

interface LabelSpace {
  readonly width: number;
  readonly height: number;
  readonly centreX: number;
}

/**
 * Where a label fits, and how much room it has there.
 *
 * For a polygon the answer comes from the slice of the shape *on the line the
 * label sits on*, not from its bounding box: a trapezoid that tapers towards
 * the bottom is far narrower where the text lands than at its widest point.
 *
 * Both the width and the centre have to come from that slice. Measuring the
 * width there but still centring on the polygon's centroid puts text that fits
 * in the wrong place, and it hangs over one edge anyway — the centroid of a
 * tapering shape is not the middle of any particular line across it.
 */
function labelSpace(geometry: MapLocationView["geometry"], labelY: number): LabelSpace {
  if (geometry.kind === "Rectangle") {
    return {
      width: geometry.width,
      height: geometry.height,
      centreX: geometry.x + geometry.width / 2,
    };
  }

  const xs = geometry.points.map((point) => point.x);
  const ys = geometry.points.map((point) => point.y);
  const height = Math.max(...ys) - Math.min(...ys);
  const fallback = {
    width: Math.max(...xs) - Math.min(...xs),
    height,
    centreX: (Math.max(...xs) + Math.min(...xs)) / 2,
  };

  /* Where each edge crosses the label's line, giving the slice available there. */
  const crossings: number[] = [];
  for (let index = 0; index < geometry.points.length; index += 1) {
    const start = geometry.points[index];
    const end = geometry.points[(index + 1) % geometry.points.length];
    if (start === undefined || end === undefined) continue;
    if (start.y === end.y) continue;
    if (labelY < Math.min(start.y, end.y) || labelY > Math.max(start.y, end.y)) continue;

    crossings.push(start.x + ((labelY - start.y) / (end.y - start.y)) * (end.x - start.x));
  }

  if (crossings.length < 2) return fallback;

  const left = Math.min(...crossings);
  const right = Math.max(...crossings);

  return { width: right - left, height, centreX: (left + right) / 2 };
}

/** The part of two slices that both share, so text placed there sits in both. */
function overlap(a: LabelSpace, b: LabelSpace): LabelSpace {
  const left = Math.max(a.centreX - a.width / 2, b.centreX - b.width / 2);
  const right = Math.min(a.centreX + a.width / 2, b.centreX + b.width / 2);

  return {
    width: Math.max(0, right - left),
    height: a.height,
    centreX: (left + right) / 2,
  };
}

/** Cuts `text` to what fits `width`, ending in an ellipsis when it had to. */
function truncateToWidth(text: string, width: number, fontSize: number): string {
  const fits = Math.floor((width * FILL_RATIO) / (fontSize * CHARACTER_WIDTH_RATIO));

  if (fits <= 1) return "";
  return text.length <= fits ? text : `${text.slice(0, fits - 1).trimEnd()}…`;
}

interface MapLocationShapeProps {
  readonly location: MapLocationView;
  readonly selected: boolean;
  readonly editable: boolean;
  readonly store: LiveGeometryStore;
}

/**
 * One location on the map. The shape is the location — there is no separate
 * region record behind it.
 *
 * Props are pure data — no handlers, no zoom — so this bails out of every
 * render except its own. While a drag is running it reads the moving geometry
 * from the live store; every other shape reads a stable `null` there and React
 * skips it entirely, which is what keeps a drag at one component render a frame.
 */
export const MapLocationShape = memo(function MapLocationShape({
  location,
  selected,
  editable,
  store,
}: MapLocationShapeProps): ReactElement {
  const live = useSyncExternalStore(store.subscribe, () => store.getShapeGeometry(location.id));
  const geometry = live ?? location.geometry;
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
    location.stock.items.length === 0
      ? "Empty"
      : location.stock.items
          .slice(0, 2)
          .map((item) => `${item.name} (${formatQuantity(item.quantity)})`)
          .join(", ");
  const moreItems =
    location.stock.items.length > 2 ? ` +${String(location.stock.items.length - 2)}` : "";

  /*
   * SVG text does not wrap and does not clip, so a name longer than its shape
   * used to run out across the floor plan — white on a pale grid, unreadable,
   * and overlapping whatever it crossed. Both lines are cut to what the shape
   * can hold, and the item summary is dropped when the shape is too short for
   * a second line at all. The full text stays in the group's aria-label, and
   * the inspector shows it in full, so nothing is actually lost.
   */
  const twoLines =
    labelSpace(geometry, normalizedCenter.y).height * MAP_UNITS >= TWO_LINE_MIN_HEIGHT;
  /*
   * Measured on both baselines and narrowed to where they agree. The two lines
   * share an x, so the room they have is the room the *lower* one has — on a
   * shape that tapers, the summary sits four units further down and the walls
   * have closed in by then. Taking the overlap keeps both inside.
   */
  const nameY = normalizedCenter.y - (twoLines ? 1.5 / MAP_UNITS : 0);
  const summaryY = nameY + 4 / MAP_UNITS;
  const space = twoLines
    ? overlap(labelSpace(geometry, nameY), labelSpace(geometry, summaryY))
    : labelSpace(geometry, nameY);

  const labelX = space.centreX * MAP_UNITS;
  const nameLine = truncateToWidth(
    `${location.name}${location.code === "" ? "" : ` · ${location.code}`}`,
    space.width * MAP_UNITS,
    NAME_FONT_SIZE,
  );
  const summaryLine = !twoLines
    ? undefined
    : truncateToWidth(`${itemSummary}${moreItems}`, space.width * MAP_UNITS, SUMMARY_FONT_SIZE);
  const shapeProps = {
    "data-location-id": location.id,
    fill: location.stock.colour,
    fillOpacity: location.status === "Archived" ? 0.42 : 0.82,
    stroke: selected ? selectionStroke : shapeStroke,
    strokeWidth: selected ? 2 : 1,
    vectorEffect: "non-scaling-stroke" as const,
    style: { cursor: editable ? "move" : "pointer" },
  };

  return (
    <g
      id={`map-location-${location.id}`}
      data-location-group-id={location.id}
      role="button"
      aria-label={`${location.name}${location.code === "" ? "" : `, ${location.code}`}, ${location.stock.text}, ${itemSummary}`}
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
          x={labelX}
          y={nameY * MAP_UNITS}
          textAnchor="middle"
          dominantBaseline="middle"
          pointerEvents="none"
          fill="#FFFFFF"
          fontSize={NAME_FONT_SIZE}
          fontWeight="700"
        >
          <tspan x={labelX}>{nameLine}</tspan>
          {summaryLine !== undefined && summaryLine.length > 0 && (
            <tspan x={labelX} dy="4" fontSize={SUMMARY_FONT_SIZE} fontWeight="500">
              {summaryLine}
            </tspan>
          )}
        </text>
      )}
    </g>
  );
});
