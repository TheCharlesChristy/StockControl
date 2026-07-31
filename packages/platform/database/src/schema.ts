import type { ColumnType, Generated, JSONColumnType } from "kysely";

export const STOCKCONTROL_SCHEMA = "stockcontrol";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonObject | JsonPrimitive | readonly JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type ImmutableColumn<Value> = ColumnType<Value, Value, never>;
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
export type JobStatus = "Open" | "Closed";
export type ReservationStatus = "Open" | "Fulfilled" | "Released";
export type TransactionKind =
  "Receive" | "Issue" | "Transfer" | "Adjust" | "Reserve" | "Collect" | "Release";

export interface UsersTable {
  readonly id: ImmutableColumn<string>;
  readonly email: string;
  readonly display_name: string;
  readonly role: UserRole;
  readonly password_hash: string;
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
  readonly created_at: GeneratedImmutableColumn<Date>;
  readonly updated_at: Generated<Date>;
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

export interface StockControlDatabase {
  readonly items: ItemsTable;
  readonly jobs: JobsTable;
  readonly locations: LocationsTable;
  readonly migration_integrity: MigrationIntegrityTable;
  readonly reservations: ReservationsTable;
  readonly sessions: SessionsTable;
  readonly stock_levels: StockLevelsTable;
  readonly system_metadata: SystemMetadataTable;
  readonly transactions: TransactionsTable;
  readonly users: UsersTable;
}
