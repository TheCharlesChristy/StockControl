import { derivedTree, deriveContainment, type ContainmentTreeNode } from "./containment.js";
import { failLocation, LocationDomainError } from "./errors.js";
import {
  copyGeometry,
  createPolygonGeometry,
  createRectangleGeometry,
  type MapGeometry,
} from "./geometry.js";
import {
  createDocumentId,
  createLocationCode,
  createLocationId,
  createLocationName,
  createMapId,
  type DocumentId,
  type LocationCode,
  type LocationId,
  type LocationName,
  type MapId,
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
export type MapLocationStatus = "Active" | "Archived";

/**
 * A location as it exists on the map. There is no separate "region": the shape
 * and the place stock sits are one record, so drawing is the only way a
 * location comes into being and geometry is the only thing that nests it.
 */
export interface MapLocation {
  readonly id: LocationId;
  readonly code: LocationCode;
  readonly name: LocationName;
  readonly geometry: MapGeometry;
  readonly zOrder: number;
  readonly searchAliases: readonly string[];
  readonly status: MapLocationStatus;
}

export interface LocationMapSnapshot {
  readonly id: MapId;
  readonly code: LocationCode;
  readonly name: LocationName;
  readonly background: MapBackground;
  readonly status: MapStatus;
  readonly locations: readonly MapLocation[];
}

export interface AddMapLocation {
  readonly id: LocationId;
  readonly code: LocationCode;
  readonly name: LocationName;
  readonly geometry: MapGeometry;
  readonly zOrder: number;
  readonly searchAliases?: readonly string[];
}

export interface UpdateMapLocation {
  readonly name?: LocationName;
  readonly geometry?: MapGeometry;
  readonly zOrder?: number;
  readonly searchAliases?: readonly string[];
}

export type DerivedStockStatus =
  "Available" | "LowStock" | "OutOfStock" | "Attention" | "Quarantined" | "Archived";
export interface MapStockStatusPresentation {
  readonly status: DerivedStockStatus;
  readonly colour: `#${string}`;
  readonly text: string;
  readonly icon: string;
}

const cloneLocation = (location: MapLocation): MapLocation => ({
  ...location,
  geometry: copyGeometry(location.geometry),
  searchAliases: [...location.searchAliases],
});

const aliases = (values: readonly string[]): readonly string[] => {
  if (values.length > 20)
    failLocation("InvalidOperation", "A location supports at most 20 aliases.");
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
      failLocation("InvalidBackground", "Floor-plan metadata is invalid.");
    if (
      (background.pixelWidth === undefined) !== (background.pixelHeight === undefined) ||
      (background.pixelWidth !== undefined &&
        (!Number.isSafeInteger(background.pixelWidth) ||
          !Number.isSafeInteger(background.pixelHeight) ||
          background.pixelWidth < 1 ||
          background.pixelHeight! < 1))
    )
      failLocation("InvalidBackground", "Floor-plan dimensions are invalid.");
    return { ...background };
  } catch (error) {
    if (error instanceof LocationDomainError) throw error;
    failLocation("InvalidBackground", "Floor-plan metadata is invalid.");
  }
};

export class LocationMap {
  readonly #id: MapId;
  readonly #code: LocationCode;
  readonly #name: LocationName;
  #background: MapBackground;
  #status: MapStatus;
  readonly #locations: Map<LocationId, MapLocation>;

  private constructor(snapshot: LocationMapSnapshot) {
    const runtimeStatus: string = snapshot.status;
    if (
      createMapId(snapshot.id) !== snapshot.id ||
      createLocationCode(snapshot.code) !== snapshot.code ||
      createLocationName(snapshot.name) !== snapshot.name ||
      (runtimeStatus !== "Active" && runtimeStatus !== "Archived")
    )
      failLocation("InvalidOperation", "Map identity or status is invalid.");
    const locations = snapshot.locations.map((location) => {
      if (
        createLocationId(location.id) !== location.id ||
        createLocationCode(location.code) !== location.code ||
        createLocationName(location.name) !== location.name
      )
        failLocation("InvalidOperation", "Map contains a malformed location.");
      if (!Number.isSafeInteger(location.zOrder))
        failLocation("InvalidOperation", "Map z-order is invalid.");
      if (snapshot.status === "Archived" && location.status !== "Archived")
        failLocation("ArchivedEntity", "An archived map cannot contain active locations.");
      return {
        ...location,
        geometry: copyGeometry(location.geometry),
        searchAliases: aliases(location.searchAliases),
      };
    });
    if (new Set(locations.map((location) => location.id)).size !== locations.length)
      failLocation("DuplicateEntity", "Location identities must be unique.");
    if (new Set(locations.map((location) => location.code)).size !== locations.length)
      failLocation("CodeAlreadyUsed", "Location codes must be unique.");
    this.#id = snapshot.id;
    this.#code = snapshot.code;
    this.#name = snapshot.name;
    this.#background = backgroundCopy(snapshot.background);
    this.#status = snapshot.status;
    this.#locations = new Map(locations.map((location) => [location.id, location]));
  }

  public static create(
    id: MapId,
    code: LocationCode,
    name: LocationName,
    background: MapBackground,
  ): LocationMap {
    return new LocationMap({ id, code, name, background, status: "Active", locations: [] });
  }

  public static rehydrate(snapshot: LocationMapSnapshot): LocationMap {
    return new LocationMap(snapshot);
  }

