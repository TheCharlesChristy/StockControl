import type { ColumnType, Generated, JSONColumnType } from "kysely";

export const STOCKCONTROL_SCHEMA = "stockcontrol";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonObject | JsonPrimitive | readonly JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type ImmutableColumn<Value> = ColumnType<Value, Value, never>;

/**
 * A jsonb column holding an array. `JSONColumnType` only admits objects, and
 * a JS array passed as a parameter becomes a PostgreSQL array literal that
 * jsonb rejects, so these are written as serialised JSON — the same trap
 * `locations.search_aliases` documents.
 */
export type JsonArrayColumn = ColumnType<JsonValue, string | undefined, string>;
export type GeneratedImmutableColumn<Value> = ColumnType<Value, Value | undefined, never>;

export interface SystemMetadataTable {
  readonly key: string;
  readonly value: JSONColumnType<JsonObject, JsonObject, JsonObject>;
  readonly created_at: Generated<Date>;
  readonly updated_at: Generated<Date>;
}

export interface MigrationIntegrityTable {
  readonly migration_name: string;
  readonly migration_version: number;
  readonly checksum: string;
  readonly recorded_at: Generated<Date>;
}

export type UserRole = "Engineer" | "Office" | "Admin";
export type LocationKind = "Store" | "JobSite";
export type MapBackgroundKind = "Blank" | "FloorPlan";
export type MapStatus = "Active" | "Archived";
export type JobStatus = "Open" | "Closed";
export type ReservationStatus = "Open" | "Fulfilled" | "Released";
export type TransactionKind =
  "Receive" | "Issue" | "Transfer" | "Adjust" | "Reserve" | "Collect" | "Release";

export interface UsersTable {
  readonly id: ImmutableColumn<string>;
  /** The sign-in identifier, stored lowercase. */
  readonly username: string;
  /** Optional contact information; nothing is ever sent to it. */
  readonly email: string | null;
  readonly display_name: string;
  readonly role: UserRole;
  readonly password_hash: string;
  /** True while the current password was chosen by somebody other than the user. */
  readonly must_change_password: Generated<boolean>;
  readonly password_changed_at: Date | null;
  readonly is_active: Generated<boolean>;
  readonly created_at: GeneratedImmutableColumn<Date>;
  readonly updated_at: Generated<Date>;
}

export interface SessionsTable {
  readonly id: ImmutableColumn<string>;
  readonly user_id: ImmutableColumn<string>;
  readonly issued_at: GeneratedImmutableColumn<Date>;
  readonly expires_at: ImmutableColumn<Date>;
}

export type OAuthGrantEventType =
  "Connected" | "Reauthorised" | "ScopeChanged" | "Revoked" | "Refreshed" | "RefreshReplayDetected";

export interface OAuthGrantsTable {
  readonly id: ImmutableColumn<string>;
  readonly user_id: ImmutableColumn<string>;
  readonly client_id: ImmutableColumn<string>;
  readonly redirect_uri: ImmutableColumn<string>;
  readonly resource_uri: string | null;
  readonly granted_scopes: JsonArrayColumn;
  readonly authorization_code_hash: string | null;
  readonly authorization_code_challenge: string | null;
  readonly authorization_code_method: string | null;
  readonly authorization_code_expires_at: Date | null;
  readonly authorization_code_used_at: Date | null;
  readonly access_token_hash: string | null;
  readonly access_token_expires_at: Date | null;
  readonly refresh_token_hash: string | null;
  readonly refresh_token_expires_at: Date | null;
  readonly revoked_at: Date | null;
  readonly created_at: GeneratedImmutableColumn<Date>;
  readonly updated_at: Generated<Date>;
}

export interface OAuthGrantEventsTable {
  readonly id: ImmutableColumn<string>;
  readonly grant_id: ImmutableColumn<string>;
  readonly user_id: ImmutableColumn<string>;
  readonly event_type: ImmutableColumn<OAuthGrantEventType>;
  readonly scopes: JsonArrayColumn;
  readonly occurred_at: GeneratedImmutableColumn<Date>;
}

