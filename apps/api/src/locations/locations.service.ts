import { createHash, randomUUID } from "node:crypto";

import type {
  CreateMapRequest,
  FloorPlanMetadata,
  LocationSearchResult,
  MapGeometry,
  MapLocationInput,
  MapLocationView,
  MapStatusSummary,
  MapSummaryView,
  MapView,
  SaveMapRequest,
  UploadFloorPlanRequest,
} from "@stockcontrol/contracts";
import { optimisticConflict, resourceUnavailable, validationFailed } from "@stockcontrol/contracts";
import {
  createLocationCode,
  createLocationId,
  createLocationName,
  createMapId,
  deriveContainment,
  descendantIds,
  LocationDomainError,
  LocationMap,
  retirementOutcome,
  type LocationMapSnapshot,
} from "@stockcontrol/module-locations";
import { ApplicationFailureException } from "@stockcontrol/platform";
import type { JsonObject, StockControlDatabase } from "@stockcontrol/platform-database";
import type { Kysely } from "kysely";

import { locationPaths } from "./location-paths";
import type { FloorPlanDocumentRow, LocationRow, MapRow } from "./locations.types";
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

const aliasesFor = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((alias): alias is string => typeof alias === "string") : [];

/**
 * A code for a shape the user just drew and only gave a name. They can still
 * override it, but nobody should have to invent one to put a box on a map.
 */
const generateCode = (name: string, taken: ReadonlySet<string>): string => {
  const base =
    name
      .toUpperCase()
      .replaceAll(/[^A-Z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 28) || "LOC";
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base}-${String(suffix)}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `LOC-${randomUUID().slice(0, 8).toUpperCase()}`;
};

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

