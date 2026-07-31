import { describe, expect, it } from "vitest";

import {
  MIN_REGION_SIZE,
  boundsOf,
  moveGeometry,
  polygonProblem,
  polylinePoints,
  rectangleFromPoints,
  resizeRectangle,
  snapGeometry,
  snapPoint,
  snapValue,
  unionBounds,
  type PolygonGeometry,
  type RectangleGeometry,
} from "./geometry";

const rectangle = (x: number, y: number, width: number, height: number): RectangleGeometry => ({
  kind: "Rectangle",
  x,
  y,
  width,
  height,
});

const polygon = (points: readonly { x: number; y: number }[]): PolygonGeometry => ({
  kind: "Polygon",
  points,
});

/** Compares geometry without tripping over binary-float noise. */
function expectRectangle(actual: RectangleGeometry | null, expected: RectangleGeometry): void {
  expect(actual).not.toBeNull();
  expect(actual?.x).toBeCloseTo(expected.x, 9);
  expect(actual?.y).toBeCloseTo(expected.y, 9);
  expect(actual?.width).toBeCloseTo(expected.width, 9);
  expect(actual?.height).toBeCloseTo(expected.height, 9);
}

describe("moveGeometry", () => {
  it("moves a rectangle by the delta", () => {
    expectRectangle(
      moveGeometry(rectangle(0.1, 0.2, 0.3, 0.4), 0.05, -0.1) as RectangleGeometry,
      rectangle(0.15, 0.1, 0.3, 0.4),
    );
  });

  it("stops a rectangle at the canvas edges", () => {
    expect(moveGeometry(rectangle(0.8, 0.8, 0.3, 0.3), 1, 1)).toEqual(
      rectangle(0.7, 0.7, 0.3, 0.3),
    );
    expect(moveGeometry(rectangle(0.1, 0.1, 0.2, 0.2), -1, -1)).toEqual(rectangle(0, 0, 0.2, 0.2));
  });

  it("moves a polygon as a body without distorting it at the edge", () => {
    const moved = moveGeometry(
      polygon([
        { x: 0.5, y: 0.5 },
        { x: 0.7, y: 0.5 },
        { x: 0.6, y: 0.7 },
      ]),
      1,
      0,
    );
    const bounds = boundsOf(moved);

    /* The delta is capped so the right edge lands on the canvas edge, not past it. */
    expect(bounds.maxX).toBeCloseTo(1, 9);
    expect(bounds.maxX - bounds.minX).toBeCloseTo(0.2, 9);
    expect(bounds.minY).toBeCloseTo(0.5, 9);
  });
});

describe("resizeRectangle", () => {
  const base = rectangle(0.2, 0.2, 0.4, 0.4);

  it("moves only the edges the handle owns", () => {
    expectRectangle(resizeRectangle(base, "se", { x: 0.8, y: 0.9 }), rectangle(0.2, 0.2, 0.6, 0.7));
    expectRectangle(
      resizeRectangle(base, "nw", { x: 0.1, y: 0.05 }),
      rectangle(0.1, 0.05, 0.5, 0.55),
    );
    expectRectangle(resizeRectangle(base, "ne", { x: 0.9, y: 0.1 }), rectangle(0.2, 0.1, 0.7, 0.5));
    expectRectangle(resizeRectangle(base, "sw", { x: 0.1, y: 0.9 }), rectangle(0.1, 0.2, 0.5, 0.7));
  });

  it("never shrinks below the minimum region size on any handle", () => {
    for (const handle of ["nw", "ne", "sw", "se"] as const) {
      const resized = resizeRectangle(base, handle, { x: 0.4, y: 0.4 });
      expect(resized.width).toBeGreaterThanOrEqual(MIN_REGION_SIZE - 1e-9);
      expect(resized.height).toBeGreaterThanOrEqual(MIN_REGION_SIZE - 1e-9);
    }
  });

  it("keeps the result inside the canvas", () => {
    const resized = resizeRectangle(base, "se", { x: 5, y: 5 });
    expect(resized.x + resized.width).toBeLessThanOrEqual(1);
    expect(resized.y + resized.height).toBeLessThanOrEqual(1);
  });
});