export interface OAuthAuthorizationRequestsTable {
  readonly id: ImmutableColumn<string>;
  readonly user_id: string | null;
  readonly client_id: ImmutableColumn<string>;
  readonly redirect_uri: ImmutableColumn<string>;
  readonly resource_uri: string | null;
  readonly approval_handle_hash: string | null;
  readonly state: string | null;
  readonly requested_scopes: JsonArrayColumn;
  readonly code_challenge: ImmutableColumn<string>;
  readonly code_challenge_method: ImmutableColumn<string>;
  readonly authorization_code_hash: string | null;
  readonly expires_at: ImmutableColumn<Date>;
  readonly approved_at: Date | null;
  readonly consumed_at: Date | null;
  readonly authorization_code_expires_at: Date | null;
  readonly denied_at: Date | null;
  readonly created_at: GeneratedImmutableColumn<Date>;
}

export interface OAuthRefreshTokensTable {
  readonly id: ImmutableColumn<string>;
  readonly grant_id: ImmutableColumn<string>;
  readonly client_id: ImmutableColumn<string>;
  readonly resource_uri: ImmutableColumn<string>;
  readonly token_hash: ImmutableColumn<string>;
  readonly expires_at: ImmutableColumn<Date>;
  readonly used_at: Date | null;
  readonly revoked_at: Date | null;
  readonly created_at: GeneratedImmutableColumn<Date>;
}

export type McpOperation = "read" | "write";
export type McpToolCallEventType =
  "Received" | "Authorised" | "Denied" | "Succeeded" | "Failed" | "Interrupted";

export interface McpToolCallsTable {
  readonly id: ImmutableColumn<string>;
  readonly correlation_id: ImmutableColumn<string>;
  readonly actor_user_id: string | null;
  readonly oauth_grant_id: string | null;
  readonly tool_name: ImmutableColumn<string>;
  readonly contract_version: ImmutableColumn<string>;
  readonly operation: ImmutableColumn<McpOperation>;
  readonly arguments: JSONColumnType<JsonObject, string, string>;
  readonly arguments_sha256: ImmutableColumn<string>;
  readonly action_summary: string | null;
  readonly client_request_id: string | null;
  readonly received_at: GeneratedImmutableColumn<Date>;
}

export interface McpToolCallEventsTable {
  readonly id: ImmutableColumn<string>;
  readonly call_id: ImmutableColumn<string>;
  readonly actor_user_id: string | null;
  readonly oauth_grant_id: string | null;
  readonly event_type: ImmutableColumn<McpToolCallEventType>;
  readonly occurred_at: GeneratedImmutableColumn<Date>;
  readonly failure_code: string | null;
  readonly duration_ms: number | null;
  readonly result_summary: JSONColumnType<JsonObject, string | undefined, string>;
  readonly record_count: number | null;
  readonly record_types: JsonArrayColumn;
  readonly response_digest: string | null;
}

export interface McpEffectLinksTable {
  readonly id: ImmutableColumn<string>;
  readonly call_id: ImmutableColumn<string>;
  readonly effect_type: ImmutableColumn<string>;
  readonly effect_id: ImmutableColumn<string>;
  readonly linked_at: GeneratedImmutableColumn<Date>;
}

export interface McpCommandReceiptsTable {
  readonly id: ImmutableColumn<string>;
  readonly actor_user_id: ImmutableColumn<string>;
  readonly tool_name: ImmutableColumn<string>;
  readonly idempotency_key: ImmutableColumn<string>;
  readonly request_fingerprint: ImmutableColumn<string>;
  readonly call_id: ImmutableColumn<string>;
  readonly result: JSONColumnType<JsonObject, string, string>;
  readonly result_digest: ImmutableColumn<string>;
  readonly committed_at: GeneratedImmutableColumn<Date>;
}

export interface JobsTable {
  readonly id: ImmutableColumn<string>;
  readonly number: ImmutableColumn<string>;
  readonly name: string;
  readonly customer: string;
  readonly status: Generated<JobStatus>;
  readonly created_at: GeneratedImmutableColumn<Date>;
  readonly updated_at: Generated<Date>;
  readonly closed_at: Date | null;
}

