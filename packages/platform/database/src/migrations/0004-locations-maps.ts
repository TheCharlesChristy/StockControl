import { createChecksummedMigration, type CanonicalMigrationDefinition } from "./integrity";

/**
 * Puts the visual map in charge of locations. A map is a standalone canvas; a
 * location is a shape drawn on one. There is no stored hierarchy to keep in
 * step with the picture — `derived_parent_id` is recomputed from the geometry
 * whenever a map is saved, so the tree the application queries is always the
 * one the user can see. Location identity is untouched, which is what keeps
 * every existing stock level, transaction and reservation valid.
 */
export const locationsMapsMigrationDefinition = Object.freeze({
  name: "0004_locations_maps",
  version: 4,
  upStatements: Object.freeze([
    "create table stockcontrol.floor_plan_documents (id uuid primary key, object_key varchar(512) not null, original_file_name varchar(240) not null, media_type varchar(40) not null check (media_type in ('image/png', 'image/jpeg')), byte_length bigint not null check (byte_length > 0), sha256 char(64) not null check (sha256 ~ '^[0-9a-f]{64}$'), created_by_user_id uuid not null references stockcontrol.users (id) on delete restrict, created_at timestamptz not null default now())",
    "create unique index floor_plan_documents_object_key on stockcontrol.floor_plan_documents (object_key)",
    "create index floor_plan_documents_creator_idx on stockcontrol.floor_plan_documents (created_by_user_id, created_at desc)",
    "create table stockcontrol.maps (id uuid primary key, code varchar(40) not null, name varchar(200) not null, background_kind varchar(20) not null default 'Blank' check (background_kind in ('Blank', 'FloorPlan')), background_asset_id uuid references stockcontrol.floor_plan_documents (id) on delete restrict, background_metadata jsonb not null default '{}'::jsonb, status varchar(20) not null default 'Active' check (status in ('Active', 'Archived')), revision integer not null default 0 check (revision >= 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now())",
    "create unique index maps_code_key on stockcontrol.maps (code)",
    "create index maps_active_idx on stockcontrol.maps (status) where status = 'Active'",
    "alter table stockcontrol.locations add column map_id uuid references stockcontrol.maps (id) on delete restrict",
    "alter table stockcontrol.locations add column geometry jsonb",
    "alter table stockcontrol.locations add column z_order integer not null default 0",
    "alter table stockcontrol.locations add column search_aliases jsonb not null default '[]'::jsonb",
    "alter table stockcontrol.locations add column archived_at timestamptz",
    "alter table stockcontrol.locations add column derived_parent_id uuid references stockcontrol.locations (id) on delete set null",
    "alter table stockcontrol.locations add constraint locations_parent_not_self check (derived_parent_id is null or derived_parent_id <> id)",
    "alter table stockcontrol.locations add constraint locations_placement_complete check ((map_id is null and geometry is null) or (map_id is not null and geometry is not null))",
    "alter table stockcontrol.locations add constraint locations_unplaced_has_no_parent check (map_id is not null or derived_parent_id is null)",
    "create index locations_map_order_idx on stockcontrol.locations (map_id, z_order, id)",
    "create index locations_derived_parent_idx on stockcontrol.locations (derived_parent_id)",
    "create index locations_active_idx on stockcontrol.locations (kind, is_active)",
    "create table stockcontrol.map_edit_events (id uuid primary key, map_id uuid not null references stockcontrol.maps (id) on delete restrict, actor_user_id uuid not null references stockcontrol.users (id) on delete restrict, action varchar(80) not null, before_state jsonb, after_state jsonb, reason varchar(500), occurred_at timestamptz not null default now())",
    "create index map_edit_events_map_time_idx on stockcontrol.map_edit_events (map_id, occurred_at desc)",
    "create index map_edit_events_actor_time_idx on stockcontrol.map_edit_events (actor_user_id, occurred_at desc)",
  ]),
  downStatements: Object.freeze([
    "drop table if exists stockcontrol.map_edit_events",
    "drop index if exists stockcontrol.locations_active_idx",
    "drop index if exists stockcontrol.locations_derived_parent_idx",
    "drop index if exists stockcontrol.locations_map_order_idx",
    "alter table stockcontrol.locations drop constraint if exists locations_unplaced_has_no_parent",
    "alter table stockcontrol.locations drop constraint if exists locations_placement_complete",
    "alter table stockcontrol.locations drop constraint if exists locations_parent_not_self",
    "alter table stockcontrol.locations drop column if exists derived_parent_id",
    "alter table stockcontrol.locations drop column if exists archived_at",
    "alter table stockcontrol.locations drop column if exists search_aliases",
    "alter table stockcontrol.locations drop column if exists z_order",
    "alter table stockcontrol.locations drop column if exists geometry",
    "alter table stockcontrol.locations drop column if exists map_id",
    "drop table if exists stockcontrol.maps",
    "drop table if exists stockcontrol.floor_plan_documents",
  ]),
} satisfies CanonicalMigrationDefinition);

const migration = createChecksummedMigration(locationsMapsMigrationDefinition);
export const locationsMapsMigration = migration.migration;
export const locationsMapsMigrationIntegrity = migration.descriptor;
