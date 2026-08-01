import { describe, expect, it } from "vitest";

import {
  derivedTree,
  deriveContainment,
  descendantIds,
  type ContainmentPlacement,
} from "../src/locations/containment.js";
import {
  createPolygonGeometry,
  createRectangleGeometry,
  geometryContains,
  pointInPolygon,
  type MapGeometry,
} from "../src/locations/geometry.js";

const id = (suffix: number): string =>
  `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

const rectangle = (x: number, y: number, width: number, height: number): MapGeometry =>
  createRectangleGeometry(x, y, width, height);

const place = (suffix: number, geometry: MapGeometry, zOrder = suffix): ContainmentPlacement => ({
  id: id(suffix),
  geometry,
  zOrder,
});

const parentsOf = (placements: readonly ContainmentPlacement[]): Record<string, string | null> =>
  Object.fromEntries(deriveContainment(placements));

describe("geometryContains", () => {
  it("accepts a rectangle wholly inside another", () => {
    expect(geometryContains(rectangle(0, 0, 1, 1), rectangle(0.2, 0.2, 0.1, 0.1))).toBe(true);
  });

  it("counts a shared edge as inside", () => {
    expect(geometryContains(rectangle(0.2, 0.2, 0.4, 0.4), rectangle(0.2, 0.3, 0.1, 0.1))).toBe(
      true,
    );
  });

  it("rejects a shape that only partly overlaps", () => {
    expect(geometryContains(rectangle(0.2, 0.2, 0.2, 0.2), rectangle(0.3, 0.3, 0.2, 0.2))).toBe(
      false,
    );
  });

  it("rejects a shape entirely outside", () => {
    expect(geometryContains(rectangle(0, 0, 0.2, 0.2), rectangle(0.5, 0.5, 0.2, 0.2))).toBe(false);
  });

  it("handles a polygon inside a polygon", () => {
    const outer = createPolygonGeometry([
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.2 },
      { x: 0.8, y: 0.9 },
      { x: 0.2, y: 0.8 },
    ]);
    const inner = createPolygonGeometry([
      { x: 0.4, y: 0.4 },
      { x: 0.6, y: 0.4 },
      { x: 0.5, y: 0.6 },
    ]);
    expect(geometryContains(outer, inner)).toBe(true);
    expect(geometryContains(inner, outer)).toBe(false);
  });

  it("rejects an inner polygon whose point escapes a concave outline", () => {
    /* An L shape: the notch in the top-right is outside the polygon. */
    const outer = createPolygonGeometry([
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.1 },
      { x: 0.5, y: 0.5 },
      { x: 0.9, y: 0.5 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ]);
    expect(geometryContains(outer, rectangle(0.6, 0.15, 0.2, 0.2))).toBe(false);
    expect(geometryContains(outer, rectangle(0.2, 0.6, 0.2, 0.2))).toBe(true);
  });

  it("treats a point on the boundary as inside", () => {
    const square = [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.8 },
    ];
    expect(pointInPolygon({ x: 0.2, y: 0.5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 0.1, y: 0.5 }, square)).toBe(false);
  });
});

describe("deriveContainment", () => {
  it("gives a shape no parent when nothing contains it", () => {
    expect(parentsOf([place(1, rectangle(0.1, 0.1, 0.2, 0.2))])).toEqual({ [id(1)]: null });
  });

  it("picks the smallest containing shape, not the outermost", () => {
    const parents = parentsOf([
      place(1, rectangle(0, 0, 1, 1)),
      place(2, rectangle(0.1, 0.1, 0.5, 0.5)),
      place(3, rectangle(0.2, 0.2, 0.1, 0.1)),
    ]);
    expect(parents).toEqual({ [id(1)]: null, [id(2)]: id(1), [id(3)]: id(2) });
  });

  it("does not depend on the order shapes arrive in", () => {
    const shapes = [
      place(1, rectangle(0, 0, 1, 1)),
      place(2, rectangle(0.1, 0.1, 0.5, 0.5)),
      place(3, rectangle(0.2, 0.2, 0.1, 0.1)),
    ];
    expect(parentsOf([...shapes].reverse())).toEqual(parentsOf(shapes));
  });

  it("leaves partly overlapping shapes as siblings", () => {
    const parents = parentsOf([
      place(1, rectangle(0.1, 0.1, 0.3, 0.3)),
      place(2, rectangle(0.3, 0.3, 0.3, 0.3)),
    ]);
    expect(parents).toEqual({ [id(1)]: null, [id(2)]: null });
  });

  it("nests the shape drawn on top when two shapes are identical", () => {
    const parents = parentsOf([
      place(1, rectangle(0.2, 0.2, 0.4, 0.4), 1),
      place(2, rectangle(0.2, 0.2, 0.4, 0.4), 7),
    ]);
    expect(parents).toEqual({ [id(1)]: null, [id(2)]: id(1) });
  });

  it("never produces a cycle, even for a pile of identical shapes", () => {
    const parents = deriveContainment([
      place(1, rectangle(0.2, 0.2, 0.4, 0.4), 3),
      place(2, rectangle(0.2, 0.2, 0.4, 0.4), 2),
      place(3, rectangle(0.2, 0.2, 0.4, 0.4), 1),
    ]);
    for (const start of parents.keys()) {
      const seen = new Set<string>();
      let cursor: string | null = start;
      while (cursor !== null) {
        expect(seen.has(cursor)).toBe(false);
        seen.add(cursor);
        cursor = parents.get(cursor) ?? null;
      }
    }
  });

  it("re-parents to what remains when a middle shape is taken away", () => {
    const all = [
      place(1, rectangle(0, 0, 1, 1)),
      place(2, rectangle(0.1, 0.1, 0.5, 0.5)),
      place(3, rectangle(0.2, 0.2, 0.1, 0.1)),
    ];
    expect(parentsOf([all[0]!, all[2]!])).toEqual({ [id(1)]: null, [id(3)]: id(1) });
  });
});

describe("derivedTree", () => {
  const named = (
    suffix: number,
    name: string,
    geometry: MapGeometry,
  ): ContainmentPlacement & { readonly name: string } => ({
    ...place(suffix, geometry),
    name,
  });

  it("reports depth and a readable path for a deep chain", () => {
    const nodes = derivedTree([
      named(1, "Main Store", rectangle(0, 0, 1, 1)),
      named(2, "Aisle 3", rectangle(0.1, 0.1, 0.5, 0.5)),
      named(3, "Shelf B", rectangle(0.2, 0.2, 0.1, 0.1)),
    ]);
    expect(nodes.map((node) => [node.name, node.depth, node.path])).toEqual([
      ["Main Store", 0, "Main Store"],
      ["Aisle 3", 1, "Main Store › Aisle 3"],
      ["Shelf B", 2, "Main Store › Aisle 3 › Shelf B"],
    ]);
  });

  it("sorts siblings by name and lists their children", () => {
    const nodes = derivedTree([
      named(1, "Yard", rectangle(0, 0, 1, 1)),
      named(2, "Zone B", rectangle(0.5, 0.1, 0.2, 0.2)),
      named(3, "Alpha", rectangle(0.1, 0.1, 0.2, 0.2)),
    ]);
    expect(nodes.map((node) => node.name)).toEqual(["Yard", "Alpha", "Zone B"]);
    expect(nodes[0]!.childIds).toEqual([id(3), id(2)]);
  });

  it("covers every placement exactly once", () => {
    const nodes = derivedTree([
      named(1, "One", rectangle(0.1, 0.1, 0.2, 0.2)),
      named(2, "Two", rectangle(0.5, 0.5, 0.2, 0.2)),
    ]);
    expect(nodes).toHaveLength(2);
    expect(nodes.every((node) => node.parentId === null)).toBe(true);
  });
});

describe("descendantIds", () => {
  it("collects a shape and everything drawn inside it", () => {
    const parents = deriveContainment([
      place(1, rectangle(0, 0, 1, 1)),
      place(2, rectangle(0.1, 0.1, 0.5, 0.5)),
      place(3, rectangle(0.2, 0.2, 0.1, 0.1)),
      place(4, rectangle(0.7, 0.7, 0.1, 0.1)),
    ]);
    expect([...descendantIds(parents, id(2))].sort()).toEqual([id(2), id(3)]);
    expect([...descendantIds(parents, id(1))].sort()).toEqual([id(1), id(2), id(3), id(4)]);
    expect([...descendantIds(parents, id(4))]).toEqual([id(4)]);
  });
});