describe("rectangleFromPoints", () => {
  it("normalises a drag made right-to-left and bottom-to-top", () => {
    expectRectangle(
      rectangleFromPoints({ x: 0.6, y: 0.7 }, { x: 0.2, y: 0.3 }),
      rectangle(0.2, 0.3, 0.4, 0.4),
    );
  });

  it("treats a stray click as no rectangle at all", () => {
    expect(rectangleFromPoints({ x: 0.4, y: 0.4 }, { x: 0.401, y: 0.402 })).toBeNull();
  });

  it("raises a thin drag to the minimum region size", () => {
    const drawn = rectangleFromPoints({ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.402 });
    expect(drawn?.height).toBe(MIN_REGION_SIZE);
  });

  it("keeps a drag that leaves the canvas inside it", () => {
    const drawn = rectangleFromPoints({ x: 0.95, y: 0.95 }, { x: 1.4, y: 1.4 });
    expect(drawn).not.toBeNull();
    expect((drawn?.x ?? 0) + (drawn?.width ?? 0)).toBeLessThanOrEqual(1);
  });
});

describe("snapping", () => {
  it("rounds to the grid without binary-float noise", () => {
    expect(snapValue(0.3049, 0.01)).toBe(0.3);
    expect(snapValue(0.307, 0.01)).toBe(0.31);
    expect(snapPoint({ x: 0.1234, y: 0.5678 }, 0.01)).toEqual({ x: 0.12, y: 0.57 });
  });

  it("aligns a shape's corner to the grid without changing its size", () => {
    expectRectangle(
      snapGeometry(rectangle(0.123, 0.456, 0.3, 0.2), 0.01) as RectangleGeometry,
      rectangle(0.12, 0.46, 0.3, 0.2),
    );
  });

  it("aligns a polygon without distorting it", () => {
    const snapped = snapGeometry(
      polygon([
        { x: 0.123, y: 0.2 },
        { x: 0.323, y: 0.2 },
        { x: 0.223, y: 0.4 },
      ]),
      0.01,
    );
    const bounds = boundsOf(snapped);
    expect(bounds.minX).toBeCloseTo(0.12, 6);
    expect(bounds.maxX - bounds.minX).toBeCloseTo(0.2, 6);
  });
});

describe("bounds", () => {
  it("bounds a polygon by its extremes", () => {
    expect(
      boundsOf(
        polygon([
          { x: 0.2, y: 0.3 },
          { x: 0.8, y: 0.1 },
          { x: 0.5, y: 0.9 },
        ]),
      ),
    ).toEqual({ minX: 0.2, minY: 0.1, maxX: 0.8, maxY: 0.9 });
  });

  it("unions several shapes and reports nothing for an empty map", () => {
    expect(unionBounds([rectangle(0.1, 0.1, 0.2, 0.2), rectangle(0.6, 0.5, 0.2, 0.4)])).toEqual({
      minX: 0.1,
      minY: 0.1,
      maxX: 0.8,
      maxY: 0.9,
    });
    expect(unionBounds([])).toBeNull();
  });
});

describe("polygonProblem", () => {
  const square = [
    { x: 0.2, y: 0.2 },
    { x: 0.6, y: 0.2 },
    { x: 0.6, y: 0.6 },
    { x: 0.2, y: 0.6 },
  ];

  it("accepts a simple polygon", () => {
    expect(polygonProblem(square)).toBeNull();
  });

  it("rejects a shape whose edges cross", () => {
    /* Lobes of unequal size, so this fails on the crossing rather than on area. */
    expect(
      polygonProblem([
        { x: 0.1, y: 0.5 },
        { x: 0.9, y: 0.5 },
        { x: 0.7, y: 0.1 },
        { x: 0.2, y: 0.9 },
      ]),
    ).toBe("Polygon edges cannot cross.");
  });

  it("rejects a symmetric bow tie as enclosing nothing", () => {
    expect(
      polygonProblem([
        { x: 0.2, y: 0.2 },
        { x: 0.6, y: 0.6 },
        { x: 0.6, y: 0.2 },
        { x: 0.2, y: 0.6 },
      ]),
    ).toBe("The polygon does not enclose an area.");
  });

  it("rejects too few points, duplicates and zero area", () => {
    expect(polygonProblem(square.slice(0, 2))).toBe("A polygon needs at least three points.");
    expect(polygonProblem([...square, { x: 0.2, y: 0.2 }])).toBe("Polygon points must be unique.");
    expect(
      polygonProblem([
        { x: 0.2, y: 0.2 },
        { x: 0.4, y: 0.2 },
        { x: 0.6, y: 0.2 },
      ]),
    ).toBe("The polygon does not enclose an area.");
  });
});

describe("polylinePoints", () => {
  it("scales normalized points into map units", () => {
    expect(
      polylinePoints([
        { x: 0, y: 0 },
        { x: 0.5, y: 1 },
      ]),
    ).toBe("0,0 50,100");
  });
});
