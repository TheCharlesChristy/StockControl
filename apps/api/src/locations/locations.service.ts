import { createHash, randomUUID } from "node:crypto";

import type {
  CreateHierarchyNodeRequest,
  FloorPlanMetadata,
  HierarchyNodeView,
  HierarchyTreeResponse,
  LocationSearchResult,
  MapGeometry,
  MapRegionInput,
  MapSnapshot,
  MapStatusSummary,
  MapSummaryView,
  SaveMapRequest,
  UploadFloorPlanRequest,
} from "@stockcontrol/contracts";
import { optimisticConflict, resourceUnavailable, validationFailed } from "@stockcontrol/contracts";
import {
  BuildingMap,
  createLocationCode,
  createLocationId,
  createLocationName,
  createMapId,
  createMapRegionId,
  LocationDirectory,
  LocationDomainError,
  type BuildingMapSnapshot,
  type HierarchyLocationNode,
  type MapRegion,
} from "@stockcontrol/module-locations";
import { ApplicationFailureException } from "@stockcontrol/platform";
import type { JsonObject, StockControlDatabase } from "@stockcontrol/platform-database";
import type { Kysely } from "kysely";

import type { FloorPlanDocumentRow, LocationRow, MapRow, RegionRow } from "./locations.types";
import { S3PrivateFloorPlanStorage, type FloorPlanObjectStorage } from "./floor-plan-storage";
import { LocationsRepository } from "./locations.repository";

const SCHEMA = "stockcontrol" as const;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_START = Buffer.from([0xff, 0xd8]);
const MAX_FLOOR_PLAN_DIMENSION = 20_000;
const MAX_FLOOR_PLAN_PIXELS = 100_000_000;

interface DecodedFloorPlan {
  readonly bytes: Buffer;
  readonly width: number;
  readonly height: number;
}

const decodeBase64 = (value: string, maxBytes: number): Buffer => {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value))
    throw new Error("Floor-plan bytes must be valid base64.");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 1 || bytes.length > maxBytes)
    throw new Error(`Floor-plan bytes must be between 1 and ${String(maxBytes)} bytes.`);
  return bytes;
};

const pngDimensions = (bytes: Buffer): { readonly width: number; readonly height: number } => {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE))
    throw new Error("The uploaded PNG is invalid.");
  if (bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error("The uploaded PNG is invalid.");
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_FLOOR_PLAN_DIMENSION ||
    height > MAX_FLOOR_PLAN_DIMENSION ||
    width * height > MAX_FLOOR_PLAN_PIXELS
  )
    throw new Error("The uploaded PNG has invalid or excessive dimensions.");
  return { width, height };
};

const jpegDimensions = (bytes: Buffer): { readonly width: number; readonly height: number } => {
  if (bytes.length < 4 || !bytes.subarray(0, 2).equals(JPEG_START))
    throw new Error("The uploaded JPEG is invalid.");
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error("The uploaded JPEG is invalid.");
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === undefined) break;
    if (marker === 0xd9) break;
    if (marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 1 >= bytes.length) break;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length)
      throw new Error("The uploaded JPEG is invalid.");
    const isFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isFrame && segmentLength >= 7) {
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      if (
        width > 0 &&
        height > 0 &&
        width <= MAX_FLOOR_PLAN_DIMENSION &&
        height <= MAX_FLOOR_PLAN_DIMENSION &&
        width * height <= MAX_FLOOR_PLAN_PIXELS
      )
        return { width, height };
    }
    offset += segmentLength;
  }
  throw new Error("The uploaded JPEG has no valid dimensions.");
};

const decodeFloorPlan = (input: UploadFloorPlanRequest, maxBytes: number): DecodedFloorPlan => {
  if (
    input.originalFileName.trim() !== input.originalFileName ||
    input.originalFileName.length < 1 ||
    input.originalFileName.length > 240 ||
    [...input.originalFileName].some((character) => {
      const code = character.charCodeAt(0);
      return character === "/" || character === "\\" || code <= 0x1f || code === 0x7f;
    })
  )
    throw new Error("A safe floor-plan filename is required.");
  const bytes = decodeBase64(input.contentBase64, maxBytes);
  const dimensions = input.mediaType === "image/png" ? pngDimensions(bytes) : jpegDimensions(bytes);
  return { bytes, ...dimensions };
};
const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};

