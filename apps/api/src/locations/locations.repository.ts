import type { StockControlDatabase } from "@stockcontrol/platform-database";
import type { Kysely } from "kysely";

import type { FloorPlanDocumentRow, LocationRow, MapRow, RegionRow } from "./locations.types";

const SCHEMA = "stockcontrol" as const;

export class LocationsRepository {
  public constructor(private readonly database: Kysely<StockControlDatabase>) {}

  public listLocations(): Promise<readonly LocationRow[]> {
    return this.database
      .withSchema(SCHEMA)
      .selectFrom("locations")
      .select([
        "id",
        "code",
        "name",
        "kind",
        "job_id",
        "is_active",
        "node_kind",
        "operational_kind",
        "parent_id",
        "building_id",
        "general_fulfilment_enabled",
        "archived_at",
      ])
      .orderBy("code")
      .execute();
  }

  public listMaps(): Promise<readonly MapRow[]> {
    return this.database
      .withSchema(SCHEMA)
      .selectFrom("building_maps")
      .select([
        "id",
        "building_location_id",
        "background_kind",
        "background_asset_id",
        "background_metadata",
        "status",
        "revision",
      ])
      .orderBy("building_location_id")
      .execute();
  }

  public findMap(mapId: string): Promise<MapRow | undefined> {
    return this.database
      .withSchema(SCHEMA)
      .selectFrom("building_maps")
      .select([
        "id",
        "building_location_id",
        "background_kind",
        "background_asset_id",
        "background_metadata",
        "status",
        "revision",
      ])
      .where("id", "=", mapId)
      .executeTakeFirst();
  }

  public listRegions(mapId: string): Promise<readonly RegionRow[]> {
    return this.database
      .withSchema(SCHEMA)
      .selectFrom("map_regions")
      .select([
        "id",
        "map_id",
        "hierarchy_location_id",
        "parent_region_id",
        "display_name",
        "geometry",
        "z_order",
        "search_aliases",
        "status",
      ])
      .where("map_id", "=", mapId)
      .orderBy("z_order")
      .orderBy("id")
      .execute();
  }

  public findLinkedFloorPlan(documentId: string): Promise<FloorPlanDocumentRow | undefined> {
    return this.database
      .withSchema(SCHEMA)
      .selectFrom("floor_plan_documents")
      .innerJoin("building_maps", "building_maps.background_asset_id", "floor_plan_documents.id")
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
