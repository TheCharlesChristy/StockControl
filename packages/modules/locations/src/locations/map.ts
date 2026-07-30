import type { LocationDirectory, HierarchyLocationNode } from "./directory.js";
import { failLocation, LocationDomainError } from "./errors.js";
import {
  copyGeometry,
  type MapGeometry,
  type NormalizedPoint,
  createPolygonGeometry,
  createRectangleGeometry,
} from "./geometry.js";
import {
  createDocumentId,
  createLocationId,
  createLocationName,
  createMapId,
  createMapRegionId,
  type DocumentId,
  type LocationId,
  type LocationName,
  type MapId,
  type MapRegionId,
} from "./value-objects.js";

export interface BlankMapBackground {
  readonly kind: "Blank";
}

export interface FloorPlanMapBackground {
  readonly kind: "FloorPlan";
  readonly documentId: DocumentId;
  readonly originalFileName: string;
  readonly mediaType: "image/png" | "image/jpeg" | "application/pdf";
  readonly pixelWidth?: number;
  readonly pixelHeight?: number;
}

export type MapBackground = BlankMapBackground | FloorPlanMapBackground;
export type MapStatus = "Active" | "Archived";
export type MapRegionStatus = "Active" | "Archived";

export interface MapRegion {
  readonly id: MapRegionId;
  readonly displayName: LocationName;
  readonly hierarchyNodeId: LocationId;
  readonly parentRegionId?: MapRegionId;
  readonly geometry: MapGeometry;
  readonly zOrder: number;
  readonly searchAliases: readonly string[];
  readonly status: MapRegionStatus;
}

export interface BuildingMapSnapshot {
  readonly id: MapId;
  readonly buildingId: LocationId;
  readonly background: MapBackground;
  readonly status: MapStatus;
  readonly regions: readonly MapRegion[];
}

export interface AddMapRegion {
  readonly id: MapRegionId;
  readonly displayName: LocationName;
  readonly hierarchyNodeId: LocationId;
  readonly parentRegionId?: MapRegionId;
  readonly geometry: MapGeometry;
  readonly zOrder: number;
  readonly searchAliases?: readonly string[];
}

export interface UpdateMapRegion {
  readonly displayName?: LocationName;
  readonly geometry?: MapGeometry;
  readonly zOrder?: number;
  readonly searchAliases?: readonly string[];
}

export type DerivedStockStatus =
  "Available" | "LowStock" | "OutOfStock" | "Attention" | "Quarantined" | "Archived";

export interface MapRegionStatusPresentation {
  readonly status: DerivedStockStatus;
  readonly colour: `#${string}`;
  readonly text: string;
  readonly icon: string;
}

export type HierarchyMapConsistencyIssueCode =
  | "ArchivedHierarchyLink"
  | "CrossBuildingLink"
  | "DuplicateMapForBuilding"
  | "MapStatusMismatch"
  | "MissingBuilding"
  | "MissingHierarchyLink"
  | "MissingMapForBuilding";

export interface HierarchyMapConsistencyIssue {
  readonly code: HierarchyMapConsistencyIssueCode;
  readonly mapId?: MapId;
  readonly regionId?: MapRegionId;
  readonly buildingId: LocationId;
}

const MAX_FILE_NAME_LENGTH = 240;
const MAX_IMAGE_DIMENSION = 100_000;
const MAX_SEARCH_ALIASES = 20;
const MAX_Z_ORDER = 100_000;

const containsUnsafeFileNameCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return character === "/" || character === "\\" || code <= 0x1f || code === 0x7f;
  });

const containsControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });

const isFloorPlanMediaType = (value: string): value is FloorPlanMapBackground["mediaType"] =>
  value === "image/png" || value === "image/jpeg" || value === "application/pdf";

const isMapStatus = (value: string): value is MapStatus =>
  value === "Active" || value === "Archived";

const isMapRegionStatus = (value: string): value is MapRegionStatus =>
  value === "Active" || value === "Archived";