const toDirectory = (rows: readonly LocationRow[]): LocationDirectory => {
  const hierarchy = rows
    .filter((row) => row.kind === "Store" && row.node_kind !== "JobSite")
    .map((row) => ({
      id: createLocationId(row.id),
      code: createLocationCode(row.code),
      name: createLocationName(row.name),
      nodeKind: row.node_kind === "JobSite" ? "CustomSection" : row.node_kind,
      operationalKind:
        row.operational_kind === "VirtualJobSite" ? "Container" : row.operational_kind,
      ...(row.parent_id === null ? {} : { parentId: createLocationId(row.parent_id) }),
      branchId: createLocationId(
        rows.find((candidate) => candidate.node_kind === "Branch")?.id ?? row.id,
      ),
      ...(row.building_id === null ? {} : { buildingId: createLocationId(row.building_id) }),
      status: row.is_active ? ("Active" as const) : ("Archived" as const),
      generalFulfilmentEnabled: row.general_fulfilment_enabled,
    }));
  const branch = hierarchy.find((row) => row.nodeKind === "Branch");
  if (branch === undefined)
    throw new ApplicationFailureException(
      resourceUnavailable({ detail: "The location hierarchy is not configured." }),
    );
  return LocationDirectory.rehydrate({
    hierarchyNodes: hierarchy,
    vans: [],
    virtualJobSites: [],
    usedCodes: rows.map((row) => createLocationCode(row.code)),
  });
};

const nodeView = (
  node: HierarchyLocationNode,
  children: readonly HierarchyNodeView[] = [],
): HierarchyNodeView => ({
  id: node.id,
  code: node.code,
  name: node.name,
  nodeKind: node.nodeKind,
  operationalKind: node.operationalKind,
  parentId: node.parentId ?? null,
  branchId: node.branchId,
  buildingId: node.buildingId ?? null,
  status: node.status,
  generalFulfilmentEnabled: node.generalFulfilmentEnabled,
  children,
});

const treeFor = (nodes: readonly HierarchyLocationNode[], rootId: string): HierarchyNodeView => {
  const node = nodes.find((candidate) => candidate.id === rootId);
  if (node === undefined)
    throw new ApplicationFailureException(
      resourceUnavailable({ detail: "The location hierarchy is incomplete." }),
    );
  return nodeView(
    node,
    nodes
      .filter((candidate) => candidate.parentId === node.id)
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((child) => treeFor(nodes, child.id)),
  );
};

const backgroundFor = (row: MapRow | undefined): FloorPlanMetadata => {
  if (row === undefined || row.background_kind === "Blank") return { kind: "Blank" };
  const metadata = asRecord(row.background_metadata);
  return {
    kind: "FloorPlan",
    ...(row.background_asset_id === null
      ? {}
      : {
          documentId: row.background_asset_id,
          downloadPath: `/api/v1/floor-plans/${row.background_asset_id}`,
        }),
    ...(typeof metadata.originalFileName === "string"
      ? { originalFileName: metadata.originalFileName }
      : {}),
    ...(metadata.mediaType === "image/png" || metadata.mediaType === "image/jpeg"
      ? { mediaType: metadata.mediaType }
      : {}),
    ...(typeof metadata.pixelWidth === "number" ? { pixelWidth: metadata.pixelWidth } : {}),
    ...(typeof metadata.pixelHeight === "number" ? { pixelHeight: metadata.pixelHeight } : {}),
  };
};

