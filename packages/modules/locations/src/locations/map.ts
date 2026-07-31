import type { LocationDirectory, HierarchyLocationNode } from "./directory.js";
import { failLocation, LocationDomainError } from "./errors.js";
import {
  copyGeometry,
  createPolygonGeometry,
  createRectangleGeometry,
  type MapGeometry,
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
  readonly mediaType: "image/png" | "image/jpeg";
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

const cloneRegion = (region: MapRegion): MapRegion => ({
  ...region,
  geometry: copyGeometry(region.geometry),
  searchAliases: [...region.searchAliases],
});
const aliases = (values: readonly string[]): readonly string[] => {
  if (values.length > 20)
    failLocation("InvalidOperation", "A map region supports at most 20 aliases.");
  const normalized = values.map((value) => {
    if (
      value.length > 160 ||
      [...value].some(
        (character) => character.charCodeAt(0) <= 0x1f || character.charCodeAt(0) === 0x7f,
      )
    )
      failLocation("InvalidOperation", "Map search aliases are invalid.");
    const result = value.trim().replaceAll(/\s+/gu, " ");
    if (result.length < 1 || result.length > 80)
      failLocation("InvalidOperation", "Map search aliases must contain 1-80 characters.");
    return result;
  });
  if (
    new Set(normalized.map((value) => value.toLocaleLowerCase("en-GB"))).size !== normalized.length
  )
    failLocation("InvalidOperation", "Map search aliases must be unique.");
  return Object.freeze(normalized);
};
const nodeFor = (
  directory: LocationDirectory,
  nodeId: LocationId,
  buildingId: LocationId,
  allowArchived: boolean,
): HierarchyLocationNode => {
  const node = directory.getHierarchyNode(nodeId);
  if (node === undefined || node.nodeKind === "Branch")
    failLocation("InvalidMapLink", "A map region must link to a hierarchy node.");
  const linkedBuilding = node.nodeKind === "Building" ? node.id : node.buildingId;
  if (linkedBuilding !== buildingId || (!allowArchived && node.status !== "Active"))
    failLocation(
      "InvalidMapLink",
      "A map region can link only to an active node in the same Building.",
    );
  return node;
};
const backgroundCopy = (background: MapBackground): MapBackground => {
  if (background.kind === "Blank") return { kind: "Blank" };
  try {
    const mediaType: string = background.mediaType;
    const unsafeName = [...background.originalFileName].some((character) => {
      const code = character.charCodeAt(0);
      return character === "/" || character === "\\" || code <= 0x1f || code === 0x7f;
    });
    if (
      createDocumentId(background.documentId) !== background.documentId ||
      (mediaType !== "image/png" && mediaType !== "image/jpeg") ||
      background.originalFileName.trim() !== background.originalFileName ||
      background.originalFileName.length < 1 ||
      background.originalFileName.length > 240 ||
      unsafeName
    )
      failLocation("InvalidMapLink", "Floor-plan metadata is invalid.");
    if (
      (background.pixelWidth === undefined) !== (background.pixelHeight === undefined) ||
      (background.pixelWidth !== undefined &&
        (!Number.isSafeInteger(background.pixelWidth) ||
          !Number.isSafeInteger(background.pixelHeight) ||
          background.pixelWidth < 1 ||
          background.pixelHeight! < 1))
    )
      failLocation("InvalidMapLink", "Floor-plan dimensions are invalid.");
    return { ...background };
  } catch (error) {
    if (error instanceof LocationDomainError) throw error;
    failLocation("InvalidMapLink", "Floor-plan metadata is invalid.");
  }
};

export class BuildingMap {
  readonly #id: MapId;
  readonly #buildingId: LocationId;
  #background: MapBackground;
  #status: MapStatus;
  readonly #regions: Map<MapRegionId, MapRegion>;
  private constructor(snapshot: BuildingMapSnapshot, directory: LocationDirectory) {
    const runtimeStatus: string = snapshot.status;
    if (
      createMapId(snapshot.id) !== snapshot.id ||
      createLocationId(snapshot.buildingId) !== snapshot.buildingId ||
      (runtimeStatus !== "Active" && runtimeStatus !== "Archived")
    )
      failLocation("InvalidMapLink", "Map identity or status is invalid.");
    const building = directory.getHierarchyNode(snapshot.buildingId);
    if (
      building?.nodeKind !== "Building" ||
      (snapshot.status === "Active") !== (building.status === "Active")
    )
      failLocation(
        "InvalidMapLink",
        "A map must belong to a Building with the same archive state.",
      );
    const regions = snapshot.regions.map((region) => {
      if (
        createMapRegionId(region.id) !== region.id ||
        createLocationName(region.displayName) !== region.displayName ||
        createLocationId(region.hierarchyNodeId) !== region.hierarchyNodeId
      )
        failLocation("InvalidMapLink", "Map contains a malformed region.");
      nodeFor(directory, region.hierarchyNodeId, snapshot.buildingId, region.status === "Archived");
      return {
        ...region,
        geometry: copyGeometry(region.geometry),
        zOrder: Number.isSafeInteger(region.zOrder)
          ? region.zOrder
          : (() => {
              failLocation("InvalidOperation", "Map z-order is invalid.");
            })(),
        searchAliases: aliases(region.searchAliases),
      };
    });
    if (new Set(regions.map((region) => region.id)).size !== regions.length)
      failLocation("DuplicateEntity", "Map region identities must be unique.");
    const byId = new Map(regions.map((region) => [region.id, region]));
    for (const region of regions) {
      if (snapshot.status === "Archived" && region.status !== "Archived")
        failLocation("InvalidMapLink", "An archived map cannot contain active regions.");
      if (region.parentRegionId !== undefined) {
        const parent = byId.get(region.parentRegionId);
        if (parent === undefined)
          failLocation("Orphan", "Nested map region parent does not exist.");
        if (region.status === "Active" && parent.status === "Archived")
          failLocation("Orphan", "An active region cannot have an archived parent.");
        const seen = new Set<MapRegionId>([region.id]);
        let cursor: MapRegion | undefined = parent;
        while (cursor !== undefined) {
          if (seen.has(cursor.id)) failLocation("Cycle", "Map region nesting contains a cycle.");
          seen.add(cursor.id);
          cursor =
            cursor.parentRegionId === undefined ? undefined : byId.get(cursor.parentRegionId);
        }
      }
    }
    this.#id = snapshot.id;
    this.#buildingId = snapshot.buildingId;
    this.#background = backgroundCopy(snapshot.background);
    this.#status = snapshot.status;
    this.#regions = new Map(regions.map((region) => [region.id, region]));
  }
  public static create(
    id: MapId,
    buildingId: LocationId,
    background: MapBackground,
    directory: LocationDirectory,
  ): BuildingMap {
    const building = directory.getHierarchyNode(buildingId);
    if (building?.nodeKind !== "Building" || building.status !== "Active")
      failLocation("InvalidMapLink", "An active map must belong to an active Building.");
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
      background: backgroundCopy(this.#background),
      status: this.#status,
      regions: [...this.#regions.values()].map(cloneRegion),
    };
  }
  public getRegion(id: MapRegionId): MapRegion | undefined {
    const region = this.#regions.get(id);
    return region === undefined ? undefined : cloneRegion(region);
  }
  public setBackground(background: MapBackground): MapBackground {
    if (this.#status !== "Active")
      failLocation("ArchivedEntity", "Archived maps cannot be changed.");
    this.#background = backgroundCopy(background);
    return backgroundCopy(this.#background);
  }
  public addRegion(input: AddMapRegion, directory: LocationDirectory): MapRegion {
    if (this.#status !== "Active")
      failLocation("ArchivedEntity", "Archived maps cannot be changed.");
    if (this.#regions.has(input.id))
      failLocation("DuplicateEntity", "Map region identity is already in use.");
    nodeFor(directory, input.hierarchyNodeId, this.#buildingId, false);
    if (
      input.parentRegionId !== undefined &&
      (!this.#regions.has(input.parentRegionId) ||
        this.#regions.get(input.parentRegionId)!.status !== "Active")
    )
      failLocation("Orphan", "A nested region requires an active parent.");
    const region: MapRegion = {
      id: input.id,
      displayName: input.displayName,
      hierarchyNodeId: input.hierarchyNodeId,
      ...(input.parentRegionId === undefined ? {} : { parentRegionId: input.parentRegionId }),
      geometry: copyGeometry(input.geometry),
      zOrder: input.zOrder,
      searchAliases: aliases(input.searchAliases ?? []),
      status: "Active",
    };
    if (!Number.isSafeInteger(region.zOrder))
      failLocation("InvalidOperation", "Map z-order is invalid.");
    this.#regions.set(region.id, region);
    return cloneRegion(region);
  }
  public updateRegion(id: MapRegionId, update: UpdateMapRegion): MapRegion {
    if (this.#status !== "Active")
      failLocation("ArchivedEntity", "Archived maps cannot be changed.");
    const existing = this.#regions.get(id);
    if (existing === undefined) failLocation("MissingEntity", "Map region does not exist.");
    if (existing.status !== "Active")
      failLocation("ArchivedEntity", "Archived map regions cannot be changed.");
    const changed: MapRegion = {
      ...existing,
      ...(update.displayName === undefined
        ? {}
        : { displayName: createLocationName(update.displayName) }),
      ...(update.geometry === undefined ? {} : { geometry: copyGeometry(update.geometry) }),
      ...(update.zOrder === undefined ? {} : { zOrder: update.zOrder }),
      ...(update.searchAliases === undefined
        ? {}
        : { searchAliases: aliases(update.searchAliases) }),
    };
    if (!Number.isSafeInteger(changed.zOrder))
      failLocation("InvalidOperation", "Map z-order is invalid.");
    this.#regions.set(id, changed);
    return cloneRegion(changed);
  }
  public nestRegion(id: MapRegionId, parentRegionId?: MapRegionId): MapRegion {
    const region = this.activeRegion(id);
    if (parentRegionId === region.parentRegionId)
      failLocation("NoChange", "Map region nesting is unchanged.");
    if (parentRegionId !== undefined) {
      const parent = this.activeRegion(parentRegionId);
      if (parent.id === region.id || this.isDescendant(parent.id, region.id))
        failLocation("Cycle", "Map region nesting cannot contain a cycle.");
    }
    const changed =
      parentRegionId === undefined
        ? (({ parentRegionId: ignored, ...rest }) => {
            void ignored;
            return rest;
          })(region)
        : { ...region, parentRegionId };
    this.#regions.set(id, changed);
    return cloneRegion(changed);
  }
  public archiveRegion(id: MapRegionId): MapRegion {
    const region = this.activeRegion(id);
    if (
      [...this.#regions.values()].some(
        (candidate) => candidate.parentRegionId === id && candidate.status === "Active",
      )
    )
      failLocation("Orphan", "Archive every active nested region first.");
    const changed = { ...region, status: "Archived" as const };
    this.#regions.set(id, changed);
    return cloneRegion(changed);
  }
  public search(query: string, directory: LocationDirectory): readonly MapRegion[] {
    const normalized = query.trim().replaceAll(/\s+/gu, " ").toLocaleLowerCase("en-GB");
    if (normalized.length < 1 || normalized.length > 100)
      failLocation("InvalidOperation", "Map search query must contain 1-100 characters.");
    return [...this.#regions.values()]
      .filter((region) => {
        if (region.status !== "Active") return false;
        const node = directory.getHierarchyNode(region.hierarchyNodeId);
        return (
          node !== undefined &&
          [region.displayName, node.name, node.code, ...region.searchAliases].some((value) =>
            value.toLocaleLowerCase("en-GB").includes(normalized),
          )
        );
      })
      .sort((a, b) => a.zOrder - b.zOrder || a.displayName.localeCompare(b.displayName, "en-GB"))
      .map(cloneRegion);
  }
  private activeRegion(id: MapRegionId): MapRegion {
    const region = this.#regions.get(id);
    if (region === undefined) failLocation("MissingEntity", "Map region does not exist.");
    if (region.status !== "Active")
      failLocation("ArchivedEntity", "Archived map regions cannot be changed.");
    return region;
  }
  private isDescendant(candidateId: MapRegionId, ancestorId: MapRegionId): boolean {
    let cursor = this.#regions.get(candidateId);
    const seen = new Set<MapRegionId>();
    while (cursor?.parentRegionId !== undefined) {
      if (seen.has(cursor.id)) failLocation("Cycle", "Map contains a cycle.");
      seen.add(cursor.id);
      if (cursor.parentRegionId === ancestorId) return true;
      cursor = this.#regions.get(cursor.parentRegionId);
    }
    return false;
  }
}

const STATUS_PRESENTATIONS: Readonly<Record<DerivedStockStatus, MapRegionStatusPresentation>> =
  Object.freeze({
    Available: { status: "Available", colour: "#2E7D32", text: "Available", icon: "check-circle" },
    LowStock: { status: "LowStock", colour: "#ED6C02", text: "Low stock", icon: "warning" },
    OutOfStock: {
      status: "OutOfStock",
      colour: "#D32F2F",
      text: "Out of stock",
      icon: "remove-circle",
    },
    Attention: {
      status: "Attention",
      colour: "#9C27B0",
      text: "Action required",
      icon: "priority-high",
    },
    Quarantined: { status: "Quarantined", colour: "#455A64", text: "Quarantined", icon: "block" },
    Archived: { status: "Archived", colour: "#757575", text: "Archived", icon: "archive" },
  });
export const mapRegionStatusPresentation = (
  status: DerivedStockStatus,
): MapRegionStatusPresentation => {
  const runtimeStatus: string = status;
  if (!Object.hasOwn(STATUS_PRESENTATIONS, runtimeStatus))
    failLocation("InvalidOperation", "Map stock status is not supported.");
  return Object.freeze(STATUS_PRESENTATIONS[runtimeStatus as DerivedStockStatus]);
};
export { createPolygonGeometry, createRectangleGeometry };
