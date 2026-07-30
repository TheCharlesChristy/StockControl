import { describe, expect, it } from "vitest";

import {
  LocationDomainError,
  copyGeometry,
  createPolygonGeometry,
  createRectangleGeometry,
} from "../src/index.js";

describe("normalized abstract map geometry", () => {
  it("creates immutable normalized rectangles and defensive copies", () => {
    const rectangle = createRectangleGeometry(0.1, 0.2, 0.3, 0.4);
    expect(rectangle).toEqual({
      kind: "Rectangle",
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
    });
    expect(Object.isFrozen(rectangle)).toBe(true);
    const copy = copyGeometry(rectangle);
    expect(copy).toEqual(rectangle);
    expect(copy).not.toBe(rectangle);
  });

  it("rejects NaN, infinity, out-of-range coordinates, nonpositive extents, and overflow", () => {
    const invalidRectangles = [
      [Number.NaN, 0, 0.2, 0.2],
      [Number.POSITIVE_INFINITY, 0, 0.2, 0.2],
      [-0.1, 0, 0.2, 0.2],
      [0, 1.1, 0.2, 0.2],
      [0, 0, 0, 0.2],
      [0, 0, 0.2, -0.1],
      [0.9, 0, 0.2, 0.2],
      [0, 0.9, 0.2, 0.2],
    ] as const;
    for (const [x, y, width, height] of invalidRectangles) {
      expect(() => createRectangleGeometry(x, y, width, height)).toThrow(LocationDomainError);
    }
    expect(createRectangleGeometry(0, 0, 1, 1)).toMatchObject({ width: 1, height: 1 });
  });

  it("creates simple immutable polygons and breaks all caller array aliases", () => {
    const source = [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.9 },
    ];
    const polygon = createPolygonGeometry(source);
    source[0]!.x = 0.5;

    expect(polygon.points[0]).toEqual({ x: 0.1, y: 0.1 });
    expect(Object.isFrozen(polygon)).toBe(true);
    expect(Object.isFrozen(polygon.points)).toBe(true);
    expect(polygon.points.every(Object.isFrozen)).toBe(true);
    const copy = copyGeometry(polygon);
    expect(copy).toEqual(polygon);
    expect(copy).not.toBe(polygon);
    expect(copy.kind === "Polygon" && copy.points).not.toBe(polygon.points);
  });

  it("rejects unsafe polygon cardinality and every non-finite or unnormalized coordinate", () => {
    expect(() =>
      createPolygonGeometry([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]),
    ).toThrow("3-128");
    expect(() =>
      createPolygonGeometry(
        Array.from({ length: 129 }, (_, index) => ({
          x: (index % 10) / 10,
          y: Math.floor(index / 10) / 20,
        })),
      ),
    ).toThrow("3-128");
    for (const point of [
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.NEGATIVE_INFINITY },
      { x: -0.01, y: 0 },
      { x: 0, y: 1.01 },
    ]) {
      expect(() => createPolygonGeometry([point, { x: 1, y: 0 }, { x: 0, y: 1 }])).toThrow(
        "finite normalized",
      );
    }
  });

  it("rejects duplicate, collinear, and self-intersecting polygon shapes", () => {
    expect(() =>
      createPolygonGeometry([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 0 },
      ]),
    ).toThrow("unique");
    expect(() =>
      createPolygonGeometry([
        { x: 0, y: 0 },
        { x: 0.5, y: 0.5 },
        { x: 1, y: 1 },
      ]),
    ).toThrow("meaningful area");
    expect(() =>
      createPolygonGeometry([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0.2, y: 1 },
        { x: 0.8, y: 1 },
      ]),
    ).toThrow("edges cannot intersect");
    expect(() =>
      createPolygonGeometry([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0.5, y: 0 },
        { x: 0.5, y: 1 },
      ]),
    ).toThrow("edges cannot intersect");
  });
});
