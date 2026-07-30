import { describe, expect, it } from "vitest";

import {
  BuildingMap,
  LocationDomainError,
  createDocumentId,
  createLocationCode,
  createLocationName,
  createPolygonGeometry,
  createRectangleGeometry,
  mapRegionStatusPresentation,
  validateHierarchyMapConsistency,
  type BuildingMapSnapshot,
  type DerivedStockStatus,
  type FloorPlanMapBackground,
  type AddMapRegion,
  type LocationDirectory,
  type MapRegion,
} from "../src/index.js";
import {
  areaId,
  branchId,
  buildingOneId,
  buildingTwoId,
  directoryWithBuildings,
  locationId,
  mapId,
  populatedDirectory,
  regionId,
} from "./helpers.js";

const expectDomainCode = (operation: () => unknown, code: string): void => {
  try {
    operation();
    throw new Error("Expected operation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(LocationDomainError);
    expect(error).toMatchObject({ code });
  }
};

const blankMap = (): { directory: LocationDirectory; map: BuildingMap } => {
  const directory = populatedDirectory();
  const map = BuildingMap.create(mapId(1), buildingOneId, { kind: "Blank" }, directory);
  return { directory, map };
};

const regionInput = (overrides: Partial<AddMapRegion> = {}): AddMapRegion => ({
  id: regionId(1),
  displayName: createLocationName("Ground floor region"),
  hierarchyNodeId: areaId,
  geometry: createRectangleGeometry(0.1, 0.1, 0.6, 0.6),
  zOrder: 10,
  searchAliases: ["fasteners", "main cache"],
  ...overrides,
});

describe("Building map backgrounds and lifecycle", () => {
  it("starts from a blank canvas or bounded floor-plan metadata", () => {
    const directory = populatedDirectory();
    const blank = BuildingMap.create(mapId(1), buildingOneId, { kind: "Blank" }, directory);
    expect(blank.snapshot()).toMatchObject({
      buildingId: buildingOneId,
      background: { kind: "Blank" },
      status: "Active",
      regions: [],
    });

    const floorPlan: FloorPlanMapBackground = {
      kind: "FloorPlan",
      documentId: createDocumentId("floorplan.document"),
      originalFileName: "main-store.png",
      mediaType: "image/png",
      pixelWidth: 2_000,
      pixelHeight: 1_000,
    };
    const withFloorPlan = BuildingMap.create(mapId(2), buildingTwoId, floorPlan, directory);
    expect(withFloorPlan.snapshot().background).toEqual(floorPlan);
    expect(
      withFloorPlan.setBackground({
        kind: "FloorPlan",
        documentId: createDocumentId("floorplan.pdf"),
        originalFileName: "remote-store.pdf",
        mediaType: "application/pdf",
      }),
    ).toMatchObject({ mediaType: "application/pdf" });
  });

  it("rejects unsafe floor-plan metadata without treating pixels as map coordinates", () => {
    const { map } = blankMap();
    const base = {
      kind: "FloorPlan" as const,
      documentId: createDocumentId("document.1"),
      originalFileName: "plan.jpg",
      mediaType: "image/jpeg" as const,
    };
    const invalid = [
      { ...base, documentId: "bad id" as typeof base.documentId },
      { ...base, originalFileName: "" },
      { ...base, originalFileName: "x".repeat(241) },
      { ...base, originalFileName: " path.jpg" },
      { ...base, originalFileName: "../path.jpg" },
      { ...base, originalFileName: "bad\u0000name.jpg" },
      { ...base, mediaType: "image/gif" as "image/jpeg" },
      { ...base, pixelWidth: 100 },
      { ...base, pixelWidth: 0, pixelHeight: 100 },
      { ...base, pixelWidth: 1.5, pixelHeight: 100 },
      { ...base, pixelWidth: 100_001, pixelHeight: 100 },
      { ...base, pixelWidth: 100, pixelHeight: 100_001 },
    ];
    for (const background of invalid) {
      expectDomainCode(() => map.setBackground(background), "InvalidBackground");
    }
  });

  it("requires a real active Building and archives atomically with that Building", () => {
    const directory = directoryWithBuildings();
    expectDomainCode(
      () => BuildingMap.create(mapId(1), branchId, { kind: "Blank" }, directory),
      "InvalidMapLink",
    );
    expectDomainCode(
      () => BuildingMap.create(mapId(1), locationId(999), { kind: "Blank" }, directory),
      "InvalidMapLink",
    );

    const map = BuildingMap.create(mapId(1), buildingOneId, { kind: "Blank" }, directory);
    expectDomainCode(() => map.archive(directory), "InvalidMapLink");
    directory.retireHierarchyNode(buildingOneId, {
      occupied: false,
      historicallyReferenced: true,
    });
    expect(map.archive(directory)).toMatchObject({
      status: "Archived",
    });
    expectDomainCode(() => map.setBackground({ kind: "Blank" }), "ArchivedEntity");
    expectDomainCode(
      () => BuildingMap.create(mapId(3), buildingOneId, { kind: "Blank" }, directory),
      "ArchivedEntity",
    );
    expectDomainCode(() => map.archive(directory), "ArchivedEntity");
  });
});

describe("same-Building map regions", () => {
  it("links finite rectangles and polygons while preserving region and location identity", () => {
    const { directory, map } = blankMap();
    const region = map.addRegion(regionInput(), directory);
    expect(region).toMatchObject({
      id: regionId(1),
      hierarchyNodeId: areaId,
      displayName: "Ground floor region",
      zOrder: 10,
      status: "Active",
    });
    const changed = map.updateRegion(region.id, {
      displayName: createLocationName("Updated visual label"),
      geometry: createPolygonGeometry([
        { x: 0.1, y: 0.1 },
        { x: 0.8, y: 0.1 },
        { x: 0.7, y: 0.7 },
      ]),
      zOrder: -2,
      searchAliases: ["new alias"],
    });
    expect(changed).toMatchObject({
      id: region.id,
      hierarchyNodeId: areaId,
      displayName: "Updated visual label",
      zOrder: -2,
      searchAliases: ["new alias"],
    });
    expect(changed.geometry.kind).toBe("Polygon");
    expectDomainCode(
      () =>
        map.updateRegion(region.id, {
          displayName: " noncanonical " as typeof region.displayName,
        }),
      "InvalidOperation",
    );

    const copy = map.getRegion(region.id)!;
    (copy.searchAliases as string[]).push("tampered");
    expect(map.getRegion(region.id)!.searchAliases).toEqual(["new alias"]);
    expect(map.getRegion(regionId(99))).toBeUndefined();
  });

  it("rejects missing, Branch, cross-Building, and archived hierarchy links", () => {
    const { directory, map } = blankMap();
    const remote = directory.addHierarchyNode({
      id: locationId(101),
      code: createLocationCode("REMOTE-AREA"),
      name: createLocationName("Remote area"),
      nodeKind: "Area",
      operationalKind: "Storage",
      parentId: buildingTwoId,
    });
    for (const hierarchyNodeId of [locationId(999), branchId, remote.id]) {
      expectDomainCode(
        () =>
          map.addRegion(
            regionInput({
              id: regionId(10 + Number(hierarchyNodeId === remote.id)),
              hierarchyNodeId,
            }),
            directory,
          ),
        "InvalidMapLink",
      );
    }
    const archivedNode = directory.addHierarchyNode({
      id: locationId(102),
      code: createLocationCode("ARCHIVED-LINK"),
      name: createLocationName("Archived link"),
      nodeKind: "CustomSection",
      operationalKind: "Storage",
      parentId: buildingOneId,
    });
    directory.retireHierarchyNode(archivedNode.id, {
      occupied: true,
      historicallyReferenced: true,
    });
    expectDomainCode(
      () => map.addRegion(regionInput({ hierarchyNodeId: archivedNode.id }), directory),
      "InvalidMapLink",
    );
  });

  it("supports logical nesting but prevents missing parents, cycles, and parent orphaning", () => {
    const { directory, map } = blankMap();
    const parent = map.addRegion(regionInput(), directory);
    const child = map.addRegion(
      regionInput({
        id: regionId(2),
        displayName: createLocationName("Child"),
        parentRegionId: parent.id,
        geometry: createRectangleGeometry(0.2, 0.2, 0.2, 0.2),
      }),
      directory,
    );
    const grandchild = map.addRegion(
      regionInput({
        id: regionId(3),
        displayName: createLocationName("Grandchild"),
        parentRegionId: child.id,
        geometry: createRectangleGeometry(0.3, 0.3, 0.1, 0.1),
      }),
      directory,
    );
    expect(grandchild.parentRegionId).toBe(child.id);
    expectDomainCode(() => map.nestRegion(parent.id, grandchild.id), "Cycle");
    expectDomainCode(() => map.nestRegion(child.id, child.id), "Cycle");
    expectDomainCode(() => map.nestRegion(child.id, parent.id), "NoChange");
    expectDomainCode(() => map.nestRegion(child.id, regionId(99)), "MissingEntity");
    expectDomainCode(() => map.archiveRegion(parent.id), "Orphan");
    expect(map.archiveRegion(grandchild.id).status).toBe("Archived");
    expect(map.archiveRegion(child.id).status).toBe("Archived");
    expect(map.archiveRegion(parent.id).status).toBe("Archived");
    expectDomainCode(() => map.updateRegion(parent.id, {}), "ArchivedEntity");
    expectDomainCode(() => map.archiveRegion(parent.id), "ArchivedEntity");
    expectDomainCode(() => map.archiveRegion(regionId(99)), "MissingEntity");
  });

  it("validates bounded z-order, aliases, duplicate identities, and active parents", () => {
    const { directory, map } = blankMap();
    const first = map.addRegion(regionInput(), directory);
    expectDomainCode(() => map.addRegion(regionInput(), directory), "DuplicateEntity");
    expectDomainCode(() => map.updateRegion(first.id, { zOrder: Number.NaN }), "InvalidOperation");
    expectDomainCode(() => map.updateRegion(first.id, { zOrder: 100_001 }), "InvalidOperation");
    expectDomainCode(
      () => map.updateRegion(first.id, { searchAliases: ["", "ok"] }),
      "InvalidOperation",
    );
    expectDomainCode(
      () => map.updateRegion(first.id, { searchAliases: ["Same", "same"] }),
      "InvalidOperation",
    );
    expectDomainCode(
      () => map.updateRegion(first.id, { searchAliases: ["a".repeat(81)] }),
      "InvalidOperation",
    );
    expectDomainCode(
      () => map.updateRegion(first.id, { searchAliases: ["unsafe\nalias"] }),
      "InvalidOperation",
    );
    expectDomainCode(
      () =>
        map.updateRegion(first.id, {
          searchAliases: Array.from({ length: 21 }, (_, index) => `alias ${String(index)}`),
        }),
      "InvalidOperation",
    );
    map.archiveRegion(first.id);
    expectDomainCode(
      () =>
        map.addRegion(
          regionInput({
            id: regionId(2),
            parentRegionId: first.id,
          }),
          directory,
        ),
      "Orphan",
    );
  });

  it("searches display names, hierarchy names/codes, and aliases in deterministic z-order", () => {
    const { directory, map } = blankMap();
    map.addRegion(regionInput({ zOrder: 5 }), directory);
    map.addRegion(
      regionInput({
        id: regionId(2),
        displayName: createLocationName("Alpha visual"),
        zOrder: 1,
        searchAliases: ["fasteners secondary"],
      }),
      directory,
    );
    expect(map.search("fasteners", directory).map((region) => region.id)).toEqual([
      regionId(2),
      regionId(1),
    ]);
    expect(map.search("ground floor", directory)).toHaveLength(2);
    expect(map.search("AREA-1", directory)).toHaveLength(2);
    map.archiveRegion(regionId(2));
    expect(map.search("alpha", directory)).toEqual([]);
    const removable = directory.addHierarchyNode({
      id: locationId(103),
      code: createLocationCode("SEARCH-REMOVED"),
      name: createLocationName("Search removed"),
      nodeKind: "CustomSection",
      operationalKind: "Storage",
      parentId: buildingOneId,
    });
    map.addRegion(
      regionInput({
        id: regionId(3),
        hierarchyNodeId: removable.id,
        searchAliases: ["removed alias"],
      }),
      directory,
    );
    directory.retireHierarchyNode(removable.id, {
      occupied: false,
      historicallyReferenced: false,
    });
    expect(map.search("removed alias", directory)).toEqual([]);
    expectDomainCode(() => map.search("", directory), "InvalidOperation");
    expectDomainCode(() => map.search("x".repeat(101), directory), "InvalidOperation");
    expectDomainCode(() => map.search("x".repeat(201), directory), "InvalidOperation");
  });
});

describe("map rehydration and hierarchy consistency", () => {
  it("round-trips a valid map and rejects malformed identity and archive state", () => {
    const { directory, map } = blankMap();
    map.addRegion(regionInput(), directory);
    expect(BuildingMap.rehydrate(map.snapshot(), directory).snapshot()).toEqual(map.snapshot());
    expectDomainCode(
      () =>
        BuildingMap.rehydrate(
          { ...map.snapshot(), id: "bad" as BuildingMapSnapshot["id"] },
          directory,
        ),
      "InvalidMapLink",
    );
    expectDomainCode(
      () => BuildingMap.rehydrate({ ...map.snapshot(), status: "Archived" }, directory),
      "InvalidMapLink",
    );
    expectDomainCode(
      () =>
        BuildingMap.rehydrate(
          {
            ...map.snapshot(),
            regions: [...map.snapshot().regions, map.snapshot().regions[0]!],
          },
          directory,
        ),
      "DuplicateEntity",
    );
  });

  it("rejects orphaned, cyclic, and invalid active/archived region trees", () => {
    const { directory, map } = blankMap();
    const first = map.addRegion(regionInput(), directory);
    const second = map.addRegion(
      regionInput({
        id: regionId(2),
        displayName: createLocationName("Second"),
      }),
      directory,
    );
    const snapshot = map.snapshot();
    const alter = (id: MapRegion["id"], change: Partial<MapRegion>): readonly MapRegion[] =>
      snapshot.regions.map((region) => (region.id === id ? { ...region, ...change } : region));
    expectDomainCode(
      () =>
        BuildingMap.rehydrate(
          {
            ...snapshot,
            regions: alter(first.id, { parentRegionId: regionId(99) }),
          },
          directory,
        ),
      "Orphan",
    );
    expectDomainCode(
      () =>
        BuildingMap.rehydrate(
          {
            ...snapshot,
            regions: alter(first.id, { parentRegionId: second.id }).map((region) =>
              region.id === second.id ? { ...region, parentRegionId: first.id } : region,
            ),
          },
          directory,
        ),
      "Cycle",
    );
    expectDomainCode(
      () =>
        BuildingMap.rehydrate(
          {
            ...snapshot,
            regions: alter(first.id, { status: "Archived" }).map((region) =>
              region.id === second.id ? { ...region, parentRegionId: first.id } : region,
            ),
          },
          directory,
        ),
      "Orphan",
    );
  });

  it("archives all regions with an archived Building and rejects active regions on restore", () => {
    const directory = directoryWithBuildings();
    const map = BuildingMap.create(mapId(1), buildingOneId, { kind: "Blank" }, directory);
    map.addRegion(
      regionInput({
        hierarchyNodeId: buildingOneId,
      }),
      directory,
    );
    directory.retireHierarchyNode(buildingOneId, {
      occupied: false,
      historicallyReferenced: true,
    });
    const archived = map.archive(directory);
    expect(archived.regions.every((region) => region.status === "Archived")).toBe(true);
    expect(BuildingMap.rehydrate(archived, directory).snapshot()).toEqual(archived);
    expectDomainCode(
      () =>
        BuildingMap.rehydrate(
          {
            ...archived,
            regions: archived.regions.map((region) => ({
              ...region,
              status: "Active" as const,
            })),
          },
          directory,
        ),
      "InvalidMapLink",
    );
  });

  it("derives accessible status colour metadata with a text and icon cue", () => {
    const statuses: readonly DerivedStockStatus[] = [
      "Available",
      "LowStock",
      "OutOfStock",
      "Attention",
      "Quarantined",
      "Archived",
    ];
    for (const status of statuses) {
      const presentation = mapRegionStatusPresentation(status);
      expect(presentation).toMatchObject({
        status,
        colour: expect.stringMatching(/^#[0-9A-F]{6}$/u),
        text: expect.any(String),
        icon: expect.any(String),
      });
      expect(presentation.text.length).toBeGreaterThan(0);
      expect(presentation.icon.length).toBeGreaterThan(0);
      expect(Object.isFrozen(presentation)).toBe(true);
    }
    expectDomainCode(
      () => mapRegionStatusPresentation("Unknown" as DerivedStockStatus),
      "InvalidOperation",
    );
  });

  it("reports every cross-model consistency failure without deriving hierarchy from geometry", () => {
    const directory = populatedDirectory();
    const remote = directory.addHierarchyNode({
      id: locationId(150),
      code: createLocationCode("REMOTE-MAP"),
      name: createLocationName("Remote map region"),
      nodeKind: "Area",
      operationalKind: "Storage",
      parentId: buildingTwoId,
    });
    const archived = directory.addHierarchyNode({
      id: locationId(151),
      code: createLocationCode("ARCHIVED-MAP"),
      name: createLocationName("Archived map region"),
      nodeKind: "Area",
      operationalKind: "Storage",
      parentId: buildingOneId,
    });
    directory.retireHierarchyNode(archived.id, {
      occupied: true,
      historicallyReferenced: true,
    });
    const base = BuildingMap.create(
      mapId(1),
      buildingOneId,
      { kind: "Blank" },
      directory,
    ).snapshot();
    const geometry = createRectangleGeometry(0, 0, 0.2, 0.2);
    const rawRegion = (id: number, hierarchyNodeId: ReturnType<typeof locationId>): MapRegion => ({
      id: regionId(id),
      displayName: createLocationName(`Region ${String(id)}`),
      hierarchyNodeId,
      geometry,
      zOrder: id,
      searchAliases: [],
      status: "Active",
    });
    const maps: readonly BuildingMapSnapshot[] = [
      {
        ...base,
        regions: [
          rawRegion(1, locationId(999)),
          rawRegion(2, remote.id),
          rawRegion(3, archived.id),
        ],
      },
      { ...base, id: mapId(2), status: "Archived" },
      {
        ...base,
        id: mapId(3),
        buildingId: locationId(998),
      },
    ];
    const issues = validateHierarchyMapConsistency(directory, maps);
    expect(new Set(issues.map((issue) => issue.code))).toEqual(
      new Set([
        "ArchivedHierarchyLink",
        "CrossBuildingLink",
        "DuplicateMapForBuilding",
        "MapStatusMismatch",
        "MissingBuilding",
        "MissingHierarchyLink",
        "MissingMapForBuilding",
      ]),
    );
  });
});