const copyBackground = (background: MapBackground): MapBackground => {
  if (background.kind === "Blank") {
    return Object.freeze({ kind: "Blank" });
  }
  try {
    if (
      createDocumentId(background.documentId) !== background.documentId ||
      background.originalFileName.length < 1 ||
      background.originalFileName.length > MAX_FILE_NAME_LENGTH ||
      background.originalFileName.trim() !== background.originalFileName ||
      containsUnsafeFileNameCharacter(background.originalFileName) ||
      !isFloorPlanMediaType(background.mediaType)
    ) {
      failLocation("InvalidBackground", "Floor-plan metadata is invalid.");
    }
    const dimensionsProvided =
      background.pixelWidth !== undefined || background.pixelHeight !== undefined;
    if (
      dimensionsProvided &&
      (background.pixelWidth === undefined ||
        background.pixelHeight === undefined ||
        !Number.isSafeInteger(background.pixelWidth) ||
        !Number.isSafeInteger(background.pixelHeight) ||
        background.pixelWidth < 1 ||
        background.pixelHeight < 1 ||
        background.pixelWidth > MAX_IMAGE_DIMENSION ||
        background.pixelHeight > MAX_IMAGE_DIMENSION)
    ) {
      failLocation(
        "InvalidBackground",
        "Floor-plan pixel dimensions must be a complete positive integer pair.",
      );
    }
    return Object.freeze({ ...background });
  } catch (error) {
    if (error instanceof LocationDomainError) {
      throw error;
    }
    failLocation("InvalidBackground", "Floor-plan metadata is invalid.");
  }
};

const zOrder = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < -MAX_Z_ORDER || value > MAX_Z_ORDER) {
    failLocation("InvalidOperation", "Map region z-order must be a bounded safe integer.");
  }
  return value;
};

const normalizeSearchAliases = (values: readonly string[]): readonly string[] => {
  if (values.length > MAX_SEARCH_ALIASES) {
    failLocation(
      "InvalidOperation",
      `A map region supports at most ${MAX_SEARCH_ALIASES} aliases.`,
    );
  }
  const aliases = values.map((value) => {
    if (value.length > 160 || containsControlCharacter(value)) {
      failLocation("InvalidOperation", "Map search aliases must contain 1-80 characters.");
    }
    const normalized = value.trim().replaceAll(/\s+/gu, " ");
    if (normalized.length < 1 || normalized.length > 80) {
      failLocation("InvalidOperation", "Map search aliases must contain 1-80 characters.");
    }
    return normalized;
  });
  const folded = aliases.map((alias) => alias.toLocaleLowerCase("en-GB"));
  if (new Set(folded).size !== folded.length) {
    failLocation("InvalidOperation", "Map search aliases must be unique.");
  }
  return Object.freeze(aliases);
};

const linkedNode = (
  directory: LocationDirectory,
  hierarchyNodeId: LocationId,
  buildingId: LocationId,
  allowArchived: boolean,
): HierarchyLocationNode => {
  const node = directory.getHierarchyNode(hierarchyNodeId);
  if (node === undefined || node.nodeKind === "Branch") {
    failLocation("InvalidMapLink", "A map region must link to a hierarchy node.");
  }
  const linkedBuildingId = node.nodeKind === "Building" ? node.id : node.buildingId;
  if (linkedBuildingId !== buildingId) {
    failLocation(
      "InvalidMapLink",
      "A map region can link only to a hierarchy node in the same Building.",
    );
  }
  if (!allowArchived && node.status !== "Active") {
    failLocation("InvalidMapLink", "An active map region cannot link to an archived location.");
  }
  return node;
};

const copyRegion = (region: MapRegion): MapRegion => ({
  ...region,
  geometry: copyGeometry(region.geometry),
  searchAliases: [...region.searchAliases],
});

