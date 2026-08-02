import { createChecksummedMigration, type CanonicalMigrationDefinition } from "./integrity";

export const photosMigrationDefinition = Object.freeze({
  name: "0005_photos",
  version: 5,
  upStatements: Object.freeze([
    `
      create table stockcontrol.user_profile_photos (
        id uuid primary key,
        user_id uuid not null references stockcontrol.users (id) on delete restrict,
        object_key varchar(512) not null,
        original_file_name varchar(240) not null,
        media_type varchar(40) not null check (media_type in ('image/png', 'image/jpeg')),
        byte_length bigint not null check (byte_length > 0),
        sha256 char(64) not null check (sha256 ~ '^[0-9a-f]{64}$'),
        created_at timestamptz not null default now()
      )
    `,
    "create unique index user_profile_photos_user_id_key on stockcontrol.user_profile_photos (user_id)",
    "create unique index user_profile_photos_object_key on stockcontrol.user_profile_photos (object_key)",
    `
      create table stockcontrol.item_photos (
        id uuid primary key,
        item_id uuid not null references stockcontrol.items (id) on delete restrict,
        object_key varchar(512) not null,
        original_file_name varchar(240) not null,
        media_type varchar(40) not null check (media_type in ('image/png', 'image/jpeg')),
        byte_length bigint not null check (byte_length > 0),
        sha256 char(64) not null check (sha256 ~ '^[0-9a-f]{64}$'),
        display_order integer not null check (display_order >= 0),
        created_by_user_id uuid not null references stockcontrol.users (id) on delete restrict,
        created_at timestamptz not null default now()
      )
    `,
    "create unique index item_photos_item_order_key on stockcontrol.item_photos (item_id, display_order)",
    "create unique index item_photos_object_key on stockcontrol.item_photos (object_key)",
    "create index item_photos_item_id_idx on stockcontrol.item_photos (item_id, display_order)",
  ]),
  downStatements: Object.freeze([
    "drop table if exists stockcontrol.item_photos",
    "drop table if exists stockcontrol.user_profile_photos",
  ]),
} satisfies CanonicalMigrationDefinition);

const photos = createChecksummedMigration(photosMigrationDefinition);

export const photosMigration = photos.migration;
export const photosMigrationIntegrity = photos.descriptor;
