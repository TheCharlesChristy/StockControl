import { describe, expect, it } from "vitest";

import {
  BuildingMap,
  LocationDirectory,
  LocationDomainError,
  createLocationCode,
  createLocationId,
  createLocationName,
  createMapId,
  createMapRegionId,
  createPolygonGeometry,
  createRectangleGeometry,
} from "../src/index.js";

const id = (value: number): ReturnType<typeof createLocationId> =>
  createLocationId(`00000000-0000-4000-8000-${String(value).padStart(12, "0")}`);
const regionId = (value: number): ReturnType<typeof createMapRegionId> =>
  createMapRegionId(`00000000-0000-4000-8000-${String(value + 100).padStart(12, "0")}`);

function directory(): LocationDirectory {
  const result = LocationDirectory.create({
    id: id(1),
    code: createLocationCode("BRANCH-001"),
    name: createLocationName("Main Branch"),
  });
  const building = result.addHierarchyNode({
    id: id(2),
    code: createLocationCode("BUILDING-001"),
    name: createLocationName("Main Store"),
    nodeKind: "Building",
    operationalKind: "Container",
    parentId: id(1),
  });
  result.addHierarchyNode({
    id: id(3),
    code: createLocationCode("AREA-001"),
    name: createLocationName("Ground floor"),
    nodeKind: "Area",
    operationalKind: "Storage",
    parentId: building.id,
  });
  return result;
}

describe("normalized map geometry", () => {
  it("accepts bounded rectangles and rejects overflow", () => {
    expect(createRectangleGeometry(0.1, 0.1, 0.2, 0.3)).toEqual({
      kind: "Rectangle",
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.3,
    });
    expect(() => createRectangleGeometry(0.9, 0, 0.2, 0.1)).toThrowError(
      new LocationDomainError(
        "InvalidGeometry",
        "Rectangle must remain inside the normalized canvas.",
      ),
    );
  });

  it("rejects self-intersecting polygons", () => {
    expect(() =>
      createPolygonGeometry([
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.1, y: 0.9 },
        { x: 0.9, y: 0.1 },
      ]),
    ).toThrowError(LocationDomainError);
  });
});

describe("location hierarchy", () => {
  it("rejects cross-building moves and never reuses archived codes", () => {
    const locations = directory();
    const secondBuilding = locations.addHierarchyNode({
      id: id(4),
      code: createLocationCode("BUILDING-002"),
      name: createLocationName("Overflow Store"),
      nodeKind: "Building",
      operationalKind: "Container",
      parentId: id(1),
    });
    const area = locations.getHierarchyNode(id(3))!;

    expect(() => locations.moveHierarchyNode(area.id, secondBuilding.id)).toThrowError(
      LocationDomainError,
    );
    locations.retireHierarchyNode(area.id, { occupied: true, historicallyReferenced: true });
    expect(() =>
      locations.addHierarchyNode({
        id: id(5),
        code: area.code,
        name: createLocationName("Replacement"),
        nodeKind: "Area",
        operationalKind: "Storage",
        parentId: secondBuilding.id,
      }),
    ).toThrowError(LocationDomainError);
  });
});

describe("BuildingMap", () => {
  it("links regions to the same Building and keeps visual nesting separate", () => {
    const locations = directory();
    const building = locations.listHierarchyNodes().find((node) => node.nodeKind === "Building")!;
    const area = locations.listHierarchyNodes().find((node) => node.nodeKind === "Area")!;
    const map = BuildingMap.create(
      createMapId("00000000-0000-4000-8000-000000000010"),
      building.id,
      { kind: "Blank" },
      locations,
    );
    const parent = map.addRegion(
      {
        id: regionId(1),
        displayName: createLocationName("North"),
        hierarchyNodeId: area.id,
        geometry: createRectangleGeometry(0.1, 0.1, 0.4, 0.4),
        zOrder: 1,
      },
      locations,
    );
    const child = map.addRegion(
      {
        id: regionId(2),
        displayName: createLocationName("Rack"),
        hierarchyNodeId: area.id,
        parentRegionId: parent.id,
        geometry: createRectangleGeometry(0.2, 0.2, 0.1, 0.1),
        zOrder: 2,
      },
      locations,
    );
    expect(child.parentRegionId).toBe(parent.id);
    expect(map.snapshot().regions[0]?.hierarchyNodeId).toBe(area.id);
    expect(() => map.nestRegion(parent.id, child.id)).toThrowError(LocationDomainError);
  });
});
