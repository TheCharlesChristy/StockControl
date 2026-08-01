import type { MapGeometry } from "@stockcontrol/contracts";

/**
 * Geometry helpers for the map canvas, kept free of React so the maths that
 * decides where a shape lands can be tested directly. Coordinates are the
 * normalized `[0, 1]` values the API stores; `MAP_UNITS` converts them to the
 * SVG user space the canvas draws in.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type RectangleGeometry = Extract<MapGeometry, { readonly kind: "Rectangle" }>;
export type PolygonGeometry = Extract<MapGeometry, { readonly kind: "Polygon" }>;
export type ResizeHandle = "nw" | "ne" | "sw" | "se";

/** Side of the square drawing surface, in SVG user units. */
export const MAP_UNITS = 100;
/** Smallest rectangle the server will accept as a meaningful area. */
export const MIN_REGION_SIZE = 0.02;
/** Below this, a pointer drag is treated as a click rather than a rectangle. */
export const MIN_DRAG_SIZE = 0.005;
/** Grid step used when snapping is on. */
export const SNAP_STEP = 0.01;

const MAX_POLYGON_POINTS = 128;
const MIN_AREA = 1e-12;

export const clamp = (value: number): number => Math.max(0, Math.min(1, value));

/** Rounds to the nearest grid step, trimming binary-float noise like 0.30000000000000004. */
export const snapValue = (value: number, step: number): number =>
  Number((Math.round(value / step) * step).toFixed(6));

export const snapPoint = (point: Point, step: number): Point => ({
  x: clamp(snapValue(point.x, step)),
  y: clamp(snapValue(point.y, step)),
});

export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export const boundsOf = (geometry: MapGeometry): Bounds => {
  if (geometry.kind === "Rectangle")
    return {
      minX: geometry.x,
      minY: geometry.y,
      maxX: geometry.x + geometry.width,
      maxY: geometry.y + geometry.height,
    };
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const point of geometry.points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
};

/** Union of several shapes, or null when there is nothing to bound. */
export const unionBounds = (geometries: readonly MapGeometry[]): Bounds | null => {
  if (geometries.length === 0) return null;
  let bounds: Bounds | null = null;
  for (const geometry of geometries) {
    const next = boundsOf(geometry);
    bounds =
      bounds === null
        ? next
        : {
            minX: Math.min(bounds.minX, next.minX),
            minY: Math.min(bounds.minY, next.minY),
            maxX: Math.max(bounds.maxX, next.maxX),
            maxY: Math.max(bounds.maxY, next.maxY),
          };
  }
  return bounds;
};

/** SVG `points` attribute in user units, for polygons and in-progress outlines. */
export const polylinePoints = (points: readonly Point[]): string =>
  points.map((point) => `${String(point.x * MAP_UNITS)},${String(point.y * MAP_UNITS)}`).join(" ");

export const moveGeometry = (geometry: MapGeometry, dx: number, dy: number): MapGeometry => {
  if (geometry.kind === "Rectangle")
    return {
      ...geometry,
      x: Math.min(1 - geometry.width, Math.max(0, geometry.x + dx)),
      y: Math.min(1 - geometry.height, Math.max(0, geometry.y + dy)),
    };
  /*
   * Polygons move as a body: the delta is limited by the bounding box so the
   * shape never distorts against the canvas edge.
   */
  const bounds = boundsOf(geometry);
  const boundedX = Math.min(1 - bounds.maxX, Math.max(-bounds.minX, dx));
  const boundedY = Math.min(1 - bounds.maxY, Math.max(-bounds.minY, dy));
  return {
    ...geometry,
    points: geometry.points.map((point) => ({
      x: clamp(point.x + boundedX),
      y: clamp(point.y + boundedY),
    })),
  };
};

/** Aligns a shape's top-left corner to the grid without changing its form. */
export const snapGeometry = (geometry: MapGeometry, step: number): MapGeometry => {
  const bounds = boundsOf(geometry);
  const dx = snapValue(bounds.minX, step) - bounds.minX;
  const dy = snapValue(bounds.minY, step) - bounds.minY;
  return dx === 0 && dy === 0 ? geometry : moveGeometry(geometry, dx, dy);
};

