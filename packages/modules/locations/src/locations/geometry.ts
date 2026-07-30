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
const MIN_MEANINGFUL_AREA = 1e-12;

const coordinate = (value: number, description: string): number => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    failLocation(
      "InvalidGeometry",
      `${description} must be a finite normalized coordinate from zero to one.`,
    );
  }
  return value;
};

const positiveExtent = (value: number, description: string): number => {
  coordinate(value, description);
  if (value <= 0) {
    failLocation("InvalidGeometry", `${description} must be greater than zero.`);
  }
  return value;
};

export const createRectangleGeometry = (
  x: number,
  y: number,
  width: number,
  height: number,
): RectangleGeometry => {
  const normalizedX = coordinate(x, "Rectangle x");
  const normalizedY = coordinate(y, "Rectangle y");
  const normalizedWidth = positiveExtent(width, "Rectangle width");
  const normalizedHeight = positiveExtent(height, "Rectangle height");
  if (normalizedX + normalizedWidth > 1 || normalizedY + normalizedHeight > 1) {
    failLocation("InvalidGeometry", "Rectangle must remain inside the normalized canvas.");
  }
  return Object.freeze({
    kind: "Rectangle",
    x: normalizedX,
    y: normalizedY,
    width: normalizedWidth,
    height: normalizedHeight,
  });
};

const pointKey = (point: NormalizedPoint): string => `${String(point.x)}:${String(point.y)}`;

const crossProduct = (
  first: NormalizedPoint,
  second: NormalizedPoint,
  third: NormalizedPoint,
): number =>
  (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x);

const pointOnSegment = (
  start: NormalizedPoint,
  candidate: NormalizedPoint,
  end: NormalizedPoint,
): boolean =>
  Math.abs(crossProduct(start, candidate, end)) <= MIN_MEANINGFUL_AREA &&
  candidate.x >= Math.min(start.x, end.x) &&
  candidate.x <= Math.max(start.x, end.x) &&
  candidate.y >= Math.min(start.y, end.y) &&
  candidate.y <= Math.max(start.y, end.y);

const orientation = (
  first: NormalizedPoint,
  second: NormalizedPoint,
  third: NormalizedPoint,
): -1 | 0 | 1 => {
  const cross = crossProduct(first, second, third);
  if (Math.abs(cross) <= MIN_MEANINGFUL_AREA) {
    return 0;
  }
  return cross > 0 ? 1 : -1;
};

const segmentsIntersect = (
  firstStart: NormalizedPoint,
  firstEnd: NormalizedPoint,
  secondStart: NormalizedPoint,
  secondEnd: NormalizedPoint,
): boolean => {
  const firstSecondStart = orientation(firstStart, firstEnd, secondStart);
  const firstSecondEnd = orientation(firstStart, firstEnd, secondEnd);
  const secondFirstStart = orientation(secondStart, secondEnd, firstStart);
  const secondFirstEnd = orientation(secondStart, secondEnd, firstEnd);
  if (
    firstSecondStart !== firstSecondEnd &&
    secondFirstStart !== secondFirstEnd &&
    firstSecondStart !== 0 &&
    firstSecondEnd !== 0 &&
    secondFirstStart !== 0 &&
    secondFirstEnd !== 0
  ) {
    return true;
  }
  return (
    (firstSecondStart === 0 && pointOnSegment(firstStart, secondStart, firstEnd)) ||
    (firstSecondEnd === 0 && pointOnSegment(firstStart, secondEnd, firstEnd)) ||
    (secondFirstStart === 0 && pointOnSegment(secondStart, firstStart, secondEnd)) ||
    (secondFirstEnd === 0 && pointOnSegment(secondStart, firstEnd, secondEnd))
  );
};

const polygonArea = (points: readonly NormalizedPoint[]): number => {
  let doubledArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    doubledArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(doubledArea) / 2;
};

const assertSimplePolygon = (points: readonly NormalizedPoint[]): void => {
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
        segmentsIntersect(points[first]!, points[firstNext]!, points[second]!, points[secondNext]!)
      ) {
        failLocation("InvalidGeometry", "Polygon edges cannot intersect.");
      }
    }
  }
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
  if (new Set(points.map(pointKey)).size !== points.length) {
    failLocation("InvalidGeometry", "Polygon points must be unique.");
  }
  if (polygonArea(points) <= MIN_MEANINGFUL_AREA) {
    failLocation("InvalidGeometry", "Polygon must enclose a meaningful area.");
  }
  assertSimplePolygon(points);
  return Object.freeze({
    kind: "Polygon",
    points: Object.freeze(points),
  });
};

export const copyGeometry = (geometry: MapGeometry): MapGeometry =>
  geometry.kind === "Rectangle"
    ? createRectangleGeometry(geometry.x, geometry.y, geometry.width, geometry.height)
    : createPolygonGeometry(geometry.points);