const geometryFor = (value: unknown): MapGeometry => {
  const record = asRecord(value);
  if (
    record.kind === "Rectangle" &&
    typeof record.x === "number" &&
    typeof record.y === "number" &&
    typeof record.width === "number" &&
    typeof record.height === "number"
  )
    return {
      kind: "Rectangle",
      x: record.x,
      y: record.y,
      width: record.width,
      height: record.height,
    };
  if (record.kind === "Polygon" && Array.isArray(record.points))
    return {
      kind: "Polygon",
      points: record.points
        .filter((point): point is { x: number; y: number } => {
          const candidate = asRecord(point);
          return typeof candidate.x === "number" && typeof candidate.y === "number";
        })
        .map((point) => ({ x: point.x, y: point.y })),
    };
  throw new ApplicationFailureException(
    validationFailed({ geometry: ["Map geometry is invalid."] }),
  );
};

const inputGeometry = (input: MapRegionInput): MapGeometry => input.geometry;

const domainFailure = (error: unknown): ApplicationFailureException => {
  if (error instanceof ApplicationFailureException) return error;
  if (error instanceof LocationDomainError) {
    return new ApplicationFailureException(
      validationFailed({ map: [error.message] }, { code: `locations.${error.code.toLowerCase()}` }),
    );
  }
  return new ApplicationFailureException(
    validationFailed({ map: ["The map could not be validated."] }),
  );
};

const postgresErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  const code = "code" in error ? (error as { readonly code?: unknown }).code : undefined;
  if (typeof code === "string") return code;
  return postgresErrorCode((error as { readonly cause?: unknown }).cause);
};

export class LocationsService {
  private readonly repository: LocationsRepository;
  private readonly maxFloorPlanBytes: number;
  public constructor(
    private readonly database: Kysely<StockControlDatabase>,
    private readonly floorPlanStorage: FloorPlanObjectStorage = new S3PrivateFloorPlanStorage(),
  ) {
    this.repository = new LocationsRepository(database);
    const configuredLimit = Number(process.env.FLOOR_PLAN_MAX_BYTES ?? "10485760");
    this.maxFloorPlanBytes =
      Number.isSafeInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 10_485_760;
  }

