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

export interface StockControlDatabase {
  readonly migration_integrity: MigrationIntegrityTable;
  readonly system_metadata: SystemMetadataTable;
}
