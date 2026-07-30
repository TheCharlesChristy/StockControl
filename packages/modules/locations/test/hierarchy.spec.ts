import { describe, expect, it } from "vitest";

import {
  LocationDirectory,
  LocationDomainError,
  createLocationCode,
  createLocationName,
  type HierarchyLocationNode,
  type LocationDirectorySnapshot,
} from "../src/index.js";
import {
  areaId,
  aisleId,
  binId,
  branchId,
  buildingOneId,
  buildingTwoId,
  customSectionId,
  directoryWithBuildings,
  locationId,
  populatedDirectory,
  shelfId,
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

describe("authoritative physical hierarchy", () => {
  it("creates exactly one branch and supports multiple buildings and arbitrary section depth", () => {
    const directory = populatedDirectory();
    const snapshot = directory.snapshot();

    expect(directory.branchId).toBe(branchId);
    expect(snapshot.hierarchyNodes.filter((node) => node.nodeKind === "Branch")).toHaveLength(1);
    expect(snapshot.hierarchyNodes.filter((node) => node.nodeKind === "Building")).toHaveLength(2);
    expect(directory.getHierarchyNode(binId)).toMatchObject({
      branchId,
      buildingId: buildingOneId,
      parentId: shelfId,
      nodeKind: "Bin",
      operationalKind: "Storage",
    });
    expect(directory.getHierarchyNode(customSectionId)).toMatchObject({
      parentId: areaId,
      operationalKind: "Quarantine",
    });

    const deepCustom = directory.addHierarchyNode({
      id: locationId(11),
      code: createLocationCode("CAGE-1.1"),
      name: createLocationName("Cage subsection"),
      nodeKind: "CustomSection",
      operationalKind: "Repair",
      parentId: customSectionId,
    });
    expect(deepCustom.buildingId).toBe(buildingOneId);

    const copy = directory.getHierarchyNode(areaId)!;
    (copy as { name: string }).name = "tampered";
    expect(directory.getHierarchyNode(areaId)!.name).toBe("Ground floor");
    expect(directory.getHierarchyNode(locationId(99))).toBeUndefined();
  });

  it("enforces Branch, Building, spatial parent, leaf, and fulfilment-kind rules", () => {
    const directory = directoryWithBuildings();
    expectDomainCode(
      () =>
        directory.addHierarchyNode({
          id: locationId(20),
          code: createLocationCode("BAD-BLD"),
          name: createLocationName("Bad building"),
          nodeKind: "Building",
          operationalKind: "Storage",
          parentId: branchId,
        }),
      "InvalidParent",
    );
    expectDomainCode(
      () =>
        directory.addHierarchyNode({
          id: locationId(21),
          code: createLocationCode("ORPHAN-AREA"),
          name: createLocationName("No building"),
          nodeKind: "Area",
          operationalKind: "Storage",
          parentId: branchId,
        }),
      "InvalidParent",
    );
    directory.addHierarchyNode({
      id: binId,
      code: createLocationCode("BIN-X"),
      name: createLocationName("Leaf bin"),
      nodeKind: "Bin",
      operationalKind: "Storage",
      parentId: buildingOneId,
    });
    expectDomainCode(
      () =>
        directory.addHierarchyNode({
          id: locationId(22),
          code: createLocationCode("UNDER-BIN"),
          name: createLocationName("Under bin"),
          nodeKind: "Shelf",
          operationalKind: "Storage",
          parentId: binId,
        }),
      "InvalidParent",
    );
    expectDomainCode(
      () =>
        directory.addHierarchyNode({
          id: locationId(23),
          code: createLocationCode("CONTAINER-AREA"),
          name: createLocationName("Illegal container"),
          nodeKind: "Area",
          operationalKind: "Container",
          parentId: buildingOneId,
        }),
      "InvalidParent",
    );
    expectDomainCode(
      () =>
        directory.addHierarchyNode({
          id: locationId(24),
          code: createLocationCode("FAST-Q"),
          name: createLocationName("Bad fulfilment"),
          nodeKind: "Area",
          operationalKind: "Quarantine",
          parentId: buildingOneId,
          generalFulfilmentEnabled: true,
        }),
      "InvalidOperation",
    );
    expectDomainCode(
      () =>
        directory.addHierarchyNode({
          id: locationId(25),
          code: createLocationCode("MISSING"),
          name: createLocationName("Missing parent"),
          nodeKind: "Area",
          operationalKind: "Storage",
          parentId: locationId(999),
        }),
      "MissingEntity",
    );
  });

  it("renames locations without changing identity or stable code", () => {
    const directory = populatedDirectory();
    const before = directory.getHierarchyNode(areaId)!;
    const changed = directory.renameLocation(areaId, createLocationName("New floor name"));

    expect(changed).toMatchObject({
      id: before.id,
      code: before.code,
      name: "New floor name",
    });
    expect(directory.renameLocation(branchId, createLocationName("Renamed branch")).name).toBe(
      "Renamed branch",
    );
    expectDomainCode(
      () => directory.renameLocation(locationId(999), createLocationName("Missing")),
      "MissingEntity",
    );
  });

  it("moves within one building while rejecting cycles and ownership changes", () => {
    const directory = populatedDirectory();
    const alternativeParent = directory.addHierarchyNode({
      id: locationId(30),
      code: createLocationCode("AREA-ALT"),
      name: createLocationName("Alternative area"),
      nodeKind: "Area",
      operationalKind: "Storage",
      parentId: buildingOneId,
    });
    expect(directory.moveHierarchyNode(aisleId, alternativeParent.id).parentId).toBe(
      alternativeParent.id,
    );
    expectDomainCode(() => directory.moveHierarchyNode(aisleId, alternativeParent.id), "NoChange");
    expectDomainCode(() => directory.moveHierarchyNode(alternativeParent.id, shelfId), "Cycle");
    expectDomainCode(() => directory.moveHierarchyNode(areaId, binId), "InvalidParent");
    expectDomainCode(() => directory.moveHierarchyNode(areaId, branchId), "InvalidParent");
    expectDomainCode(
      () => directory.moveHierarchyNode(areaId, buildingTwoId),
      "CrossBuildingParent",
    );
    expectDomainCode(
      () => directory.moveHierarchyNode(buildingOneId, branchId),
      "InvalidOperation",
    );
    expectDomainCode(
      () => directory.moveHierarchyNode(branchId, buildingOneId),
      "InvalidOperation",
    );
    expectDomainCode(() => directory.moveHierarchyNode(locationId(999), areaId), "MissingEntity");
  });

  it("archives referenced or occupied locations, removes only unused leaves, and never reuses codes", () => {
    const directory = directoryWithBuildings();
    const unused = directory.addHierarchyNode({
      id: locationId(40),
      code: createLocationCode("TEMP"),
      name: createLocationName("Temporary"),
      nodeKind: "Area",
      operationalKind: "Storage",
      parentId: buildingOneId,
    });
    expect(
      directory.retireHierarchyNode(unused.id, {
        occupied: false,
        historicallyReferenced: false,
      }),
    ).toBe("Removed");
    expect(directory.getHierarchyNode(unused.id)).toBeUndefined();
    expectDomainCode(
      () =>
        directory.addHierarchyNode({
          id: locationId(41),
          code: unused.code,
          name: createLocationName("Code reuse"),
          nodeKind: "Area",
          operationalKind: "Storage",
          parentId: buildingOneId,
        }),
      "CodeAlreadyUsed",
    );

    const occupied = directory.addHierarchyNode({
      id: locationId(42),
      code: createLocationCode("OCCUPIED"),
      name: createLocationName("Occupied"),
      nodeKind: "Area",
      operationalKind: "Storage",
      parentId: buildingOneId,
      generalFulfilmentEnabled: true,
    });
    expect(
      directory.retireHierarchyNode(occupied.id, {
        occupied: true,
        historicallyReferenced: false,
      }),
    ).toBe("Archived");
    expect(directory.getHierarchyNode(occupied.id)).toMatchObject({
      status: "Archived",
      generalFulfilmentEnabled: false,
    });
    expectDomainCode(
      () => directory.renameLocation(occupied.id, createLocationName("Cannot rename")),
      "ArchivedEntity",
    );
    expectDomainCode(
      () =>
        directory.retireHierarchyNode(occupied.id, {
          occupied: false,
          historicallyReferenced: false,
        }),
      "ArchivedEntity",
    );

    const historical = directory.addHierarchyNode({
      id: locationId(43),
      code: createLocationCode("HISTORY"),
      name: createLocationName("Historical"),
      nodeKind: "Area",
      operationalKind: "Storage",
      parentId: buildingOneId,
    });
    expect(
      directory.retireHierarchyNode(historical.id, {
        occupied: false,
        historicallyReferenced: true,
      }),
    ).toBe("Archived");
    expectDomainCode(
      () =>
        directory.retireHierarchyNode(branchId, {
          occupied: false,
          historicallyReferenced: true,
        }),
      "InvalidOperation",
    );
  });

  it("prevents orphaning descendants and retains archived parent chains", () => {
    const directory = populatedDirectory();
    expectDomainCode(
      () =>
        directory.retireHierarchyNode(areaId, {
          occupied: true,
          historicallyReferenced: true,
        }),
      "Orphan",
    );
    for (const id of [binId, shelfId, aisleId, customSectionId]) {
      directory.retireHierarchyNode(id, {
        occupied: false,
        historicallyReferenced: true,
      });
    }
    expect(
      directory.retireHierarchyNode(areaId, {
        occupied: false,
        historicallyReferenced: false,
      }),
    ).toBe("Archived");
  });

  it("allows explicit fulfilment configuration only on active Storage nodes", () => {
    const directory = populatedDirectory();
    expect(directory.setGeneralFulfilment(aisleId, true).generalFulfilmentEnabled).toBe(true);
    expectDomainCode(() => directory.setGeneralFulfilment(aisleId, true), "NoChange");
    expect(directory.setGeneralFulfilment(aisleId, false).generalFulfilmentEnabled).toBe(false);
    expectDomainCode(
      () => directory.setGeneralFulfilment(customSectionId, true),
      "InvalidOperation",
    );
    directory.retireHierarchyNode(binId, {
      occupied: true,
      historicallyReferenced: true,
    });
    expectDomainCode(() => directory.setGeneralFulfilment(binId, true), "ArchivedEntity");
  });
});

describe("hierarchy snapshot validation", () => {
  const rehydrateWith = (
    mutate: (snapshot: LocationDirectorySnapshot) => LocationDirectorySnapshot,
  ): void => {
    const snapshot = populatedDirectory().snapshot();
    LocationDirectory.rehydrate(mutate(snapshot));
  };

  it("round-trips a valid snapshot and preserves the retired-code ledger", () => {
    const directory = directoryWithBuildings();
    const retired = directory.addHierarchyNode({
      id: locationId(50),
      code: createLocationCode("RETIRED-CODE"),
      name: createLocationName("Retired"),
      nodeKind: "Area",
      operationalKind: "Storage",
      parentId: buildingOneId,
    });
    directory.retireHierarchyNode(retired.id, {
      occupied: false,
      historicallyReferenced: false,
    });
    const restored = LocationDirectory.rehydrate(directory.snapshot());
    expect(restored.snapshot()).toEqual(directory.snapshot());
    expectDomainCode(
      () =>
        restored.addHierarchyNode({
          id: locationId(51),
          code: retired.code,
          name: createLocationName("Reuse"),
          nodeKind: "Area",
          operationalKind: "Storage",
          parentId: buildingOneId,
        }),
      "CodeAlreadyUsed",
    );
  });

  it("rejects zero or multiple Branch roots and malformed Branch state", () => {
    expectDomainCode(
      () =>
        rehydrateWith((snapshot) => ({
          ...snapshot,
          hierarchyNodes: snapshot.hierarchyNodes.filter((node) => node.nodeKind !== "Branch"),
        })),
      "InvalidHierarchy",
    );
    expectDomainCode(
      () =>
        rehydrateWith((snapshot) => ({
          ...snapshot,
          hierarchyNodes: [
            ...snapshot.hierarchyNodes,
            {
              ...snapshot.hierarchyNodes[0]!,
              id: locationId(60),
              code: createLocationCode("BR-2"),
              branchId: locationId(60),
            },
          ],
          usedCodes: [...snapshot.usedCodes, createLocationCode("BR-2")],
        })),
      "InvalidHierarchy",
    );
    expectDomainCode(
      () =>
        rehydrateWith((snapshot) => ({
          ...snapshot,
          hierarchyNodes: snapshot.hierarchyNodes.map((node) =>
            node.nodeKind === "Branch" ? { ...node, status: "Archived" as const } : node,
          ),
        })),
      "InvalidHierarchy",
    );
  });

  it("rejects duplicate identities, duplicate codes, and incomplete code history", () => {
    expectDomainCode(
      () =>
        rehydrateWith((snapshot) => ({
          ...snapshot,
          hierarchyNodes: [
            ...snapshot.hierarchyNodes,
            { ...snapshot.hierarchyNodes[2]!, code: createLocationCode("DUP-ID") },
          ],
          usedCodes: [...snapshot.usedCodes, createLocationCode("DUP-ID")],
        })),
      "DuplicateEntity",
    );
    expectDomainCode(
      () =>
        rehydrateWith((snapshot) => ({
          ...snapshot,
          hierarchyNodes: snapshot.hierarchyNodes.map((node) =>
            node.id === areaId ? { ...node, code: createLocationCode("BLD-1") } : node,
          ),
        })),
      "CodeAlreadyUsed",
    );
    expectDomainCode(
      () =>
        rehydrateWith((snapshot) => ({
          ...snapshot,
          usedCodes: snapshot.usedCodes.filter((code) => code !== createLocationCode("AREA-1")),
        })),
      "InvalidHierarchy",
    );
    expectDomainCode(
      () =>
        rehydrateWith((snapshot) => ({
          ...snapshot,
          usedCodes: [...snapshot.usedCodes, snapshot.usedCodes[0]!],
        })),
      "InvalidHierarchy",
    );
    expectDomainCode(
      () =>
        rehydrateWith((snapshot) => ({
          ...snapshot,
          usedCodes: [
            ...snapshot.usedCodes,
            " noncanonical " as (typeof snapshot.usedCodes)[number],
          ],
        })),
      "InvalidHierarchy",
    );
  });

  it("rejects orphans, cycles, cross-branch parenting, and illegal Building ownership", () => {
    const replace = (
      snapshot: LocationDirectorySnapshot,
      id: string,
      change: Partial<HierarchyLocationNode>,
    ): LocationDirectorySnapshot => ({
      ...snapshot,
      hierarchyNodes: snapshot.hierarchyNodes.map((node) =>
        node.id === id ? { ...node, ...change } : node,
      ),
    });
    expectDomainCode(
      () => rehydrateWith((snapshot) => replace(snapshot, areaId, { parentId: locationId(999) })),
      "Orphan",
    );
    expectDomainCode(
      () =>
        rehydrateWith((snapshot) => {
          let changed = replace(snapshot, areaId, { parentId: aisleId });
          changed = replace(changed, aisleId, { parentId: areaId });
          return changed;
        }),
      "Cycle",
    );
    expectDomainCode(
      () => rehydrateWith((snapshot) => replace(snapshot, areaId, { branchId: locationId(777) })),
      "CrossBranchParent",
    );
    expectDomainCode(
      () =>
        rehydrateWith((snapshot) =>
          replace(snapshot, buildingOneId, { buildingId: buildingTwoId }),
        ),
      "IllegalBuildingOwnership",
    );
    expectDomainCode(
      () => rehydrateWith((snapshot) => replace(snapshot, areaId, { buildingId: buildingTwoId })),
      "IllegalBuildingOwnership",
    );
    expectDomainCode(
      () =>
        rehydrateWith((snapshot) => replace(snapshot, areaId, { operationalKind: "Container" })),
      "InvalidParent",
    );
  });

  it("rejects active descendants beneath archived parents and malformed records", () => {
    expectDomainCode(
      () =>
        rehydrateWith((snapshot) => ({
          ...snapshot,
          hierarchyNodes: snapshot.hierarchyNodes.map((node) =>
            node.id === areaId ? { ...node, status: "Archived" as const } : node,
          ),
        })),
      "Orphan",
    );
    expectDomainCode(
      () =>
        rehydrateWith((snapshot) => ({
          ...snapshot,
          hierarchyNodes: snapshot.hierarchyNodes.map((node) =>
            node.id === areaId
              ? { ...node, name: " noncanonical " as HierarchyLocationNode["name"] }
              : node,
          ),
        })),
      "InvalidHierarchy",
    );
    expectDomainCode(
      () =>
        rehydrateWith((snapshot) => ({
          ...snapshot,
          hierarchyNodes: snapshot.hierarchyNodes.map((node) =>
            node.id === customSectionId ? { ...node, generalFulfilmentEnabled: true } : node,
          ),
        })),
      "InvalidHierarchy",
    );
  });
});