  public async tree(): Promise<HierarchyTreeResponse> {
    const rows = await this.repository.listLocations();
    const directory = toDirectory(rows);
    const nodes = directory.listHierarchyNodes();
    const root = nodes.find((node) => node.nodeKind === "Branch");
    if (root === undefined)
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "The location hierarchy is not configured." }),
      );
    return {
      root: treeFor(nodes, root.id),
      buildings: nodes
        .filter((node) => node.nodeKind === "Building")
        .map((node) => treeFor(nodes, node.id)),
      capabilities: ["view", "search"],
    };
  }

  public async search(query: string): Promise<readonly LocationSearchResult[]> {
    const needle = query.trim().toLocaleLowerCase("en-GB");
    if (needle.length < 1 || needle.length > 100)
      throw new ApplicationFailureException(
        validationFailed({ query: ["Enter 1-100 search characters."] }),
      );
    const rows = await this.repository.listLocations();
    const directory = toDirectory(rows);
    const maps = await this.repository.listMaps();
    const regions = (
      await Promise.all(
        maps.map(async (map) => [map, await this.repository.listRegions(map.id)] as const),
      )
    ).flatMap(([map, mapRegions]) => mapRegions.map((region) => ({ map, region })));
    return rows
      .filter((row) => row.kind === "Store" && row.node_kind !== "JobSite")
      .flatMap((row) => {
        const region = regions.find(
          (candidate) =>
            candidate.region.hierarchy_location_id === row.id &&
            candidate.region.status === "Active",
        );
        const matchedOn = row.code.toLocaleLowerCase("en-GB").includes(needle)
          ? ("code" as const)
          : row.name.toLocaleLowerCase("en-GB").includes(needle)
            ? ("name" as const)
            : region?.region.display_name.toLocaleLowerCase("en-GB").includes(needle)
              ? ("region" as const)
              : (region?.region.search_aliases as unknown[] | undefined)?.some(
                    (alias) =>
                      typeof alias === "string" &&
                      alias.toLocaleLowerCase("en-GB").includes(needle),
                  )
                ? ("alias" as const)
                : undefined;
        if (matchedOn === undefined) return [];
        return [
          {
            location: nodeView(directory.getHierarchyNode(createLocationId(row.id))!),
            regionId: region?.region.id ?? null,
            mapId: region?.map.id ?? null,
            matchedOn,
          },
        ];
      });
  }

  public async maps(): Promise<readonly MapSummaryView[]> {
    const rows = await this.repository.listLocations();
    const maps = await this.repository.listMaps();
    return (
      await Promise.all(
        maps.map(async (map) => {
          const building = rows.find((row) => row.id === map.building_location_id);
          if (building === undefined) return undefined;
          const regions = await this.repository.listRegions(map.id);
          return {
            id: map.id,
            buildingId: building.id,
            buildingCode: building.code,
            buildingName: building.name,
            status: map.status,
            revision: map.revision,
            background: backgroundFor(map),
            regionCount: regions.length,
          };
        }),
      )
    ).filter((map): map is MapSummaryView => map !== undefined);
  }

  public async mapForBuilding(buildingId: string): Promise<MapSnapshot> {
    const rows = await this.repository.listLocations();
    const building = rows.find((row) => row.id === buildingId && row.node_kind === "Building");
    if (building === undefined)
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "That Building was not found." }),
      );
    const map = (await this.repository.listMaps()).find(
      (candidate) => candidate.building_location_id === buildingId,
    );
    if (map === undefined)
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "That Building does not have a map yet." }),
      );
    return this.snapshot(map, rows, await this.repository.listRegions(map.id));
  }

  public async createHierarchy(input: CreateHierarchyNodeRequest): Promise<HierarchyNodeView> {
    const rows = await this.repository.listLocations();
    const directory = toDirectory(rows);
    try {
      const node = directory.addHierarchyNode({
        id: createLocationId(randomUUID()),
        code: createLocationCode(input.code),
        name: createLocationName(input.name),
        nodeKind: input.nodeKind,
        operationalKind: input.operationalKind,
        parentId: createLocationId(input.parentId),
        ...(input.generalFulfilmentEnabled === undefined
          ? {}
          : { generalFulfilmentEnabled: input.generalFulfilmentEnabled }),
      });
      await this.database
        .withSchema(SCHEMA)
        .insertInto("locations")
        .values({
          id: node.id,
          code: node.code,
          name: node.name,
          kind: "Store",
          job_id: null,
          is_active: true,
          node_kind: node.nodeKind,
          operational_kind: node.operationalKind,
          parent_id: node.parentId ?? null,
          building_id: node.buildingId ?? null,
          general_fulfilment_enabled: node.generalFulfilmentEnabled,
          archived_at: null,
        })
        .execute();
      return nodeView(node);
    } catch (error) {
      throw domainFailure(error);
    }
  }

  public async rename(locationId: string, name: string): Promise<HierarchyNodeView> {
    return this.updateLocation(locationId, (directory) =>
      directory.renameLocation(createLocationId(locationId), createLocationName(name)),
    );
  }
  public async move(locationId: string, parentId: string): Promise<HierarchyNodeView> {
    return this.updateLocation(locationId, (directory) =>
      directory.moveHierarchyNode(createLocationId(locationId), createLocationId(parentId)),
    );
  }
  public async archive(locationId: string): Promise<HierarchyNodeView> {
    return this.updateLocation(locationId, (directory) =>
      directory.retireHierarchyNode(createLocationId(locationId), {
        occupied: true,
        historicallyReferenced: true,
      }) === "Archived"
        ? directory.getHierarchyNode(createLocationId(locationId))!
        : (() => {
            throw new Error("Unreachable");
          })(),
    );
  }

  public async remove(locationId: string): Promise<void> {
    const rows = await this.repository.listLocations();
    const directory = toDirectory(rows);
    const id = createLocationId(locationId);
    if (directory.getHierarchyNode(id) === undefined)
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "That location was not found." }),
      );

    try {
      const outcome = directory.retireHierarchyNode(id, {
        occupied: false,
        historicallyReferenced: false,
      });
      if (outcome !== "Removed") throw new Error("The location could not be deleted.");

      await this.database.transaction().execute(async (tx) => {
        // Buildings currently carry a self-referencing building_id backfill.
        // Clear that link before removing a newly-created, otherwise-unused
        // building so PostgreSQL does not reject the delete on its own row.
        await tx
          .withSchema(SCHEMA)
          .updateTable("locations")
          .set({ building_id: null })
          .where("id", "=", locationId)
          .execute();
        await tx.withSchema(SCHEMA).deleteFrom("locations").where("id", "=", locationId).execute();
      });
    } catch (error) {
      if (postgresErrorCode(error) === "23503")
        throw new ApplicationFailureException(
          validationFailed(
            { location: ["This location is in use and must be archived instead of deleted."] },
            { code: "locations.in_use" },
          ),
        );
      throw domainFailure(error);
    }
  }

  public async createMap(
    buildingId: string,
    background: FloorPlanMetadata = { kind: "Blank" },
    actorUserId: string,
  ): Promise<MapSnapshot> {
    const rows = await this.repository.listLocations();
    const directory = toDirectory(rows);
    try {
      const mapId = createMapId(randomUUID());
      const map = BuildingMap.create(
        mapId,
        createLocationId(buildingId),
        background as BuildingMapSnapshot["background"],
        directory,
      );
      await this.database.transaction().execute(async (tx) => {
        await tx
          .withSchema(SCHEMA)
          .insertInto("building_maps")
          .values({
            id: map.id,
            building_location_id: buildingId,
            background_kind: background.kind,
            background_asset_id: background.documentId ?? null,
            background_metadata: background as unknown as JsonObject,
            status: "Active",
            revision: 0,
          })
          .execute();
        await tx
          .withSchema(SCHEMA)
          .insertInto("map_edit_events")
          .values({
            id: randomUUID(),
            map_id: map.id,
            actor_user_id: actorUserId,
            action: "map.created",
            before_state: null,
            after_state: { revision: 0, regions: 0 },
            reason: null,
          })
          .execute();
      });
      return this.snapshot(
        {
          id: map.id,
          building_location_id: buildingId,
          background_kind: background.kind,
          background_asset_id: background.documentId ?? null,
          background_metadata: background,
          status: "Active",
          revision: 0,
        },
        rows,
        [],
      );
    } catch (error) {
      throw domainFailure(error);
    }
  }

  public async saveMap(
    mapId: string,
    input: SaveMapRequest,
    actorUserId: string,
    floorPlanDocument?: FloorPlanDocumentRow & { readonly object_key: string },
  ): Promise<MapSnapshot> {
    const map = await this.repository.findMap(mapId);
    if (map === undefined)
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "That map was not found." }),
      );
    if (map.revision !== input.expectedRevision)
      throw new ApplicationFailureException(
        optimisticConflict({
          detail: "Another map save has occurred. Reload the latest version before saving.",
        }),
      );
    const rows = await this.repository.listLocations();
    const directory = toDirectory(rows);
    const existing = await this.repository.listRegions(mapId);
    const background = input.background ?? backgroundFor(map);
    const regionInputs = input.regions.map((region) => ({
      id: createMapRegionId(region.id ?? randomUUID()),
      displayName: createLocationName(region.displayName),
      hierarchyNodeId: createLocationId(region.hierarchyNodeId),
      ...(region.parentRegionId === undefined || region.parentRegionId === null
        ? {}
        : { parentRegionId: createMapRegionId(region.parentRegionId) }),
      geometry: inputGeometry(region) as never,
      zOrder: region.zOrder,
      searchAliases: region.searchAliases ?? [],
      status: region.status ?? "Active",
    }));
    let canonical: BuildingMap;
    try {
      canonical = BuildingMap.rehydrate(
        {
          id: createMapId(map.id),
          buildingId: createLocationId(map.building_location_id),
          background: background as BuildingMapSnapshot["background"],
          status: map.status,
          regions: regionInputs,
        },
        directory,
      );
    } catch (error) {
      throw domainFailure(error);
    }
    const saved = canonical.snapshot();
    try {
      await this.database.transaction().execute(async (tx) => {
        if (floorPlanDocument !== undefined)
          await tx
            .withSchema(SCHEMA)
            .insertInto("floor_plan_documents")
            .values({
              id: floorPlanDocument.id,
              object_key: floorPlanDocument.object_key,
              original_file_name: floorPlanDocument.original_file_name,
              media_type: floorPlanDocument.media_type,
              byte_length: floorPlanDocument.byte_length,
              sha256: floorPlanDocument.sha256,
              created_by_user_id: actorUserId,
            })
            .execute();
        const update = await tx
          .withSchema(SCHEMA)
          .updateTable("building_maps")
          .set({
            background_kind: saved.background.kind,
            background_asset_id:
              saved.background.kind === "FloorPlan" ? saved.background.documentId : null,
            background_metadata: saved.background as unknown as JsonObject,
            revision: map.revision + 1,
            updated_at: new Date(),
          })
          .where("id", "=", mapId)
          .where("revision", "=", input.expectedRevision)
          .executeTakeFirst();
        if (Number(update.numUpdatedRows) !== 1)
          throw new ApplicationFailureException(
            optimisticConflict({
              detail: "Another map save has occurred. Reload the latest version before saving.",
            }),
          );
        await tx.withSchema(SCHEMA).deleteFrom("map_regions").where("map_id", "=", mapId).execute();
        if (saved.regions.length > 0)
          await tx
            .withSchema(SCHEMA)
            .insertInto("map_regions")
            .values(
              saved.regions.map((region) => ({
                id: region.id,
                map_id: mapId,
                hierarchy_location_id: region.hierarchyNodeId,
                parent_region_id: region.parentRegionId ?? null,
                display_name: region.displayName,
                geometry: region.geometry as unknown as JsonObject,
                z_order: region.zOrder,
                search_aliases: JSON.stringify(region.searchAliases),
                status: region.status,
              })),
            )
            .execute();
        await tx
          .withSchema(SCHEMA)
          .insertInto("map_edit_events")
          .values({
            id: randomUUID(),
            map_id: mapId,
            actor_user_id: actorUserId,
            action: "snapshot.saved",
            before_state: { revision: map.revision, regions: existing.length },
            after_state: { revision: map.revision + 1, regions: saved.regions.length },
            reason: null,
          })
          .execute();
      });
    } catch (error) {
      if (error instanceof ApplicationFailureException) throw error;
      throw error;
    }
    const latest = {
      ...map,
      revision: map.revision + 1,
      background_kind: saved.background.kind,
      background_asset_id:
        saved.background.kind === "FloorPlan" ? saved.background.documentId : null,
      background_metadata: saved.background,
    };
    return this.snapshot(
      latest,
      rows,
      saved.regions.map((region) => ({
        id: region.id,
        map_id: mapId,
        hierarchy_location_id: region.hierarchyNodeId,
        parent_region_id: region.parentRegionId ?? null,
        display_name: region.displayName,
        geometry: region.geometry,
        z_order: region.zOrder,
        search_aliases: region.searchAliases,
        status: region.status,
      })),
    );
  }

  public async uploadBackground(
    mapId: string,
    input: UploadFloorPlanRequest,
    actorUserId: string,
  ): Promise<MapSnapshot> {
    let decoded: DecodedFloorPlan;
    try {
      decoded = decodeFloorPlan(input, this.maxFloorPlanBytes);
    } catch (error) {
      throw new ApplicationFailureException(
        validationFailed({
          file: [error instanceof Error ? error.message : "The floor plan is invalid."],
        }),
      );
    }
    const documentId = randomUUID();
    const objectKey = `floor-plans/${mapId}/${documentId}`;
    const document: FloorPlanDocumentRow = {
      id: documentId,
      object_key: objectKey,
      original_file_name: input.originalFileName,
      media_type: input.mediaType,
      byte_length: decoded.bytes.length,
      sha256: createHash("sha256").update(decoded.bytes).digest("hex"),
    };
    await this.floorPlanStorage.putObject({
      key: objectKey,
      bytes: decoded.bytes,
      mediaType: input.mediaType,
    });
    try {
      return await this.saveMap(
        mapId,
        {
          expectedRevision: input.expectedRevision,
          regions: input.regions,
          background: {
            kind: "FloorPlan",
            documentId,
            originalFileName: input.originalFileName,
            mediaType: input.mediaType,
            pixelWidth: decoded.width,
            pixelHeight: decoded.height,
          },
        },
        actorUserId,
        document,
      );
    } catch (error) {
      await this.floorPlanStorage.deleteObject(objectKey).catch(() => undefined);
      throw error;
    }
  }

  public async floorPlan(documentId: string): Promise<{
    readonly bytes: Buffer;
    readonly mediaType: string;
    readonly fileName: string;
  }> {
    const document = await this.repository.findLinkedFloorPlan(documentId);
    if (document === undefined)
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "That floor plan is not available." }),
      );
    const object = await this.floorPlanStorage.getObject(document.object_key);
    if (createHash("sha256").update(object.bytes).digest("hex") !== document.sha256)
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "That floor plan failed its integrity check." }),
      );
    return {
      bytes: object.bytes,
      mediaType: document.media_type,
      fileName: document.original_file_name,
    };
  }

  public async archiveMap(mapId: string, actorUserId: string): Promise<MapSnapshot> {
    const map = await this.repository.findMap(mapId);
    if (map === undefined)
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "That map was not found." }),
      );
    await this.database.transaction().execute(async (tx) => {
      await tx
        .withSchema(SCHEMA)
        .updateTable("building_maps")
        .set({ status: "Archived", updated_at: new Date() })
        .where("id", "=", mapId)
        .execute();
      await tx
        .withSchema(SCHEMA)
        .updateTable("map_regions")
        .set({ status: "Archived", updated_at: new Date() })
        .where("map_id", "=", mapId)
        .execute();
      await tx
        .withSchema(SCHEMA)
        .insertInto("map_edit_events")
        .values({
          id: randomUUID(),
          map_id: mapId,
          actor_user_id: actorUserId,
          action: "map.archived",
          before_state: { status: map.status, revision: map.revision },
          after_state: { status: "Archived", revision: map.revision },
          reason: null,
        })
        .execute();
    });
    return this.mapForBuilding(map.building_location_id);
  }

  private async updateLocation(
    locationId: string,
    operation: (directory: LocationDirectory) => HierarchyLocationNode,
  ): Promise<HierarchyNodeView> {
    const rows = await this.repository.listLocations();
    const directory = toDirectory(rows);
    const before = directory.getHierarchyNode(createLocationId(locationId));
    if (before === undefined)
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "That location was not found." }),
      );
    try {
      const node = operation(directory);
      await this.database
        .withSchema(SCHEMA)
        .updateTable("locations")
        .set({
          name: node.name,
          parent_id: node.parentId ?? null,
          building_id: node.buildingId ?? null,
          general_fulfilment_enabled: node.generalFulfilmentEnabled,
          is_active: node.status === "Active",
          archived_at: node.status === "Archived" ? new Date() : null,
          updated_at: new Date(),
        })
        .where("id", "=", locationId)
        .execute();
      return nodeView(node);
    } catch (error) {
      throw domainFailure(error);
    }
  }

  private async snapshot(
    map: MapRow,
    rows: readonly LocationRow[],
    regions: readonly RegionRow[] | readonly MapRegion[],
  ): Promise<MapSnapshot> {
    const directory = toDirectory(rows);
    const building = directory.getHierarchyNode(createLocationId(map.building_location_id));
    if (building === undefined)
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "That Building was not found." }),
      );
    const descendants = (rootId: string): readonly string[] => {
      const found = new Set<string>([rootId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const node of directory.listHierarchyNodes()) {
          if (node.parentId !== undefined && found.has(node.parentId) && !found.has(node.id)) {
            found.add(node.id);
            changed = true;
          }
        }
      }
      return [...found];
    };
    const stockRows = await this.database
      .withSchema(SCHEMA)
      .selectFrom("stock_levels")
      .innerJoin("items", "items.id", "stock_levels.item_id")
      .select([
        "stock_levels.location_id as location_id",
        "stock_levels.item_id as item_id",
        "stock_levels.quantity as quantity",
        "items.name as item_name",
        "items.low_stock_threshold as low_stock_threshold",
      ])
      .where(
        "stock_levels.location_id",
        "in",
        directory.listHierarchyNodes().map((node) => node.id),
      )
      .execute();
    const regionViews = regions.map((region) => {
      const raw =
        "map_id" in region
          ? region
          : {
              id: region.id,
              map_id: map.id,
              hierarchy_location_id: region.hierarchyNodeId,
              parent_region_id: region.parentRegionId ?? null,
              display_name: region.displayName,
              geometry: region.geometry,
              z_order: region.zOrder,
              search_aliases: region.searchAliases,
              status: region.status,
            };
      const linked = directory.getHierarchyNode(createLocationId(raw.hierarchy_location_id));
      const archived = linked?.status === "Archived" || raw.status === "Archived";
      const held = stockRows.filter(
        (row) =>
          descendants(raw.hierarchy_location_id).includes(row.location_id) &&
          Number(row.quantity) > 0,
      );
      const quantity = held.reduce((total, row) => total + Number(row.quantity), 0);
      const itemTotals = new Map<string, { readonly name: string; readonly quantity: string }>();
      for (const row of held) {
        const existing = itemTotals.get(row.item_id);
        itemTotals.set(row.item_id, {
          name: row.item_name,
          quantity: String(Number(existing?.quantity ?? "0") + Number(row.quantity)),
        });
      }
      const items = [...itemTotals.values()].sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      const low = held.some(
        (row) =>
          row.low_stock_threshold !== null &&
          Number(row.quantity) < Number(row.low_stock_threshold),
      );
      const status: MapStatusSummary = archived
        ? {
            status: "Archived",
            colour: "#757575",
            text: "Archived",
            icon: "archive",
            itemCount: items.length,
            quantity: String(quantity),
            items,
          }
        : low
          ? {
              status: "LowStock",
              colour: "#ED6C02",
              text: "Low stock",
              icon: "warning",
              itemCount: items.length,
              quantity: String(quantity),
              items,
            }
          : quantity > 0
            ? {
                status: "Available",
                colour: "#2E7D32",
                text: "Available",
                icon: "check-circle",
                itemCount: items.length,
                quantity: String(quantity),
                items,
              }
            : {
                status: "OutOfStock",
                colour: "#D32F2F",
                text: "Out of stock",
                icon: "remove-circle",
                itemCount: 0,
                quantity: "0",
                items: [],
              };
      return {
        id: raw.id,
        displayName: raw.display_name,
        hierarchyNodeId: raw.hierarchy_location_id,
        parentRegionId: raw.parent_region_id,
        geometry: geometryFor(raw.geometry),
        zOrder: raw.z_order,
        searchAliases: Array.isArray(raw.search_aliases)
          ? raw.search_aliases.filter((alias): alias is string => typeof alias === "string")
          : [],
        status: raw.status,
        stock: status,
      };
    });
    return {
      id: map.id,
      buildingId: building.id,
      building: treeFor(directory.listHierarchyNodes(), building.id),
      status: map.status,
      revision: map.revision,
      background: backgroundFor(map),
      hierarchy: [treeFor(directory.listHierarchyNodes(), building.id)],
      regions: regionViews,
      capabilities: ["view", "search"],
    };
  }
}