export interface LocationsTable {
  readonly id: ImmutableColumn<string>;
  readonly code: ImmutableColumn<string>;
  readonly name: string;
  readonly kind: ImmutableColumn<LocationKind>;
  readonly job_id: ImmutableColumn<string | null>;
  readonly is_active: Generated<boolean>;
  /** Null for a job site, which is a place stock can sit but nothing you draw. */
  readonly map_id: string | null;
  readonly geometry: JSONColumnType<JsonObject, JsonObject, JsonObject> | null;
  readonly z_order: Generated<number>;
  /*
   * Written as serialised JSON, not as an array. node-postgres turns a JS array
   * parameter into a PostgreSQL array literal — `{"north cache"}` — which a
   * jsonb column rejects. Objects happen to serialise correctly, which is why
   * `geometry` above works and this did not.
   */
  readonly search_aliases: ColumnType<readonly string[], string | undefined, string>;
  /** Recomputed from geometry on every map save; never set by a user. */
  readonly derived_parent_id: string | null;
  readonly archived_at: Date | null;
  readonly created_at: GeneratedImmutableColumn<Date>;
  readonly updated_at: Generated<Date>;
}

export interface MapsTable {
  readonly id: ImmutableColumn<string>;
  readonly code: ImmutableColumn<string>;
  readonly name: string;
  readonly background_kind: Generated<MapBackgroundKind>;
  readonly background_asset_id: string | null;
  readonly background_metadata: JSONColumnType<JsonObject, JsonObject, JsonObject>;
  readonly status: Generated<MapStatus>;
  readonly revision: Generated<number>;
  readonly created_at: GeneratedImmutableColumn<Date>;
  readonly updated_at: Generated<Date>;
}

export interface FloorPlanDocumentsTable {
  readonly id: ImmutableColumn<string>;
  readonly object_key: ImmutableColumn<string>;
  readonly original_file_name: string;
  readonly media_type: "image/png" | "image/jpeg";
  readonly byte_length: number;
  readonly sha256: string;
  readonly created_by_user_id: ImmutableColumn<string>;
  readonly created_at: GeneratedImmutableColumn<Date>;
}

export interface UserProfilePhotosTable {
  readonly id: ImmutableColumn<string>;
  readonly user_id: ImmutableColumn<string>;
  readonly object_key: ImmutableColumn<string>;
  readonly original_file_name: string;
  readonly media_type: "image/png" | "image/jpeg";
  readonly byte_length: number;
  readonly sha256: string;
  readonly created_at: GeneratedImmutableColumn<Date>;
}

export interface ItemPhotosTable {
  readonly id: ImmutableColumn<string>;
  readonly item_id: ImmutableColumn<string>;
  readonly object_key: ImmutableColumn<string>;
  readonly original_file_name: string;
  readonly media_type: "image/png" | "image/jpeg";
  readonly byte_length: number;
  readonly sha256: string;
  readonly display_order: number;
  readonly created_by_user_id: ImmutableColumn<string>;
  readonly created_at: GeneratedImmutableColumn<Date>;
}

export interface MapEditEventsTable {
  readonly id: ImmutableColumn<string>;
  readonly map_id: ImmutableColumn<string>;
  readonly actor_user_id: ImmutableColumn<string>;
  readonly action: string;
  readonly before_state: JSONColumnType<JsonObject | null, JsonObject | null, JsonObject | null>;
  readonly after_state: JSONColumnType<JsonObject | null, JsonObject | null, JsonObject | null>;
  readonly reason: string | null;
  readonly occurred_at: GeneratedImmutableColumn<Date>;
}

export interface ItemsTable {
  readonly id: ImmutableColumn<string>;
  readonly reference: ImmutableColumn<string>;
  readonly name: string;
  readonly unit: string;
  readonly barcode: string | null;
  readonly part_number: string | null;
  readonly low_stock_threshold: string | null;
  readonly is_active: Generated<boolean>;
  readonly created_at: GeneratedImmutableColumn<Date>;
  readonly updated_at: Generated<Date>;
}

