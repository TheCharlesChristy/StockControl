import { createChecksummedMigration, type CanonicalMigrationDefinition } from "./integrity";

/**
 * Adds the authoritative physical hierarchy and the current visual overlay.
 * The fixed backfill IDs make a deployment's initial Branch and Building
 * deterministic without changing any existing Store or JobSite identity.
 */
export const locationsMapsMigrationDefinition = Object.freeze({
  name: "0004_locations_maps",
  version: 4,
  upStatements: Object.freeze([
    "alter table stockcontrol.locations add column node_kind varchar(20) not null default 'CustomSection'",
    "alter table stockcontrol.locations add column operational_kind varchar(20) not null default 'Storage'",
    "alter table stockcontrol.locations add column parent_id uuid references stockcontrol.locations (id) on delete restrict",
    "alter table stockcontrol.locations add column building_id uuid references stockcontrol.locations (id) on delete restrict",
    "alter table stockcontrol.locations add column general_fulfilment_enabled boolean not null default false",
    "alter table stockcontrol.locations add column archived_at timestamptz",
    "alter table stockcontrol.locations add constraint locations_parent_not_self check (parent_id is null or parent_id <> id)",
    "alter table stockcontrol.locations add constraint locations_node_kind_valid check (node_kind in ('Branch', 'Building', 'Area', 'Aisle', 'Shelf', 'Bin', 'CustomSection', 'JobSite'))",
    "alter table stockcontrol.locations add constraint locations_operational_kind_valid check (operational_kind in ('Container', 'Storage', 'Quarantine', 'Repair', 'Transit', 'VirtualJobSite'))",
    "update stockcontrol.locations set node_kind = 'JobSite', operational_kind = 'VirtualJobSite' where kind = 'JobSite'",
    "update stockcontrol.locations set node_kind = 'Branch', operational_kind = 'Container', general_fulfilment_enabled = false where id = '00000000-0000-4000-8000-000000000001'",
    "insert into stockcontrol.locations (id, code, name, kind, job_id, is_active, node_kind, operational_kind, general_fulfilment_enabled) values ('00000000-0000-4000-8000-000000000001', 'BRANCH-001', 'Main Branch', 'Store', null, true, 'Branch', 'Container', false) on conflict (id) do nothing",
    "insert into stockcontrol.locations (id, code, name, kind, job_id, is_active, node_kind, operational_kind, parent_id, building_id, general_fulfilment_enabled) values ('00000000-0000-4000-8000-000000000002', 'BUILDING-001', 'Main Store', 'Store', null, true, 'Building', 'Container', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', false) on conflict (id) do nothing",
    "update stockcontrol.locations set parent_id = '00000000-0000-4000-8000-000000000002', building_id = '00000000-0000-4000-8000-000000000002', operational_kind = 'Storage', general_fulfilment_enabled = true where kind = 'Store' and id not in ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002')",
    "alter table stockcontrol.locations add constraint locations_hierarchy_job_shape check ((kind = 'JobSite' and job_id is not null) or (kind = 'Store' and node_kind <> 'JobSite' and operational_kind <> 'VirtualJobSite'))",
    "alter table stockcontrol.locations add constraint locations_id_node_kind_key unique (id, node_kind)",
    "create index locations_parent_id_idx on stockcontrol.locations (parent_id)",
    "create index locations_building_id_idx on stockcontrol.locations (building_id)",
    "create index locations_operational_active_idx on stockcontrol.locations (operational_kind, is_active)",
    "create table stockcontrol.floor_plan_documents (id uuid primary key, object_key varchar(512) not null, original_file_name varchar(240) not null, media_type varchar(40) not null check (media_type in ('image/png', 'image/jpeg')), byte_length bigint not null check (byte_length > 0), sha256 char(64) not null check (sha256 ~ '^[0-9a-f]{64}$'), created_by_user_id uuid not null references stockcontrol.users (id) on delete restrict, created_at timestamptz not null default now())",
    "create unique index floor_plan_documents_object_key on stockcontrol.floor_plan_documents (object_key)",
    "create index floor_plan_documents_creator_idx on stockcontrol.floor_plan_documents (created_by_user_id, created_at desc)",
    "create table stockcontrol.building_maps (id uuid primary key, building_location_id uuid not null, building_node_kind varchar(20) not null default 'Building' check (building_node_kind = 'Building'), background_kind varchar(20) not null default 'Blank' check (background_kind in ('Blank', 'FloorPlan')), background_asset_id uuid references stockcontrol.floor_plan_documents (id) on delete restrict, background_metadata jsonb not null default '{}'::jsonb, status varchar(20) not null default 'Active' check (status in ('Active', 'Archived')), revision integer not null default 0 check (revision >= 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), constraint building_maps_building_fk foreign key (building_location_id, building_node_kind) references stockcontrol.locations (id, node_kind) on delete restrict)",
    "create unique index building_maps_building_key on stockcontrol.building_maps (building_location_id)",
    "create index building_maps_active_idx on stockcontrol.building_maps (status) where status = 'Active'",
    "create table stockcontrol.map_regions (id uuid primary key, map_id uuid not null references stockcontrol.building_maps (id) on delete restrict, hierarchy_location_id uuid not null references stockcontrol.locations (id) on delete restrict, parent_region_id uuid, display_name varchar(120) not null, geometry jsonb not null, z_order integer not null, search_aliases jsonb not null default '[]'::jsonb, status varchar(20) not null default 'Active' check (status in ('Active', 'Archived')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), constraint map_regions_parent_not_self check (parent_region_id is null or parent_region_id <> id))",
    "create unique index map_regions_map_id_id_key on stockcontrol.map_regions (map_id, id)",
    "alter table stockcontrol.map_regions add constraint map_regions_parent_same_map_fk foreign key (map_id, parent_region_id) references stockcontrol.map_regions (map_id, id) on delete restrict",
    "create index map_regions_map_order_idx on stockcontrol.map_regions (map_id, z_order, id)",
    "create index map_regions_hierarchy_location_idx on stockcontrol.map_regions (hierarchy_location_id)",
    "create index map_regions_parent_idx on stockcontrol.map_regions (parent_region_id)",
    "create table stockcontrol.map_edit_events (id uuid primary key, map_id uuid not null references stockcontrol.building_maps (id) on delete restrict, actor_user_id uuid not null references stockcontrol.users (id) on delete restrict, action varchar(80) not null, before_state jsonb, after_state jsonb, reason varchar(500), occurred_at timestamptz not null default now())",
    "create index map_edit_events_map_time_idx on stockcontrol.map_edit_events (map_id, occurred_at desc)",
    "create index map_edit_events_actor_time_idx on stockcontrol.map_edit_events (actor_user_id, occurred_at desc)",
  ]),
  downStatements: Object.freeze([
    "drop table if exists stockcontrol.map_edit_events",
    "drop table if exists stockcontrol.map_regions",
    "drop table if exists stockcontrol.building_maps",
    "drop table if exists stockcontrol.floor_plan_documents",
    "drop index if exists stockcontrol.locations_operational_active_idx",
    "drop index if exists stockcontrol.locations_building_id_idx",
    "drop index if exists stockcontrol.locations_parent_id_idx",
    "alter table stockcontrol.locations drop constraint if exists locations_hierarchy_job_shape",
    "alter table stockcontrol.locations drop constraint if exists locations_id_node_kind_key",
    "alter table stockcontrol.locations drop constraint if exists locations_operational_kind_valid",
    "alter table stockcontrol.locations drop constraint if exists locations_node_kind_valid",
    "alter table stockcontrol.locations drop constraint if exists locations_parent_not_self",
    "alter table stockcontrol.locations drop column if exists archived_at",
    "alter table stockcontrol.locations drop column if exists general_fulfilment_enabled",
    "alter table stockcontrol.locations drop column if exists building_id",
    "alter table stockcontrol.locations drop column if exists parent_id",
    "alter table stockcontrol.locations drop column if exists operational_kind",
    "alter table stockcontrol.locations drop column if exists node_kind",
  ]),
} satisfies CanonicalMigrationDefinition);

const migration = createChecksummedMigration(locationsMapsMigrationDefinition);
export const locationsMapsMigration = migration.migration;
export const locationsMapsMigrationIntegrity = migration.descriptor;
