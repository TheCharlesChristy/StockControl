import type { LocationNodeKind, LocationOperationalKind } from "@stockcontrol/platform-database";

export interface LocationRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: "Store" | "JobSite";
  readonly job_id: string | null;
  readonly is_active: boolean;
  readonly node_kind: LocationNodeKind;
  readonly operational_kind: LocationOperationalKind;
  readonly parent_id: string | null;
  readonly building_id: string | null;
  readonly general_fulfilment_enabled: boolean;
  readonly archived_at: Date | null;
}

export interface MapRow {
  readonly id: string;
  readonly building_location_id: string;
  readonly background_kind: "Blank" | "FloorPlan";
  readonly background_asset_id: string | null;
  readonly background_metadata: unknown;
  readonly status: "Active" | "Archived";
  readonly revision: number;
}

export interface RegionRow {
  readonly id: string;
  readonly map_id: string;
  readonly hierarchy_location_id: string;
  readonly parent_region_id: string | null;
  readonly display_name: string;
  readonly geometry: unknown;
  readonly z_order: number;
  readonly search_aliases: unknown;
  readonly status: "Active" | "Archived";
}

export interface FloorPlanDocumentRow {
  readonly id: string;
  readonly object_key: string;
  readonly original_file_name: string;
  readonly media_type: "image/png" | "image/jpeg";
  readonly byte_length: number;
  readonly sha256: string;
}
