import { createChecksummedMigration, type CanonicalMigrationDefinition } from "./integrity";

export const foundationMigrationDefinition = Object.freeze({
  name: "0001_foundation",
  version: 1,
  upStatements: Object.freeze([
    "create schema if not exists stockcontrol",
    `
      create table stockcontrol.migration_integrity (
        migration_name varchar(255) primary key,
        migration_version integer not null check (migration_version > 0),
        checksum char(64) not null check (checksum ~ '^[0-9a-f]{64}$'),
        recorded_at timestamptz not null default now()
      )
    `,
    `
      create table stockcontrol.system_metadata (
        key varchar(200) primary key,
        value jsonb not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `,
  ]),
  downStatements: Object.freeze(["drop schema stockcontrol cascade"]),
} satisfies CanonicalMigrationDefinition);

const foundation = createChecksummedMigration(foundationMigrationDefinition);

export const foundationMigration = foundation.migration;
export const foundationMigrationIntegrity = foundation.descriptor;