export interface StockLevelsTable {
  readonly id: ImmutableColumn<string>;
  readonly item_id: ImmutableColumn<string>;
  readonly location_id: ImmutableColumn<string>;
  readonly quantity: Generated<string>;
  readonly updated_at: Generated<Date>;
}

export interface ReservationsTable {
  readonly id: ImmutableColumn<string>;
  readonly job_id: ImmutableColumn<string>;
  readonly item_id: ImmutableColumn<string>;
  readonly quantity_reserved: string;
  readonly quantity_collected: Generated<string>;
  readonly status: Generated<ReservationStatus>;
  readonly created_by_user_id: ImmutableColumn<string>;
  readonly created_at: GeneratedImmutableColumn<Date>;
  readonly updated_at: Generated<Date>;
}

export type StockRequestStatus = "Pending" | "Approved" | "Rejected" | "Cancelled";

/** Who is working a job. Several people may work the same one. */
export interface JobAssignmentsTable {
  readonly job_id: ImmutableColumn<string>;
  readonly user_id: ImmutableColumn<string>;
  readonly assigned_by_user_id: ImmutableColumn<string>;
  readonly assigned_at: GeneratedImmutableColumn<Date>;
}

/** Demand that has been asked for. It changes no stock level until approved. */
export interface StockRequestsTable {
  readonly id: ImmutableColumn<string>;
  readonly reference: ImmutableColumn<string>;
  readonly item_id: ImmutableColumn<string>;
  readonly job_id: ImmutableColumn<string | null>;
  readonly quantity: string;
  readonly note: string | null;
  readonly status: Generated<StockRequestStatus>;
  readonly requested_by_user_id: ImmutableColumn<string>;
  readonly decided_by_user_id: string | null;
  readonly decided_at: Date | null;
  readonly decision_note: string | null;
  readonly reservation_id: string | null;
  readonly created_at: GeneratedImmutableColumn<Date>;
  readonly updated_at: Generated<Date>;
}

/** Append-only. The runtime role holds select and insert only. */
export interface TransactionsTable {
  readonly id: ImmutableColumn<string>;
  readonly kind: ImmutableColumn<TransactionKind>;
  readonly item_id: ImmutableColumn<string>;
  readonly quantity: ImmutableColumn<string>;
  readonly from_location_id: ImmutableColumn<string | null>;
  readonly to_location_id: ImmutableColumn<string | null>;
  readonly job_id: ImmutableColumn<string | null>;
  readonly reservation_id: ImmutableColumn<string | null>;
  readonly reason: ImmutableColumn<string | null>;
  readonly actor_user_id: ImmutableColumn<string>;
  readonly occurred_at: GeneratedImmutableColumn<Date>;
}

/*
 * Assisted stock capture. Every table below holds operational state that is
 * purged after the session finishes; none of it is a business record. The
 * receipt those sessions produce lives in `transactions` and outlives all of
 * this, which is why nothing in the ledger points back here.
 */

export type StockCaptureBatchStatus = "Open" | "Completed" | "Cancelled";

export type RecognitionSessionStatus =
  | "AwaitingUpload"
  | "Queued"
  | "ProcessingBarcode"
  | "ProcessingImages"
  | "Enriching"
  | "Fusing"
  | "ReviewReady"
  | "Committed"
  | "Failed"
  | "Cancelled"
  | "Expired";

export type RecognitionImageStatus = "Pending" | "Verified" | "Rejected" | "Deleted";
export type RecognitionCandidateKind = "InternalItem" | "ExternalDraft";
export type RecognitionConfidenceBand = "Strong" | "Possible" | "Weak";
export type RecognitionJobType = "Recognize" | "BuildExemplars" | "DeleteObjects";
export type RecognitionJobStatus = "Ready" | "Running" | "Succeeded" | "Retry" | "Failed";
export type StockCaptureEntryStatus = "Pending" | "Committed";
export type RecognitionFeedbackOutcome = "Accepted" | "Edited" | "RejectedAll";