/** One location as the save is about to write it. */
interface ResolvedLocation {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly geometry: MapGeometry;
  readonly zOrder: number;
  readonly searchAliases: readonly string[];
  readonly status: "Active" | "Archived";
  readonly isNew: boolean;
}

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

  public async search(query: string): Promise<readonly LocationSearchResult[]> {
    const needle = query.trim().toLocaleLowerCase("en-GB");
    if (needle.length < 1 || needle.length > 100)
      throw new ApplicationFailureException(
        validationFailed({ query: ["Enter 1-100 search characters."] }),
      );
    const rows = await this.repository.listLocations();
    const paths = locationPaths(rows);
    return rows
      .filter((row) => row.kind === "Store")
      .flatMap((row) => {
        const matchedOn = row.code.toLocaleLowerCase("en-GB").includes(needle)
          ? ("code" as const)
          : row.name.toLocaleLowerCase("en-GB").includes(needle)
            ? ("name" as const)
            : aliasesFor(row.search_aliases).some((alias) =>
                  alias.toLocaleLowerCase("en-GB").includes(needle),
                )
              ? ("alias" as const)
              : undefined;
        if (matchedOn === undefined) return [];
        return [
          {
            id: row.id,
            code: row.code,
            name: row.name,
            path: paths.get(row.id)?.path ?? row.name,
            status: row.is_active ? ("Active" as const) : ("Archived" as const),
            mapId: row.map_id,
            matchedOn,
          },
        ];
      });
  }

  public async maps(): Promise<readonly MapSummaryView[]> {
    const rows = await this.repository.listLocations();
    const maps = await this.repository.listMaps();
    return maps.map((map) => ({
      id: map.id,
      code: map.code,
      name: map.name,
      status: map.status,
      revision: map.revision,
      background: backgroundFor(map),
      locationCount: rows.filter((row) => row.map_id === map.id).length,
    }));
  }

  public async map(mapId: string): Promise<MapView> {
    const map = await this.repository.findMap(mapId);
    if (map === undefined)
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "That map was not found." }),
      );
    return this.view(map, await this.repository.listMapLocations(mapId));
  }

  public async createMap(input: CreateMapRequest, actorUserId: string): Promise<MapView> {
    const mapId = createMapId(randomUUID());
    try {
      LocationMap.create(mapId, createLocationCode(input.code), createLocationName(input.name), {
        kind: "Blank",
      });
    } catch (error) {
      throw domainFailure(error);
    }
    try {
      await this.database.transaction().execute(async (tx) => {
        await tx
          .withSchema(SCHEMA)
          .insertInto("maps")
          .values({
            id: mapId,
            code: createLocationCode(input.code),
            name: createLocationName(input.name),
            background_kind: "Blank",
            background_asset_id: null,
            background_metadata: { kind: "Blank" } as unknown as JsonObject,
            status: "Active",
            revision: 0,
          })
          .execute();
        await tx
          .withSchema(SCHEMA)
          .insertInto("map_edit_events")
          .values({
            id: randomUUID(),
            map_id: mapId,
            actor_user_id: actorUserId,
            action: "map.created",
            before_state: null,
            after_state: { revision: 0, locations: 0 },
            reason: null,
          })
          .execute();
      });
    } catch (error) {
      if (postgresErrorCode(error) === "23505")
        throw new ApplicationFailureException(
          validationFailed({ code: ["That map code is already in use."] }),
        );
      throw domainFailure(error);
    }
    return this.map(mapId);
  }

  /**
   * The single write path for locations. Saving a map inserts what was drawn,
   * updates what moved, retires what was erased, and then recomputes every
   * `derived_parent_id` on the map from the geometry — all inside the revision
   * guard, so the stored tree can never disagree with the stored shapes.
   */
  public async saveMap(
    mapId: string,
    input: SaveMapRequest,
    actorUserId: string,
    floorPlanDocument?: FloorPlanDocumentRow & { readonly object_key: string },
  ): Promise<MapView> {
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

    const allRows = await this.repository.listLocations();
    const existing = allRows.filter((row) => row.map_id === mapId);
    const existingById = new Map(existing.map((row) => [row.id, row]));
    const resolved = this.resolve(input.locations, existingById, allRows);
    const keptIds = new Set(resolved.map((location) => location.id));
    const removed = existing.filter((row) => !keptIds.has(row.id));
    const background = input.background ?? backgroundFor(map);

    let saved: LocationMapSnapshot;
    try {
      saved = LocationMap.rehydrate({
        id: createMapId(map.id),
        code: createLocationCode(map.code),
        name: createLocationName(map.name),
        background: background as LocationMapSnapshot["background"],
        status: map.status,
        locations: resolved.map((location) => ({
          id: createLocationId(location.id),
          code: createLocationCode(location.code),
          name: createLocationName(location.name),
          geometry: location.geometry as never,
          zOrder: location.zOrder,
          searchAliases: location.searchAliases,
          status: location.status,
        })),
      }).snapshot();
    } catch (error) {
      throw domainFailure(error);
    }

    const usage = await this.repository.usage(removed.map((row) => row.id));
    const parents = deriveContainment(
      saved.locations
        .filter((location) => location.status === "Active")
        .map((location) => ({
          id: location.id,
          geometry: location.geometry,
          zOrder: location.zOrder,
        })),
    );
    const now = new Date();

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
        .updateTable("maps")
        .set({
          background_kind: saved.background.kind,
          background_asset_id:
            saved.background.kind === "FloorPlan" ? saved.background.documentId : null,
          background_metadata: saved.background as unknown as JsonObject,
          revision: map.revision + 1,
          updated_at: now,
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

      /*
       * Parent links are cleared before anything is added or removed so a
       * deleted shape never has a row still pointing at it, and so the new
       * links below are written against a clean slate.
       */
      await tx
        .withSchema(SCHEMA)
        .updateTable("locations")
        .set({ derived_parent_id: null })
        .where("map_id", "=", mapId)
        .execute();

      for (const row of removed) {
        const outcome = retirementOutcome(
          usage.get(row.id) ?? { occupied: true, historicallyReferenced: true },
        );
        if (outcome === "Removed") {
          await tx.withSchema(SCHEMA).deleteFrom("locations").where("id", "=", row.id).execute();
          continue;
        }
        await tx
          .withSchema(SCHEMA)
          .updateTable("locations")
          .set({
            map_id: null,
            geometry: null,
            is_active: false,
            archived_at: row.archived_at ?? now,
            updated_at: now,
          })
          .where("id", "=", row.id)
          .execute();
      }

      for (const location of saved.locations) {
        const source = resolved.find((candidate) => candidate.id === location.id)!;
        const values = {
          name: location.name,
          map_id: mapId,
          geometry: location.geometry as unknown as JsonObject,
          z_order: location.zOrder,
          search_aliases: JSON.stringify(location.searchAliases),
          is_active: location.status === "Active",
          archived_at: location.status === "Archived" ? now : null,
        };
        if (source.isNew) {
          await tx
            .withSchema(SCHEMA)
            .insertInto("locations")
            .values({
              id: location.id,
              code: location.code,
              kind: "Store",
              job_id: null,
              derived_parent_id: null,
              ...values,
            })
            .execute();
          continue;
        }
        await tx
          .withSchema(SCHEMA)
          .updateTable("locations")
          .set({ ...values, updated_at: now })
          .where("id", "=", location.id)
          .execute();
      }

      for (const [id, parentId] of parents) {
        if (parentId === null) continue;
        await tx
          .withSchema(SCHEMA)
          .updateTable("locations")
          .set({ derived_parent_id: parentId })
          .where("id", "=", id)
          .execute();
      }

      await tx
        .withSchema(SCHEMA)
        .insertInto("map_edit_events")
        .values({
          id: randomUUID(),
          map_id: mapId,
          actor_user_id: actorUserId,
          action: "snapshot.saved",
          before_state: { revision: map.revision, locations: existing.length },
          after_state: { revision: map.revision + 1, locations: saved.locations.length },
          reason: null,
        })
        .execute();
    });

    return this.map(mapId);
  }

  public async uploadBackground(
    mapId: string,
    input: UploadFloorPlanRequest,
    actorUserId: string,
  ): Promise<MapView> {
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
          locations: input.locations,
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

  public async archiveMap(mapId: string, actorUserId: string): Promise<MapView> {
    const map = await this.repository.findMap(mapId);
    if (map === undefined)
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "That map was not found." }),
      );
    const now = new Date();
    await this.database.transaction().execute(async (tx) => {
      await tx
        .withSchema(SCHEMA)
        .updateTable("maps")
        .set({ status: "Archived", updated_at: now })
        .where("id", "=", mapId)
        .execute();
      await tx
        .withSchema(SCHEMA)
        .updateTable("locations")
        .set({ is_active: false, archived_at: now, derived_parent_id: null, updated_at: now })
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
    return this.map(mapId);
  }

  /**
   * Retires a location without erasing its drawing: the shape stays on the map
   * greyed out, and drops out of containment so anything inside it re-derives
   * its parent from what remains.
   */
  public async archive(locationId: string): Promise<void> {
    const rows = await this.repository.listLocations();
    const row = rows.find((candidate) => candidate.id === locationId);
    if (row === undefined || row.kind !== "Store")
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "That location was not found." }),
      );
    if (!row.is_active)
      throw new ApplicationFailureException(
        validationFailed({ location: ["That location is already archived."] }),
      );
    const now = new Date();
    await this.database.transaction().execute(async (tx) => {
      await tx
        .withSchema(SCHEMA)
        .updateTable("locations")
        .set({ is_active: false, archived_at: now, derived_parent_id: null, updated_at: now })
        .where("id", "=", locationId)
        .execute();
      await tx
        .withSchema(SCHEMA)
        .updateTable("locations")
        .set({ derived_parent_id: row.derived_parent_id, updated_at: now })
        .where("derived_parent_id", "=", locationId)
        .execute();
    });
  }

  public async remove(locationId: string): Promise<void> {
    const rows = await this.repository.listLocations();
    const row = rows.find((candidate) => candidate.id === locationId);
    if (row === undefined || row.kind !== "Store")
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "That location was not found." }),
      );
    const usage = await this.repository.usage([locationId]);
    if (retirementOutcome(usage.get(locationId)!) !== "Removed")
      throw new ApplicationFailureException(
        validationFailed(
          { location: ["This location is in use and must be archived instead of deleted."] },
          { code: "locations.in_use" },
        ),
      );
    try {
      await this.database.transaction().execute(async (tx) => {
        await tx
          .withSchema(SCHEMA)
          .updateTable("locations")
          .set({ derived_parent_id: null })
          .where("derived_parent_id", "=", locationId)
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

  /**
   * Fills in what the browser did not send: a code derived from the name, and an
   * id when even that is absent.
   *
   * The editor mints a UUID the moment a shape is drawn, so an id it has never
   * seen is a new location rather than a mistake. An id belonging to a location
   * on another map is refused, since a save must not reach off its own canvas.
   */
  private resolve(
    inputs: readonly MapLocationInput[],
    existing: ReadonlyMap<string, LocationRow>,
    allRows: readonly LocationRow[],
  ): readonly ResolvedLocation[] {
    const everywhere = new Set(allRows.map((row) => row.id));
    const taken = new Set(allRows.map((row) => row.code.toUpperCase()));
    for (const input of inputs) {
      const row = input.id === undefined ? undefined : existing.get(input.id);
      if (row !== undefined) taken.delete(row.code.toUpperCase());
    }
    return inputs.map((input) => {
      if (input.id !== undefined && !existing.has(input.id) && everywhere.has(input.id))
        throw new ApplicationFailureException(
          validationFailed({ locations: ["That location belongs to another map."] }),
        );
      const row = input.id === undefined ? undefined : existing.get(input.id);
      const supplied = input.code?.trim();
      const code = (
        supplied === undefined || supplied === ""
          ? (row?.code ?? generateCode(input.name, taken))
          : supplied
      ).toUpperCase();
      taken.add(code);
      return {
        id: input.id ?? randomUUID(),
        code,
        name: input.name,
        geometry: input.geometry,
        zOrder: input.zOrder,
        searchAliases: input.searchAliases ?? aliasesFor(row?.search_aliases),
        status: input.status ?? "Active",
        isNew: row === undefined,
      };
    });
  }

  private async view(map: MapRow, mapRows: readonly LocationRow[]): Promise<MapView> {
    const allRows = await this.repository.listLocations();
    const parents = new Map(allRows.map((row) => [row.id, row.derived_parent_id] as const));
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
      .execute();
    const paths = locationPaths(allRows);
    return {
      id: map.id,
      code: map.code,
      name: map.name,
      status: map.status,
      revision: map.revision,
      background: backgroundFor(map),
      locations: mapRows.map((row) => this.locationView(row, parents, stockRows, paths)),
      capabilities: ["view", "search"],
    };
  }

  private locationView(
    row: LocationRow,
    parents: ReadonlyMap<string, string | null>,
    stockRows: readonly {
      readonly location_id: string;
      readonly item_id: string;
      readonly quantity: string;
      readonly item_name: string;
      readonly low_stock_threshold: string | null;
    }[],
    paths: ReadonlyMap<string, { readonly path: string; readonly depth: number }>,
  ): MapLocationView {
    const within = descendantIds(parents, row.id);
    const held = stockRows.filter(
      (stock) => within.has(stock.location_id) && Number(stock.quantity) > 0,
    );
    const quantity = held.reduce((total, stock) => total + Number(stock.quantity), 0);
    const itemTotals = new Map<string, { readonly name: string; readonly quantity: string }>();
    for (const stock of held) {
      const existing = itemTotals.get(stock.item_id);
      itemTotals.set(stock.item_id, {
        name: stock.item_name,
        quantity: String(Number(existing?.quantity ?? "0") + Number(stock.quantity)),
      });
    }
    const items = [...itemTotals.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    const low = held.some(
      (stock) =>
        stock.low_stock_threshold !== null &&
        Number(stock.quantity) < Number(stock.low_stock_threshold),
    );
    const archived = !row.is_active;
    const stock: MapStatusSummary = archived
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
    const placement = paths.get(row.id);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      geometry: geometryFor(row.geometry),
      zOrder: row.z_order,
      searchAliases: aliasesFor(row.search_aliases),
      status: row.is_active ? "Active" : "Archived",
      derivedParentId: row.derived_parent_id,
      depth: placement?.depth ?? 0,
      path: placement?.path ?? row.name,
      stock,
    };
  }
}
