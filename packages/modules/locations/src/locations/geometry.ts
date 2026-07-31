import { failLocation } from "./errors.js";

export interface NormalizedPoint {
  readonly x: number;
  readonly y: number;
}

export interface RectangleGeometry {
  readonly kind: "Rectangle";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PolygonGeometry {
  readonly kind: "Polygon";
  readonly points: readonly NormalizedPoint[];
}

export type MapGeometry = RectangleGeometry | PolygonGeometry;

const MAX_POLYGON_POINTS = 128;
const MIN_AREA = 1e-12;

const coordinate = (value: number, label: string): number => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    failLocation(
      "InvalidGeometry",
      `${label} must be a finite normalized coordinate from zero to one.`,
    );
  }
  return value;
};

const extent = (value: number, label: string): number => {
  coordinate(value, label);
  if (value <= 0) {
    failLocation("InvalidGeometry", `${label} must be greater than zero.`);
  }
  return value;
};

export const createRectangleGeometry = (
  x: number,
  y: number,
  width: number,
  height: number,
): RectangleGeometry => {
  const rectangle = {
    kind: "Rectangle" as const,
    x: coordinate(x, "Rectangle x"),
    y: coordinate(y, "Rectangle y"),
    width: extent(width, "Rectangle width"),
    height: extent(height, "Rectangle height"),
  };
  if (rectangle.x + rectangle.width > 1 || rectangle.y + rectangle.height > 1) {
    failLocation("InvalidGeometry", "Rectangle must remain inside the normalized canvas.");
  }
  return Object.freeze(rectangle);
};

const cross = (a: NormalizedPoint, b: NormalizedPoint, c: NormalizedPoint): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const onSegment = (a: NormalizedPoint, p: NormalizedPoint, b: NormalizedPoint): boolean =>
  Math.abs(cross(a, p, b)) <= MIN_AREA &&
  p.x >= Math.min(a.x, b.x) &&
  p.x <= Math.max(a.x, b.x) &&
  p.y >= Math.min(a.y, b.y) &&
  p.y <= Math.max(a.y, b.y);

const orientation = (a: NormalizedPoint, b: NormalizedPoint, c: NormalizedPoint): -1 | 0 | 1 => {
  const value = cross(a, b, c);
  return Math.abs(value) <= MIN_AREA ? 0 : value > 0 ? 1 : -1;
};

const intersects = (
  a: NormalizedPoint,
  b: NormalizedPoint,
  c: NormalizedPoint,
  d: NormalizedPoint,
): boolean => {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (abC !== abD && cdA !== cdB && abC !== 0 && abD !== 0 && cdA !== 0 && cdB !== 0) {
    return true;
  }
  return (
    (abC === 0 && onSegment(a, c, b)) ||
    (abD === 0 && onSegment(a, d, b)) ||
    (cdA === 0 && onSegment(c, a, d)) ||
    (cdB === 0 && onSegment(c, b, d))
  );
};

const polygonArea = (points: readonly NormalizedPoint[]): number => {
  let doubled = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    doubled += current.x * next.y - next.x * current.y;
  }
  return Math.abs(doubled) / 2;
};

export const createPolygonGeometry = (rawPoints: readonly NormalizedPoint[]): PolygonGeometry => {
  if (rawPoints.length < 3 || rawPoints.length > MAX_POLYGON_POINTS) {
    failLocation("InvalidGeometry", "Polygon must contain 3-128 points.");
  }
  const points = rawPoints.map((point, index) =>
    Object.freeze({
      x: coordinate(point.x, `Polygon point ${String(index + 1)} x`),
      y: coordinate(point.y, `Polygon point ${String(index + 1)} y`),
    }),
  );
  const keys = points.map((point) => `${String(point.x)}:${String(point.y)}`);
  if (new Set(keys).size !== points.length) {
    failLocation("InvalidGeometry", "Polygon points must be unique.");
  }
  if (polygonArea(points) <= MIN_AREA) {
    failLocation("InvalidGeometry", "Polygon must enclose a meaningful area.");
  }
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      const adjacent =
        first === second ||
        firstNext === second ||
        secondNext === first ||
        (first === 0 && secondNext === 0);
      if (
        !adjacent &&
        intersects(points[first]!, points[firstNext]!, points[second]!, points[secondNext]!)
      ) {
        failLocation("InvalidGeometry", "Polygon edges cannot intersect.");
      }
    }
  }
  return Object.freeze({ kind: "Polygon", points: Object.freeze(points) });
};

export const copyGeometry = (geometry: MapGeometry): MapGeometry =>
  geometry.kind === "Rectangle"
    ? createRectangleGeometry(geometry.x, geometry.y, geometry.width, geometry.height)
    : createPolygonGeometry(geometry.points);