const canonicalRegion = (
  region: MapRegion,
  buildingId: LocationId,
  directory: LocationDirectory,
): MapRegion => {
  try {
    if (
      createMapRegionId(region.id) !== region.id ||
      createLocationName(region.displayName) !== region.displayName ||
      createLocationId(region.hierarchyNodeId) !== region.hierarchyNodeId ||
      (region.parentRegionId !== undefined &&
        createMapRegionId(region.parentRegionId) !== region.parentRegionId) ||
      !isMapRegionStatus(region.status)
    ) {
      failLocation("InvalidMapLink", "Map contains a malformed region.");
    }
    linkedNode(directory, region.hierarchyNodeId, buildingId, region.status === "Archived");
    return {
      ...region,
      geometry: copyGeometry(region.geometry),
      zOrder: zOrder(region.zOrder),
      searchAliases: normalizeSearchAliases(region.searchAliases),
    };
  } catch (error) {
    if (error instanceof LocationDomainError) {
      throw error;
    }
    failLocation("InvalidMapLink", "Map contains a malformed region.");
  }
};

const assertBuilding = (
  directory: LocationDirectory,
  buildingId: LocationId,
): HierarchyLocationNode => {
  const building = directory.getHierarchyNode(buildingId);
  if (building === undefined || building.nodeKind !== "Building") {
    failLocation("InvalidMapLink", "A Building map must belong to a Building hierarchy node.");
  }
  return building;
};

export class BuildingMap {
  readonly #id: MapId;
  readonly #buildingId: LocationId;
  #background: MapBackground;
  #status: MapStatus;
  readonly #regions: Map<MapRegionId, MapRegion>;

  private constructor(snapshot: BuildingMapSnapshot, directory: LocationDirectory) {
    try {
      if (
        createMapId(snapshot.id) !== snapshot.id ||
        createLocationId(snapshot.buildingId) !== snapshot.buildingId ||
        !isMapStatus(snapshot.status)
      ) {
        failLocation("InvalidMapLink", "Building map identity or status is invalid.");
      }
    } catch (error) {
      if (error instanceof LocationDomainError) {
        throw error;
      }
      failLocation("InvalidMapLink", "Building map identity or status is invalid.");
    }
    const building = assertBuilding(directory, snapshot.buildingId);
    if (
      (snapshot.status === "Active" && building.status !== "Active") ||
      (snapshot.status === "Archived" && building.status !== "Archived")
    ) {
      failLocation("InvalidMapLink", "Building and map archive states must agree.");
    }
    const regions = snapshot.regions.map((region) =>
      canonicalRegion(region, snapshot.buildingId, directory),
    );
    if (new Set(regions.map((region) => region.id)).size !== regions.length) {
      failLocation("DuplicateEntity", "Map region identities must be unique.");
    }
    this.assertRegionTree(regions, snapshot.status);
    this.#id = snapshot.id;
    this.#buildingId = snapshot.buildingId;
    this.#background = copyBackground(snapshot.background);
    this.#status = snapshot.status;
    this.#regions = new Map(regions.map((region) => [region.id, region]));
  }

  public static create(
    id: MapId,
    buildingId: LocationId,
    background: MapBackground,
    directory: LocationDirectory,
  ): BuildingMap {
    const building = assertBuilding(directory, buildingId);
    if (building.status !== "Active") {
      failLocation("ArchivedEntity", "An archived Building cannot receive a new active map.");
    }
    return new BuildingMap(
      { id, buildingId, background, status: "Active", regions: [] },
      directory,
    );
  }

  public static rehydrate(
    snapshot: BuildingMapSnapshot,
    directory: LocationDirectory,
  ): BuildingMap {
    return new BuildingMap(snapshot, directory);
  }

  public get id(): MapId {
    return this.#id;
  }

  public get buildingId(): LocationId {
    return this.#buildingId;
  }

  public get status(): MapStatus {
    return this.#status;
  }