export const resizeRectangle = (
  geometry: RectangleGeometry,
  handle: ResizeHandle,
  point: Point,
): RectangleGeometry => {
  const right = geometry.x + geometry.width;
  const bottom = geometry.y + geometry.height;
  const movesWest = handle === "nw" || handle === "sw";
  const movesNorth = handle === "nw" || handle === "ne";
  const x = clamp(point.x);
  const y = clamp(point.y);
  const left = movesWest ? Math.min(x, right - MIN_REGION_SIZE) : geometry.x;
  const top = movesNorth ? Math.min(y, bottom - MIN_REGION_SIZE) : geometry.y;
  const nextRight = movesWest ? right : Math.max(x, left + MIN_REGION_SIZE);
  const nextBottom = movesNorth ? bottom : Math.max(y, top + MIN_REGION_SIZE);
  return {
    kind: "Rectangle",
    x: left,
    y: top,
    width: nextRight - left,
    height: nextBottom - top,
  };
};

/**
 * Builds a rectangle from the two corners of a drag, in any direction. Returns
 * null when the drag was too small to be anything but a stray click — the old
 * editor turned those into 2% shapes.
 */
export const rectangleFromPoints = (start: Point, end: Point): RectangleGeometry | null => {
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  if (width < MIN_DRAG_SIZE && height < MIN_DRAG_SIZE) return null;
  const boundedWidth = Math.max(MIN_REGION_SIZE, Math.min(1, width));
  const boundedHeight = Math.max(MIN_REGION_SIZE, Math.min(1, height));
  return {
    kind: "Rectangle",
    x: Math.max(0, Math.min(Math.min(start.x, end.x), 1 - boundedWidth)),
    y: Math.max(0, Math.min(Math.min(start.y, end.y), 1 - boundedHeight)),
    width: boundedWidth,
    height: boundedHeight,
  };
};

const cross = (a: Point, b: Point, c: Point): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const onSegment = (a: Point, p: Point, b: Point): boolean =>
  Math.abs(cross(a, p, b)) <= MIN_AREA &&
  p.x >= Math.min(a.x, b.x) &&
  p.x <= Math.max(a.x, b.x) &&
  p.y >= Math.min(a.y, b.y) &&
  p.y <= Math.max(a.y, b.y);

const orientation = (a: Point, b: Point, c: Point): -1 | 0 | 1 => {
  const value = cross(a, b, c);
  return Math.abs(value) <= MIN_AREA ? 0 : value > 0 ? 1 : -1;
};

const intersects = (a: Point, b: Point, c: Point, d: Point): boolean => {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (abC !== abD && cdA !== cdB && abC !== 0 && abD !== 0 && cdA !== 0 && cdB !== 0) return true;
  return (
    (abC === 0 && onSegment(a, c, b)) ||
    (abD === 0 && onSegment(a, d, b)) ||
    (cdA === 0 && onSegment(c, a, d)) ||
    (cdB === 0 && onSegment(c, b, d))
  );
};

const polygonArea = (points: readonly Point[]): number => {
  let doubled = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (current === undefined || next === undefined) continue;
    doubled += current.x * next.y - next.x * current.y;
  }
  return Math.abs(doubled) / 2;
};

/**
 * Mirrors the server's polygon rules (`packages/modules/locations`) so a bad
 * shape is refused while it is being drawn rather than by a 400 on save.
 * Returns the reason it would be rejected, or null when the shape is valid.
 */
export const polygonProblem = (points: readonly Point[]): string | null => {
  if (points.length < 3) return "A polygon needs at least three points.";
  if (points.length > MAX_POLYGON_POINTS) return "A polygon can hold at most 128 points.";
  const keys = points.map((point) => `${String(point.x)}:${String(point.y)}`);
  if (new Set(keys).size !== points.length) return "Polygon points must be unique.";
  if (polygonArea(points) <= MIN_AREA) return "The polygon does not enclose an area.";
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      const adjacent =
        firstNext === second || secondNext === first || (first === 0 && secondNext === 0);
      const a = points[first];
      const b = points[firstNext];
      const c = points[second];
      const d = points[secondNext];
      if (a === undefined || b === undefined || c === undefined || d === undefined) continue;
      if (!adjacent && intersects(a, b, c, d)) return "Polygon edges cannot cross.";
    }
  }
  return null;
};

export const geometrySummary = (geometry: MapGeometry): string =>
  geometry.kind === "Rectangle"
    ? `Rectangle · ${String(Math.round(geometry.width * 100))}% × ${String(Math.round(geometry.height * 100))}%`
    : `Polygon · ${String(geometry.points.length)} points`;
