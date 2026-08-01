import type { StockControlDatabase } from "@stockcontrol/platform-database";
import type { Kysely } from "kysely";

import type { FloorPlanDocumentRow, LocationRow, LocationUsage, MapRow } from "./locations.types";

const SCHEMA = "stockcontrol" as const;

const LOCATION_COLUMNS = [
  "id",
  "code",
  "name",
  "kind",
  "job_id",
  "is_active",
  "map_id",
  "geometry",
  "z_order",
  "search_aliases",
  "derived_parent_id",
  "archived_at",
] as const;

const MAP_COLUMNS = [
  "id",
  "code",
  "name",
  "background_kind",
  "background_asset_id",
  "background_metadata",
  "status",
  "revision",
] as const;

export class LocationsRepository {
  public constructor(private readonly database: Kysely<StockControlDatabase>) {}

  public listLocations(): Promise<readonly LocationRow[]> {
    return this.database
      .withSchema(SCHEMA)
      .selectFrom("locations")
      .select(LOCATION_COLUMNS)
      .orderBy("code")
      .execute();
  }

  public listMapLocations(mapId: string): Promise<readonly LocationRow[]> {
    return this.database
      .withSchema(SCHEMA)
      .selectFrom("locations")
      .select(LOCATION_COLUMNS)
      .where("map_id", "=", mapId)
      .orderBy("z_order")
      .orderBy("id")
      .execute();
  }

  public listMaps(): Promise<readonly MapRow[]> {
    return this.database
      .withSchema(SCHEMA)
      .selectFrom("maps")
      .select(MAP_COLUMNS)
      .orderBy("code")
      .execute();
  }

  public findMap(mapId: string): Promise<MapRow | undefined> {
    return this.database
      .withSchema(SCHEMA)
      .selectFrom("maps")
      .select(MAP_COLUMNS)
      .where("id", "=", mapId)
      .executeTakeFirst();
  }

  /**
   * What the ledger still knows about each location, which decides whether
   * erasing its shape archives it or deletes it outright.
   */
  public async usage(ids: readonly string[]): Promise<ReadonlyMap<string, LocationUsage>> {
    const usage = new Map<string, LocationUsage>(
      ids.map((id) => [id, { occupied: false, historicallyReferenced: false }]),
    );
    if (ids.length === 0) return usage;
    const occupied = await this.database
      .withSchema(SCHEMA)
      .selectFrom("stock_levels")
      .select("location_id")
      .where("location_id", "in", ids)
      .where("quantity", ">", "0")
      .execute();
    const referenced = await this.database
      .withSchema(SCHEMA)
      .selectFrom("transactions")
      .select(["from_location_id", "to_location_id"])
      .where((eb) => eb.or([eb("from_location_id", "in", ids), eb("to_location_id", "in", ids)]))
      .execute();
    for (const row of occupied) {
      const existing = usage.get(row.location_id);
      if (existing !== undefined) usage.set(row.location_id, { ...existing, occupied: true });
    }
    for (const row of referenced) {
      for (const id of [row.from_location_id, row.to_location_id]) {
        if (id === null) continue;
        const existing = usage.get(id);
        if (existing !== undefined) usage.set(id, { ...existing, historicallyReferenced: true });
      }
    }
    return usage;
  }

  public findLinkedFloorPlan(documentId: string): Promise<FloorPlanDocumentRow | undefined> {
    return this.database
      .withSchema(SCHEMA)
      .selectFrom("floor_plan_documents")
      .innerJoin("maps", "maps.background_asset_id", "floor_plan_documents.id")
      .select([
        "floor_plan_documents.id as id",
        "floor_plan_documents.object_key as object_key",
        "floor_plan_documents.original_file_name as original_file_name",
        "floor_plan_documents.media_type as media_type",
        "floor_plan_documents.byte_length as byte_length",
        "floor_plan_documents.sha256 as sha256",
      ])
      .where("floor_plan_documents.id", "=", documentId)
      .executeTakeFirst();
  }
}