  public snapshot(): BuildingMapSnapshot {
    return {
      id: this.#id,
      buildingId: this.#buildingId,
      background: copyBackground(this.#background),
      status: this.#status,
      regions: [...this.#regions.values()].map(copyRegion),
    };
  }

  public getRegion(id: MapRegionId): MapRegion | undefined {
    const region = this.#regions.get(id);
    return region === undefined ? undefined : copyRegion(region);
  }

  public setBackground(background: MapBackground): MapBackground {
    this.assertActive();
    const changed = copyBackground(background);
    this.#background = changed;
    return copyBackground(changed);
  }

  public addRegion(input: AddMapRegion, directory: LocationDirectory): MapRegion {
    this.assertActive();
    if (this.#regions.has(input.id)) {
      failLocation("DuplicateEntity", "Map region identity is already in use.");
    }
    linkedNode(directory, input.hierarchyNodeId, this.#buildingId, false);
    if (input.parentRegionId !== undefined) {
      const parent = this.#regions.get(input.parentRegionId);
      if (parent === undefined || parent.status !== "Active") {
        failLocation("Orphan", "A nested map region requires an active parent region.");
      }
    }
    const region: MapRegion = {
      id: input.id,
      displayName: input.displayName,
      hierarchyNodeId: input.hierarchyNodeId,
      ...(input.parentRegionId === undefined ? {} : { parentRegionId: input.parentRegionId }),
      geometry: copyGeometry(input.geometry),
      zOrder: zOrder(input.zOrder),
      searchAliases: normalizeSearchAliases(input.searchAliases ?? []),
      status: "Active",
    };
    canonicalRegion(region, this.#buildingId, directory);
    this.#regions.set(region.id, region);
    return copyRegion(region);
  }

  public updateRegion(id: MapRegionId, update: UpdateMapRegion): MapRegion {
    this.assertActive();
    const region = this.requiredActiveRegion(id);
    let displayName = region.displayName;
    if (update.displayName !== undefined) {
      try {
        displayName = createLocationName(update.displayName);
        if (displayName !== update.displayName) {
          failLocation("InvalidOperation", "Map region display name must be canonical.");
        }
      } catch (error) {
        if (error instanceof LocationDomainError) {
          throw error;
        }
        failLocation("InvalidOperation", "Map region display name must be canonical.");
      }
    }
    const changed: MapRegion = {
      ...region,
      displayName,
      geometry: update.geometry === undefined ? region.geometry : copyGeometry(update.geometry),
      zOrder: update.zOrder === undefined ? region.zOrder : zOrder(update.zOrder),
      searchAliases:
        update.searchAliases === undefined
          ? region.searchAliases
          : normalizeSearchAliases(update.searchAliases),
    };
    this.#regions.set(id, changed);
    return copyRegion(changed);
  }

  public nestRegion(id: MapRegionId, parentRegionId?: MapRegionId): MapRegion {
    this.assertActive();
    const region = this.requiredActiveRegion(id);
    if (parentRegionId === region.parentRegionId) {
      failLocation("NoChange", "Map region nesting is unchanged.");
    }
    if (parentRegionId !== undefined) {
      const parent = this.requiredActiveRegion(parentRegionId);
      if (parent.id === region.id || this.isRegionDescendant(parent.id, region.id)) {
        failLocation("Cycle", "Map region nesting cannot contain a cycle.");
      }
    }
    const withoutParent: Omit<MapRegion, "parentRegionId"> = {
      id: region.id,
      displayName: region.displayName,
      hierarchyNodeId: region.hierarchyNodeId,
      geometry: region.geometry,
      zOrder: region.zOrder,
      searchAliases: region.searchAliases,
      status: region.status,
    };
    const changed: MapRegion =
      parentRegionId === undefined ? withoutParent : { ...withoutParent, parentRegionId };
    this.#regions.set(id, changed);
    return copyRegion(changed);
  }

  public archiveRegion(id: MapRegionId): MapRegion {
    this.assertActive();
    const region = this.requiredActiveRegion(id);
    if (
      [...this.#regions.values()].some(
        (candidate) => candidate.parentRegionId === id && candidate.status === "Active",
      )
    ) {
      failLocation("Orphan", "Archive every active nested region before its parent.");
    }
    const changed: MapRegion = { ...region, status: "Archived" };
    this.#regions.set(id, changed);
    return copyRegion(changed);
  }

  public archive(directory: LocationDirectory): BuildingMapSnapshot {
    this.assertActive();
    const building = assertBuilding(directory, this.#buildingId);
    if (building.status !== "Archived") {
      failLocation("InvalidMapLink", "A map can be archived only with its archived Building.");
    }
    this.#status = "Archived";
    for (const [id, region] of this.#regions) {
      this.#regions.set(id, { ...region, status: "Archived" });
    }
    return this.snapshot();
  }

  public search(query: string, directory: LocationDirectory): readonly MapRegion[] {
    if (query.length > 200) {
      failLocation("InvalidOperation", "Map search query must contain 1-100 characters.");
    }
    const normalized = query.trim().replaceAll(/\s+/gu, " ").toLocaleLowerCase("en-GB");
    if (normalized.length < 1 || normalized.length > 100) {
      failLocation("InvalidOperation", "Map search query must contain 1-100 characters.");
    }
    return [...this.#regions.values()]
      .filter((region) => {
        if (region.status !== "Active") {
          return false;
        }
        const node = directory.getHierarchyNode(region.hierarchyNodeId);
        if (node === undefined) {
          return false;
        }
        return [region.displayName, node.name, node.code, ...region.searchAliases].some(
          (candidate) => candidate.toLocaleLowerCase("en-GB").includes(normalized),
        );
      })
      .sort(
        (left, right) =>
          left.zOrder - right.zOrder ||
          left.displayName.localeCompare(right.displayName, "en-GB") ||
          left.id.localeCompare(right.id),
      )
      .map(copyRegion);
  }

  private assertRegionTree(regions: readonly MapRegion[], mapStatus: MapStatus): void {
    const byId = new Map(regions.map((region) => [region.id, region]));
    for (const region of regions) {
      if (mapStatus === "Archived" && region.status !== "Archived") {
        failLocation("InvalidMapLink", "An archived map cannot contain an active region.");
      }
      if (region.parentRegionId === undefined) {
        continue;
      }
      const parent = byId.get(region.parentRegionId);
      if (parent === undefined) {
        failLocation("Orphan", "Nested map region parent does not exist.");
      }
      if (region.status === "Active" && parent.status === "Archived") {
        failLocation("Orphan", "An active map region cannot have an archived parent.");
      }
      const visited = new Set<MapRegionId>([region.id]);
      let cursor: MapRegion | undefined = parent;
      while (cursor !== undefined) {
        if (visited.has(cursor.id)) {
          failLocation("Cycle", "Map region nesting contains a cycle.");
        }
        visited.add(cursor.id);
        cursor = cursor.parentRegionId === undefined ? undefined : byId.get(cursor.parentRegionId);
      }
    }
  }

  private requiredActiveRegion(id: MapRegionId): MapRegion {
    const region = this.#regions.get(id);
    if (region === undefined) {
      failLocation("MissingEntity", "Map region does not exist.");
    }
    if (region.status !== "Active") {
      failLocation("ArchivedEntity", "Archived map regions cannot be changed.");
    }
    return region;
  }

  private isRegionDescendant(candidateId: MapRegionId, ancestorId: MapRegionId): boolean {
    let cursor = this.#regions.get(candidateId);
    const visited = new Set<MapRegionId>();
    while (cursor?.parentRegionId !== undefined) {
      if (visited.has(cursor.id)) {
        failLocation("Cycle", "Map contains a pre-existing region cycle.");
      }
      visited.add(cursor.id);
      if (cursor.parentRegionId === ancestorId) {
        return true;
      }
      cursor = this.#regions.get(cursor.parentRegionId);
    }
    return false;
  }

  private assertActive(): void {
    if (this.#status !== "Active") {
      failLocation("ArchivedEntity", "Archived maps cannot be changed.");
    }
  }
}

const presentations: Readonly<Record<DerivedStockStatus, MapRegionStatusPresentation>> =
  Object.freeze({
    Available: Object.freeze({
      status: "Available",
      colour: "#2E7D32",
      text: "Available",
      icon: "check-circle",
    }),
    LowStock: Object.freeze({
      status: "LowStock",
      colour: "#ED6C02",
      text: "Low stock",
      icon: "warning",
    }),
    OutOfStock: Object.freeze({
      status: "OutOfStock",
      colour: "#D32F2F",
      text: "Out of stock",
      icon: "remove-circle",
    }),
    Attention: Object.freeze({
      status: "Attention",
      colour: "#9C27B0",
      text: "Action required",
      icon: "priority-high",
    }),
    Quarantined: Object.freeze({
      status: "Quarantined",
      colour: "#455A64",
      text: "Quarantined",
      icon: "block",
    }),
    Archived: Object.freeze({
      status: "Archived",
      colour: "#757575",
      text: "Archived",
      icon: "archive",
    }),
  });

export const mapRegionStatusPresentation = (
  status: DerivedStockStatus,
): MapRegionStatusPresentation => {
  const runtimeStatus: string = status;
  if (!Object.hasOwn(presentations, runtimeStatus)) {
    failLocation("InvalidOperation", "Map stock status is not supported.");
  }
  return presentations[runtimeStatus as DerivedStockStatus];
};

export const validateHierarchyMapConsistency = (
  directory: LocationDirectory,
  maps: readonly BuildingMapSnapshot[],
): readonly HierarchyMapConsistencyIssue[] => {
  const issues: HierarchyMapConsistencyIssue[] = [];
  const mapCountByBuilding = new Map<LocationId, number>();
  for (const map of maps) {
    mapCountByBuilding.set(map.buildingId, (mapCountByBuilding.get(map.buildingId) ?? 0) + 1);
  }
  for (const [buildingId, count] of mapCountByBuilding) {
    if (count > 1) {
      issues.push({ code: "DuplicateMapForBuilding", buildingId });
    }
  }

  const buildings = directory.listHierarchyNodes().filter((node) => node.nodeKind === "Building");
  const buildingById = new Map(buildings.map((building) => [building.id, building]));
  for (const building of buildings) {
    if (building.status === "Active" && !mapCountByBuilding.has(building.id)) {
      issues.push({ code: "MissingMapForBuilding", buildingId: building.id });
    }
  }

  for (const map of maps) {
    const building = buildingById.get(map.buildingId);
    if (building === undefined) {
      issues.push({ code: "MissingBuilding", mapId: map.id, buildingId: map.buildingId });
      continue;
    }
    if (
      (building.status === "Active" && map.status !== "Active") ||
      (building.status === "Archived" && map.status !== "Archived")
    ) {
      issues.push({ code: "MapStatusMismatch", mapId: map.id, buildingId: map.buildingId });
    }
    for (const region of map.regions) {
      const node = directory.getHierarchyNode(region.hierarchyNodeId);
      if (node === undefined) {
        issues.push({
          code: "MissingHierarchyLink",
          mapId: map.id,
          regionId: region.id,
          buildingId: map.buildingId,
        });
        continue;
      }
      const linkedBuildingId = node.nodeKind === "Building" ? node.id : node.buildingId;
      if (linkedBuildingId !== map.buildingId) {
        issues.push({
          code: "CrossBuildingLink",
          mapId: map.id,
          regionId: region.id,
          buildingId: map.buildingId,
        });
      } else if (region.status === "Active" && node.status === "Archived") {
        issues.push({
          code: "ArchivedHierarchyLink",
          mapId: map.id,
          regionId: region.id,
          buildingId: map.buildingId,
        });
      }
    }
  }
  return issues;
};

export { createPolygonGeometry, createRectangleGeometry };
export type { MapGeometry, NormalizedPoint };
