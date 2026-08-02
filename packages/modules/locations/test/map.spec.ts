import { describe, expect, it } from "vitest";

import {
  LocationDomainError,
  LocationMap,
  createLocationCode,
  createLocationId,
  createLocationName,
  createMapId,
  createPolygonGeometry,
  createRectangleGeometry,
  retirementOutcome,
} from "../src/index.js";

const id = (value: number): ReturnType<typeof createLocationId> =>
  createLocationId(`00000000-0000-4000-8000-${String(value).padStart(12, "0")}`);

const emptyMap = (): LocationMap =>
  LocationMap.create(
    createMapId("00000000-0000-4000-8000-000000000010"),
    createLocationCode("MAP-001"),
    createLocationName("Main Store"),
    { kind: "Blank" },
  );

const add = (
  map: LocationMap,
  value: number,
  code: string,
  name: string,
  geometry: ReturnType<typeof createRectangleGeometry>,
  zOrder = value,
): ReturnType<LocationMap["addLocation"]> =>
  map.addLocation({
    id: id(value),
    code: createLocationCode(code),
    name: createLocationName(name),
    geometry,
    zOrder,
  });

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

describe("LocationMap", () => {
  it("makes a drawn shape a location in its own right", () => {
    const map = emptyMap();
    const drawn = add(map, 1, "STORE-A1", "Aisle 1", createRectangleGeometry(0.1, 0.1, 0.4, 0.4));

    expect(drawn.status).toBe("Active");
    expect(map.getLocation(drawn.id)?.name).toBe("Aisle 1");
    expect(map.snapshot().locations).toHaveLength(1);
  });

  it("refuses duplicate identities and duplicate codes", () => {
    const map = emptyMap();
    add(map, 1, "STORE-A1", "Aisle 1", createRectangleGeometry(0.1, 0.1, 0.4, 0.4));

    expect(() =>
      add(map, 1, "STORE-A2", "Aisle 2", createRectangleGeometry(0.6, 0.1, 0.2, 0.2)),
    ).toThrowError(LocationDomainError);
    expect(() =>
      add(map, 2, "STORE-A1", "Aisle 2", createRectangleGeometry(0.6, 0.1, 0.2, 0.2)),
    ).toThrowError(LocationDomainError);
  });

  it("derives nesting from geometry alone, with no parent ever supplied", () => {
    const map = emptyMap();
    add(map, 1, "STORE-A", "Ground floor", createRectangleGeometry(0, 0, 1, 1));
    add(map, 2, "STORE-B", "Aisle 3", createRectangleGeometry(0.1, 0.1, 0.5, 0.5));
    add(map, 3, "STORE-C", "Shelf B", createRectangleGeometry(0.2, 0.2, 0.1, 0.1));

    expect(map.tree().map((node) => node.path)).toEqual([
      "Ground floor",
      "Ground floor › Aisle 3",
      "Ground floor › Aisle 3 › Shelf B",
    ]);
  });

  it("rejects partially overlapping areas while allowing containment", () => {
    const map = emptyMap();
    add(map, 1, "STORE-A", "Aisle 1", createRectangleGeometry(0.1, 0.1, 0.3, 0.3));

    expect(() =>
      add(map, 2, "STORE-B", "Aisle 2", createRectangleGeometry(0.3, 0.3, 0.3, 0.3)),
    ).toThrowError(
      new LocationDomainError(
        "InvalidGeometry",
        "Location areas must be separate or one must fully contain the other.",
      ),
    );
    expect(() =>
      add(map, 3, "STORE-C", "Shelf 1", createRectangleGeometry(0.2, 0.2, 0.1, 0.1)),
    ).not.toThrow();
  });

  it("re-derives nesting when a shape is dragged out of its container", () => {
    const map = emptyMap();
    add(map, 1, "STORE-A", "Ground floor", createRectangleGeometry(0, 0, 0.6, 0.6));
    const shelf = add(map, 2, "STORE-B", "Shelf B", createRectangleGeometry(0.1, 0.1, 0.1, 0.1));
    expect(map.containment().get(shelf.id)).toBe(id(1));

    map.updateLocation(shelf.id, { geometry: createRectangleGeometry(0.8, 0.8, 0.1, 0.1) });
    expect(map.containment().get(shelf.id)).toBeNull();
  });

  it("drops an archived shape out of the derived tree without orphaning its contents", () => {
    const map = emptyMap();
    add(map, 1, "STORE-A", "Ground floor", createRectangleGeometry(0, 0, 1, 1));
    const aisle = add(map, 2, "STORE-B", "Aisle 3", createRectangleGeometry(0.1, 0.1, 0.5, 0.5));
    add(map, 3, "STORE-C", "Shelf B", createRectangleGeometry(0.2, 0.2, 0.1, 0.1));

    map.archiveLocation(aisle.id);

    expect(map.tree().map((node) => node.path)).toEqual(["Ground floor", "Ground floor › Shelf B"]);
  });

  it("matches search on code, name and alias", () => {
    const map = emptyMap();
    const aisle = add(map, 1, "STORE-A1", "Aisle 1", createRectangleGeometry(0.1, 0.1, 0.4, 0.4));
    map.updateLocation(aisle.id, { searchAliases: ["copper fittings"] });

    expect(map.search("store-a1").map((match) => match.id)).toEqual([aisle.id]);
    expect(map.search("aisle").map((match) => match.id)).toEqual([aisle.id]);
    expect(map.search("copper").map((match) => match.id)).toEqual([aisle.id]);
    expect(map.search("nothing")).toEqual([]);
  });

  it("refuses changes once the map is archived", () => {
    const map = LocationMap.rehydrate({
      id: createMapId("00000000-0000-4000-8000-000000000010"),
      code: createLocationCode("MAP-001"),
      name: createLocationName("Old Store"),
      background: { kind: "Blank" },
      status: "Archived",
      locations: [],
    });

    expect(() =>
      add(map, 1, "STORE-A1", "Aisle 1", createRectangleGeometry(0.1, 0.1, 0.4, 0.4)),
    ).toThrowError(LocationDomainError);
  });

  it("rejects floor-plan metadata that could escape the object store", () => {
    expect(() =>
      LocationMap.create(
        createMapId("00000000-0000-4000-8000-000000000010"),
        createLocationCode("MAP-001"),
        createLocationName("Main Store"),
        {
          kind: "FloorPlan",
          documentId: createLocationCode("DOC-1") as unknown as never,
          originalFileName: "../../etc/passwd",
          mediaType: "image/png",
        },
      ),
    ).toThrowError(LocationDomainError);
  });
});

describe("retirementOutcome", () => {
  it("keeps identity for anything the ledger still needs", () => {
    expect(retirementOutcome({ occupied: true, historicallyReferenced: false })).toBe("Archived");
    expect(retirementOutcome({ occupied: false, historicallyReferenced: true })).toBe("Archived");
  });

  it("removes a shape that was never used", () => {
    expect(retirementOutcome({ occupied: false, historicallyReferenced: false })).toBe("Removed");
  });
});