export interface StockCaptureBatchesTable {
  readonly id: ImmutableColumn<string>;
  readonly actor_user_id: ImmutableColumn<string>;
  readonly default_location_id: string | null;
  readonly request_hash: ImmutableColumn<string>;
  readonly status: Generated<StockCaptureBatchStatus>;
  readonly created_at: GeneratedImmutableColumn<Date>;
  readonly updated_at: Generated<Date>;
  readonly closed_at: Date | null;
}

export interface StockRecognitionSessionsTable {
  readonly id: ImmutableColumn<string>;
  readonly batch_id: ImmutableColumn<string>;
  readonly actor_user_id: ImmutableColumn<string>;
  readonly request_hash: ImmutableColumn<string>;
  readonly status: Generated<RecognitionSessionStatus>;
  readonly photo_count: number;
  /** Validated observations, never trusted matches. */
  readonly local_codes: JsonArrayColumn;
  readonly model_manifest: JSONColumnType<JsonObject, string | undefined, string>;
  readonly selected_candidate_id: string | null;
  readonly committed_item_id: string | null;
  /** A stable code. Never a model, OCR or driver message. */
  readonly failure_code: string | null;
  readonly created_at: GeneratedImmutableColumn<Date>;
  readonly updated_at: Generated<Date>;
  readonly expires_at: Date;
}

export interface StockRecognitionImagesTable {
  readonly id: ImmutableColumn<string>;
  readonly session_id: ImmutableColumn<string>;
  readonly ordinal: ImmutableColumn<number>;
  readonly object_key: ImmutableColumn<string>;
  readonly sha256: string;
  readonly media_type: "image/jpeg" | "image/webp";
  readonly byte_length: number;
  readonly width: number;
  readonly height: number;
  readonly status: Generated<RecognitionImageStatus>;
  /** Versioned float16 query vector, discarded with the rest of the evidence. */
  readonly embedding: Buffer | null;
  readonly embedding_model: string | null;
  readonly crop_metadata: JSONColumnType<JsonObject, string | undefined, string>;
  readonly delete_after: Date;
  readonly deleted_at: Date | null;
  readonly created_at: GeneratedImmutableColumn<Date>;
}

export interface StockRecognitionCandidatesTable {
  readonly id: ImmutableColumn<string>;
  readonly session_id: ImmutableColumn<string>;
  readonly rank: number;
  readonly kind: RecognitionCandidateKind;
  readonly item_id: string | null;
  readonly identity: JSONColumnType<JsonObject, string | undefined, string>;
  readonly confidence_band: RecognitionConfidenceBand;
  /** Internal ordering only. Never shown to a person as a probability. */
  readonly fusion_score: number;
  readonly evidence: JsonArrayColumn;
  readonly model_manifest: JSONColumnType<JsonObject, string | undefined, string>;
  readonly created_at: GeneratedImmutableColumn<Date>;
}

/** The durable queue ADR 0004 specifies. Claimed with `for update skip locked`. */
export interface StockRecognitionJobsTable {
  readonly id: ImmutableColumn<string>;
  readonly session_id: string | null;
  readonly job_type: ImmutableColumn<RecognitionJobType>;
  readonly payload_version: ImmutableColumn<number>;
  readonly payload: JSONColumnType<JsonObject, string | undefined, string>;
  readonly status: Generated<RecognitionJobStatus>;
  readonly deduplication_key: ImmutableColumn<string>;
  readonly attempt_count: Generated<number>;
  readonly max_attempts: number;
  readonly available_at: Generated<Date>;
  readonly lease_owner: string | null;
  readonly leased_until: Date | null;
  readonly last_error_code: string | null;
  readonly created_at: GeneratedImmutableColumn<Date>;
  readonly updated_at: Generated<Date>;
  readonly completed_at: Date | null;
}

