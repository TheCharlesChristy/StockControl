export interface LocationRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: "Store" | "JobSite";
  readonly job_id: string | null;
  readonly is_active: boolean;
  readonly map_id: string | null;
  readonly geometry: unknown;
  readonly z_order: number;
  readonly search_aliases: unknown;
  readonly derived_parent_id: string | null;
  readonly archived_at: Date | null;
}

export interface MapRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly background_kind: "Blank" | "FloorPlan";
  readonly background_asset_id: string | null;
  readonly background_metadata: unknown;
  readonly status: "Active" | "Archived";
  readonly revision: number;
}

export interface FloorPlanDocumentRow {
  readonly id: string;
  readonly object_key: string;
  readonly original_file_name: string;
  readonly media_type: "image/png" | "image/jpeg";
  readonly byte_length: number;
  readonly sha256: string;
}

/** Whether a location may still be deleted outright, or must keep its identity. */
export interface LocationUsage {
  readonly occupied: boolean;
  readonly historicallyReferenced: boolean;
}