  public get id(): MapId {
    return this.#id;
  }
  public get code(): LocationCode {
    return this.#code;
  }
  public get name(): LocationName {
    return this.#name;
  }
  public get status(): MapStatus {
    return this.#status;
  }

  public snapshot(): LocationMapSnapshot {
    return {
      id: this.#id,
      code: this.#code,
      name: this.#name,
      background: backgroundCopy(this.#background),
      status: this.#status,
      locations: [...this.#locations.values()].map(cloneLocation),
    };
  }

  public getLocation(id: LocationId): MapLocation | undefined {
    const location = this.#locations.get(id);
    return location === undefined ? undefined : cloneLocation(location);
  }

  public setBackground(background: MapBackground): MapBackground {
    this.assertActive();
    this.#background = backgroundCopy(background);
    return backgroundCopy(this.#background);
  }

  public addLocation(input: AddMapLocation): MapLocation {
    this.assertActive();
    if (this.#locations.has(input.id))
      failLocation("DuplicateEntity", "Location identity is already in use.");
    if ([...this.#locations.values()].some((location) => location.code === input.code))
      failLocation("CodeAlreadyUsed", "Location code is already in use.");
    if (!Number.isSafeInteger(input.zOrder))
      failLocation("InvalidOperation", "Map z-order is invalid.");
    const location: MapLocation = {
      id: input.id,
      code: input.code,
      name: input.name,
      geometry: copyGeometry(input.geometry),
      zOrder: input.zOrder,
      searchAliases: aliases(input.searchAliases ?? []),
      status: "Active",
    };
    this.#locations.set(location.id, location);
    return cloneLocation(location);
  }

  public updateLocation(id: LocationId, update: UpdateMapLocation): MapLocation {
    this.assertActive();
    const existing = this.activeLocation(id);
    const changed: MapLocation = {
      ...existing,
      ...(update.name === undefined ? {} : { name: createLocationName(update.name) }),
      ...(update.geometry === undefined ? {} : { geometry: copyGeometry(update.geometry) }),
      ...(update.zOrder === undefined ? {} : { zOrder: update.zOrder }),
      ...(update.searchAliases === undefined
        ? {}
        : { searchAliases: aliases(update.searchAliases) }),
    };
    if (!Number.isSafeInteger(changed.zOrder))
      failLocation("InvalidOperation", "Map z-order is invalid.");
    this.#locations.set(id, changed);
    return cloneLocation(changed);
  }

  /**
   * Archiving needs no orphan check: anything drawn inside this shape simply
   * re-derives its parent from what is left around it.
   */
  public archiveLocation(id: LocationId): MapLocation {
    const location = this.activeLocation(id);
    const changed = { ...location, status: "Archived" as const };
    this.#locations.set(id, changed);
    return cloneLocation(changed);
  }

  /** Every active location mapped to the smallest active shape containing it. */
  public containment(): ReadonlyMap<string, string | null> {
    return deriveContainment(this.activePlacements());
  }

  public tree(): readonly ContainmentTreeNode[] {
    return derivedTree(
      this.activePlacements().map((placement) => ({
        ...placement,
        name: this.#locations.get(placement.id as LocationId)!.name,
      })),
    );
  }

  public search(query: string): readonly MapLocation[] {
    const normalized = query.trim().replaceAll(/\s+/gu, " ").toLocaleLowerCase("en-GB");
    if (normalized.length < 1 || normalized.length > 100)
      failLocation("InvalidOperation", "Map search query must contain 1-100 characters.");
    return [...this.#locations.values()]
      .filter(
        (location) =>
          location.status === "Active" &&
          [location.name, location.code, ...location.searchAliases].some((value) =>
            value.toLocaleLowerCase("en-GB").includes(normalized),
          ),
      )
      .sort((a, b) => a.zOrder - b.zOrder || a.name.localeCompare(b.name, "en-GB"))
      .map(cloneLocation);
  }

  private activePlacements(): readonly {
    readonly id: string;
    readonly geometry: MapGeometry;
    readonly zOrder: number;
  }[] {
    return [...this.#locations.values()]
      .filter((location) => location.status === "Active")
      .map((location) => ({
        id: location.id,
        geometry: location.geometry,
        zOrder: location.zOrder,
      }));
  }

  private assertActive(): void {
    if (this.#status !== "Active")
      failLocation("ArchivedEntity", "Archived maps cannot be changed.");
  }

  private activeLocation(id: LocationId): MapLocation {
    const location = this.#locations.get(id);
    if (location === undefined) failLocation("MissingEntity", "Location does not exist.");
    if (location.status !== "Active")
      failLocation("ArchivedEntity", "Archived locations cannot be changed.");
    return location;
  }
}

const STATUS_PRESENTATIONS: Readonly<Record<DerivedStockStatus, MapStockStatusPresentation>> =
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

export const mapStockStatusPresentation = (
  status: DerivedStockStatus,
): MapStockStatusPresentation => {
  const runtimeStatus: string = status;
  if (!Object.hasOwn(STATUS_PRESENTATIONS, runtimeStatus))
    failLocation("InvalidOperation", "Map stock status is not supported.");
  return Object.freeze(STATUS_PRESENTATIONS[runtimeStatus as DerivedStockStatus]);
};

export { createPolygonGeometry, createRectangleGeometry };