/** Only a human-confirmed result creates one of these. */
export interface ItemVisualExamplesTable {
  readonly id: ImmutableColumn<string>;
  readonly item_id: ImmutableColumn<string>;
  readonly embedding: ImmutableColumn<Buffer>;
  readonly embedding_model: ImmutableColumn<string>;
  readonly crop_object_key: string | null;
  readonly source_session_id: string | null;
  readonly source_image_id: string | null;
  readonly verified_by_user_id: ImmutableColumn<string>;
  readonly quality_score: number;
  readonly created_at: GeneratedImmutableColumn<Date>;
  /** Soft retirement, so a model upgrade does not delete provenance. */
  readonly retired_at: Date | null;
}

export interface StockCaptureEntriesTable {
  readonly id: ImmutableColumn<string>;
  readonly batch_id: ImmutableColumn<string>;
  readonly session_id: ImmutableColumn<string>;
  readonly actor_user_id: ImmutableColumn<string>;
  readonly request_hash: ImmutableColumn<string>;
  readonly status: Generated<StockCaptureEntryStatus>;
  readonly item_id: string | null;
  readonly transaction_id: string | null;
  readonly created_item: boolean | null;
  readonly created_at: GeneratedImmutableColumn<Date>;
  readonly committed_at: Date | null;
}

/** Telemetry for a later offline calibration release. Holds no raw model text. */
export interface RecognitionFeedbackTable {
  readonly id: ImmutableColumn<string>;
  readonly session_id: ImmutableColumn<string>;
  readonly actor_user_id: ImmutableColumn<string>;
  readonly outcome: ImmutableColumn<RecognitionFeedbackOutcome>;
  readonly selected_rank: ImmutableColumn<number | null>;
  readonly final_item_id: ImmutableColumn<string | null>;
  readonly corrected_fields: JsonArrayColumn;
  readonly shown_candidate_ids: JsonArrayColumn;
  readonly stage_availability: JSONColumnType<JsonObject, string | undefined, string>;
  readonly timings: JSONColumnType<JsonObject, string | undefined, string>;
  readonly model_manifest: JSONColumnType<JsonObject, string | undefined, string>;
  readonly created_at: GeneratedImmutableColumn<Date>;
}

export interface StockControlDatabase {
  readonly item_visual_examples: ItemVisualExamplesTable;
  readonly items: ItemsTable;
  readonly job_assignments: JobAssignmentsTable;
  readonly jobs: JobsTable;
  readonly locations: LocationsTable;
  readonly maps: MapsTable;
  readonly map_edit_events: MapEditEventsTable;
  readonly floor_plan_documents: FloorPlanDocumentsTable;
  readonly user_profile_photos: UserProfilePhotosTable;
  readonly item_photos: ItemPhotosTable;
  readonly migration_integrity: MigrationIntegrityTable;
  readonly mcp_command_receipts: McpCommandReceiptsTable;
  readonly mcp_effect_links: McpEffectLinksTable;
  readonly mcp_tool_call_events: McpToolCallEventsTable;
  readonly mcp_tool_calls: McpToolCallsTable;
  readonly oauth_grant_events: OAuthGrantEventsTable;
  readonly oauth_authorization_requests: OAuthAuthorizationRequestsTable;
  readonly oauth_refresh_tokens: OAuthRefreshTokensTable;
  readonly oauth_grants: OAuthGrantsTable;
  readonly recognition_feedback: RecognitionFeedbackTable;
  readonly reservations: ReservationsTable;
  readonly sessions: SessionsTable;
  readonly stock_capture_batches: StockCaptureBatchesTable;
  readonly stock_capture_entries: StockCaptureEntriesTable;
  readonly stock_levels: StockLevelsTable;
  readonly stock_recognition_candidates: StockRecognitionCandidatesTable;
  readonly stock_recognition_images: StockRecognitionImagesTable;
  readonly stock_recognition_jobs: StockRecognitionJobsTable;
  readonly stock_recognition_sessions: StockRecognitionSessionsTable;
  readonly stock_requests: StockRequestsTable;
  readonly system_metadata: SystemMetadataTable;
  readonly transactions: TransactionsTable;
  readonly users: UsersTable;
}
