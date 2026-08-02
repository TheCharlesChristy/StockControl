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

export const onSegment = (a: NormalizedPoint, p: NormalizedPoint, b: NormalizedPoint): boolean =>
  Math.abs(cross(a, p, b)) <= MIN_AREA &&
  p.x >= Math.min(a.x, b.x) &&
  p.x <= Math.max(a.x, b.x) &&
  p.y >= Math.min(a.y, b.y) &&
  p.y <= Math.max(a.y, b.y);

export const orientation = (
  a: NormalizedPoint,
  b: NormalizedPoint,
  c: NormalizedPoint,
): -1 | 0 | 1 => {
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

export const polygonArea = (points: readonly NormalizedPoint[]): number => {
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

export interface GeometryBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** The corners of a shape, clockwise for a rectangle and as drawn for a polygon. */
export const verticesOf = (geometry: MapGeometry): readonly NormalizedPoint[] =>
  geometry.kind === "Polygon"
    ? geometry.points
    : [
        { x: geometry.x, y: geometry.y },
        { x: geometry.x + geometry.width, y: geometry.y },
        { x: geometry.x + geometry.width, y: geometry.y + geometry.height },
        { x: geometry.x, y: geometry.y + geometry.height },
      ];

export const areaOf = (geometry: MapGeometry): number =>
  geometry.kind === "Rectangle" ? geometry.width * geometry.height : polygonArea(geometry.points);

export const boundsOf = (geometry: MapGeometry): GeometryBounds => {
  if (geometry.kind === "Rectangle") {
    return {
      minX: geometry.x,
      minY: geometry.y,
      maxX: geometry.x + geometry.width,
      maxY: geometry.y + geometry.height,
    };
  }
  const xs = geometry.points.map((point) => point.x);
  const ys = geometry.points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
};

/**
 * Ray casting, with a point on the boundary counted as inside. Sharing an edge
 * with the shape around you is the normal way people draw a shelf against the
 * wall of an aisle, so it has to read as "inside".
 */
export const pointInPolygon = (
  point: NormalizedPoint,
  polygon: readonly NormalizedPoint[],
): boolean => {
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]!;
    const next = polygon[(index + 1) % polygon.length]!;
    if (onSegment(current, point, next)) return true;
  }
  let inside = false;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]!;
    const previous = polygon[(index + polygon.length - 1) % polygon.length]!;
    if (
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x
    ) {
      inside = !inside;
    }
  }
  return inside;
};

/** True when two segments cross at an interior point, ignoring touches and overlaps. */
const properlyCrosses = (
  a: NormalizedPoint,
  b: NormalizedPoint,
  c: NormalizedPoint,
  d: NormalizedPoint,
): boolean => {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return abC !== 0 && abD !== 0 && cdA !== 0 && cdB !== 0 && abC !== abD && cdA !== cdB;
};

/**
 * Whether `inner` lies wholly within `outer`. Every corner of the inner shape
 * must be inside the outer one, and no pair of edges may cross, which together
 * settle containment for the simple polygons this editor can produce.
 */
export const geometryContains = (outer: MapGeometry, inner: MapGeometry): boolean => {
  const outerBounds = boundsOf(outer);
  const innerBounds = boundsOf(inner);
  if (
    innerBounds.minX < outerBounds.minX - MIN_AREA ||
    innerBounds.minY < outerBounds.minY - MIN_AREA ||
    innerBounds.maxX > outerBounds.maxX + MIN_AREA ||
    innerBounds.maxY > outerBounds.maxY + MIN_AREA
  ) {
    return false;
  }
  const outerPoints = verticesOf(outer);
  const innerPoints = verticesOf(inner);
  if (!innerPoints.every((point) => pointInPolygon(point, outerPoints))) return false;
  for (let inner1 = 0; inner1 < innerPoints.length; inner1 += 1) {
    const innerA = innerPoints[inner1]!;
    const innerB = innerPoints[(inner1 + 1) % innerPoints.length]!;
    for (let outer1 = 0; outer1 < outerPoints.length; outer1 += 1) {
      const outerA = outerPoints[outer1]!;
      const outerB = outerPoints[(outer1 + 1) % outerPoints.length]!;
      if (properlyCrosses(innerA, innerB, outerA, outerB)) return false;
    }
  }
  return true;
};

/**
 * True when two shapes share area without either one fully containing the
 * other. Touching edges and corners are deliberately not overlaps.
 */
export const geometryPartiallyOverlaps = (left: MapGeometry, right: MapGeometry): boolean => {
  if (geometryContains(left, right) || geometryContains(right, left)) return false;

  const leftBounds = boundsOf(left);
  const rightBounds = boundsOf(right);
  if (
    Math.min(leftBounds.maxX, rightBounds.maxX) <= Math.max(leftBounds.minX, rightBounds.minX) ||
    Math.min(leftBounds.maxY, rightBounds.maxY) <= Math.max(leftBounds.minY, rightBounds.minY)
  )
    return false;

  const leftPoints = verticesOf(left);
  const rightPoints = verticesOf(right);
  for (let leftIndex = 0; leftIndex < leftPoints.length; leftIndex += 1) {
    const leftStart = leftPoints[leftIndex]!;
    const leftEnd = leftPoints[(leftIndex + 1) % leftPoints.length]!;
    for (let rightIndex = 0; rightIndex < rightPoints.length; rightIndex += 1) {
      const rightStart = rightPoints[rightIndex]!;
      const rightEnd = rightPoints[(rightIndex + 1) % rightPoints.length]!;
      if (properlyCrosses(leftStart, leftEnd, rightStart, rightEnd)) return true;
    }
  }

  return (
    leftPoints.some((point) => pointInPolygon(point, rightPoints)) ||
    rightPoints.some((point) => pointInPolygon(point, leftPoints))
  );
};
