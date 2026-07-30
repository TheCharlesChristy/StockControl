import {
  LocationDirectory,
  createEngineerId,
  createJobId,
  createLocationCode,
  createLocationId,
  createLocationName,
  createMapId,
  createMapRegionId,
  type EngineerAssignmentFact,
  type LocationId,
  type MapId,
  type MapRegionId,
  type VanAssignmentAuthorization,
} from "../src/index.js";

export const locationId = (suffix: number): LocationId =>
  createLocationId(`00000000-0000-4000-8000-${suffix.toString(16).padStart(12, "0")}`);

export const mapId = (suffix: number): MapId =>
  createMapId(`10000000-0000-4000-8000-${suffix.toString(16).padStart(12, "0")}`);

export const regionId = (suffix: number): MapRegionId =>
  createMapRegionId(`20000000-0000-4000-8000-${suffix.toString(16).padStart(12, "0")}`);

export const branchId = locationId(1);
export const buildingOneId = locationId(2);
export const areaId = locationId(3);
export const aisleId = locationId(4);
export const shelfId = locationId(5);
export const binId = locationId(6);
export const customSectionId = locationId(7);
export const buildingTwoId = locationId(8);
export const vanId = locationId(9);
export const jobSiteId = locationId(10);

export const officeAuthorization: VanAssignmentAuthorization = {
  actorRole: "Office",
  hasManageVanAssignmentsPermission: true,
};

export const engineerOne = createEngineerId("engineer.one");
export const engineerTwo = createEngineerId("engineer.two");

export const engineerFact = (
  engineerId = engineerOne,
  overrides: Partial<EngineerAssignmentFact> = {},
): EngineerAssignmentFact => ({
  engineerId,
  role: "Engineer",
  active: true,
  ...overrides,
});

export const directoryWithBuildings = (): LocationDirectory => {
  const directory = LocationDirectory.create({
    id: branchId,
    code: createLocationCode("BR"),
    name: createLocationName("Main branch"),
  });
  directory.addHierarchyNode({
    id: buildingOneId,
    code: createLocationCode("BLD-1"),
    name: createLocationName("Main store"),
    nodeKind: "Building",
    operationalKind: "Container",
    parentId: branchId,
  });
  directory.addHierarchyNode({
    id: buildingTwoId,
    code: createLocationCode("BLD-2"),
    name: createLocationName("Remote store"),
    nodeKind: "Building",
    operationalKind: "Container",
    parentId: branchId,
  });
  return directory;
};

export const populatedDirectory = (): LocationDirectory => {
  const directory = directoryWithBuildings();
  directory.addHierarchyNode({
    id: areaId,
    code: createLocationCode("AREA-1"),
    name: createLocationName("Ground floor"),
    nodeKind: "Area",
    operationalKind: "Storage",
    parentId: buildingOneId,
    generalFulfilmentEnabled: true,
  });
  directory.addHierarchyNode({
    id: aisleId,
    code: createLocationCode("AISLE-1"),
    name: createLocationName("Aisle one"),
    nodeKind: "Aisle",
    operationalKind: "Storage",
    parentId: areaId,
  });
  directory.addHierarchyNode({
    id: shelfId,
    code: createLocationCode("SHELF-1"),
    name: createLocationName("Top shelf"),
    nodeKind: "Shelf",
    operationalKind: "Storage",
    parentId: aisleId,
  });
  directory.addHierarchyNode({
    id: binId,
    code: createLocationCode("BIN-1"),
    name: createLocationName("Fasteners"),
    nodeKind: "Bin",
    operationalKind: "Storage",
    parentId: shelfId,
  });
  directory.addHierarchyNode({
    id: customSectionId,
    code: createLocationCode("CAGE-1"),
    name: createLocationName("Secure cage"),
    nodeKind: "CustomSection",
    operationalKind: "Quarantine",
    parentId: areaId,
  });
  return directory;
};

export const addVanAndJobSite = (directory: LocationDirectory): void => {
  directory.addVan(
    {
      id: vanId,
      code: createLocationCode("VAN-1"),
      name: createLocationName("Van one"),
      assignments: [engineerFact(), engineerFact(engineerTwo)],
      primaryEngineerId: engineerOne,
    },
    officeAuthorization,
  );
  directory.addVirtualJobSite({
    id: jobSiteId,
    code: createLocationCode("JOB-SITE-1"),
    name: createLocationName("Job site one"),
    jobId: createJobId("job.1"),
  });
};
