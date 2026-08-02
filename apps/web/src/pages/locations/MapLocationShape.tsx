import type { MapGeometry, MapLocationView } from "@stockcontrol/contracts";
import { memo, useSyncExternalStore, type ReactElement } from "react";

import { selectionStroke, shapeStroke } from "./constants";
import { MAP_UNITS, boundsOf, polylinePoints } from "./geometry";
import type { LiveGeometryStore } from "./live-geometry-store";

const NAME_FONT_SIZE = 2.8;
const CODE_FONT_SIZE = 2.2;
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
      centreX: geometry.x + geometry.width / 2,
    };
  }

  const xs = geometry.points.map((point) => point.x);
  const fallback = {
    width: Math.max(...xs) - Math.min(...xs),
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

  return { width: right - left, centreX: (left + right) / 2 };
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

interface MapLocationLabelProps {
  readonly location: MapLocationView;
  readonly placement: MapLabelPlacement;
  readonly store: LiveGeometryStore;
}

export type MapLabelPlacement = "center" | "top" | "bottom";

const useLiveGeometry = (location: MapLocationView, store: LiveGeometryStore): MapGeometry => {
  const live = useSyncExternalStore(store.subscribe, () => store.getShapeGeometry(location.id));
  return live ?? location.geometry;
};

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
  const geometry = useLiveGeometry(location, store);
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
      aria-label={`${location.name}${location.code === "" ? "" : `, ${location.code}`}`}
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
    </g>
  );
});

/** Labels render after all areas, so a nested area can never paint over them. */
export const MapLocationLabel = memo(function MapLocationLabel({
  location,
  placement,
  store,
}: MapLocationLabelProps): ReactElement {
  const geometry = useLiveGeometry(location, store);
  const centre = geometryCentre(geometry);
  /*
   * SVG text does not wrap and does not clip, so a name longer than its shape
   * used to run out across the floor plan. The label is trimmed to the shape,
   * outlined for contrast, and rendered in a top layer so nested areas cannot
   * hide it.
   */
  const hasCode = location.code.length > 0;
  const bounds = boundsOf(geometry);
  const labelCentreY =
    placement === "bottom"
      ? bounds.maxY - (hasCode ? 4 : 2) / MAP_UNITS
      : placement === "top"
        ? bounds.minY + (hasCode ? 4 : 2) / MAP_UNITS
        : centre.y;
  const nameY = labelCentreY - (hasCode ? 1.5 / MAP_UNITS : 0);
  const space = labelSpace(geometry, nameY);
  const labelX = space.centreX * MAP_UNITS;
  const nameLine = truncateToWidth(location.name, space.width * MAP_UNITS, NAME_FONT_SIZE);
  const codeLine = hasCode
    ? truncateToWidth(location.code, space.width * MAP_UNITS, CODE_FONT_SIZE)
    : undefined;

  if (nameLine.length === 0) return <g data-location-label-for={location.id} aria-hidden="true" />;

  return (
    <g data-location-label-for={location.id} pointerEvents="none" aria-hidden="true">
      {placement !== "center" && (
        <line
          x1={centre.x * MAP_UNITS}
          y1={centre.y * MAP_UNITS}
          x2={labelX}
          y2={labelCentreY * MAP_UNITS}
          stroke="#071B3A"
          strokeOpacity={0.55}
          strokeWidth={0.8}
          strokeDasharray="1.5 1.5"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <text
        x={labelX}
        y={nameY * MAP_UNITS}
        textAnchor="middle"
        dominantBaseline="middle"
        pointerEvents="none"
        fill="#FFFFFF"
        stroke="#071B3A"
        strokeOpacity={0.82}
        strokeWidth={1.1}
        paintOrder="stroke"
        fontSize={NAME_FONT_SIZE}
        fontWeight="700"
        style={{ userSelect: "none" }}
      >
        <tspan x={labelX}>{nameLine}</tspan>
        {codeLine !== undefined && codeLine.length > 0 && (
          <tspan x={labelX} dy="4" fontSize={CODE_FONT_SIZE} fontWeight="500">
            {codeLine}
          </tspan>
        )}
      </text>
    </g>
  );
});
