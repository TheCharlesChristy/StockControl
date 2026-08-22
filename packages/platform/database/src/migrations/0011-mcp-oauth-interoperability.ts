import { createChecksummedMigration, type CanonicalMigrationDefinition } from "./integrity";

/** Additive OAuth/MCP state for already-deployed 0009/0010 databases. */
export const mcpOAuthInteroperabilityMigrationDefinition = Object.freeze({
  name: "0011_mcp_oauth_interoperability",
  version: 11,
  upStatements: Object.freeze([
    "alter table stockcontrol.oauth_authorization_requests alter column user_id drop not null",
    "alter table stockcontrol.oauth_authorization_requests add column resource_uri varchar(2048)",
    "alter table stockcontrol.oauth_authorization_requests add column approval_handle_hash char(64)",
    "alter table stockcontrol.oauth_authorization_requests add column authorization_code_expires_at timestamptz",
    "alter table stockcontrol.oauth_authorization_requests add column denied_at timestamptz",
    "create unique index oauth_authorization_requests_handle_idx on stockcontrol.oauth_authorization_requests (approval_handle_hash) where approval_handle_hash is not null",
    "create index oauth_authorization_requests_resource_idx on stockcontrol.oauth_authorization_requests (resource_uri, expires_at) where consumed_at is null",
    "alter table stockcontrol.oauth_grants add column resource_uri varchar(2048)",
    "update stockcontrol.oauth_grants set revoked_at = coalesce(revoked_at, now()), updated_at = now() where resource_uri is null and revoked_at is null",
    "create unique index oauth_grants_active_connection_idx on stockcontrol.oauth_grants (user_id, client_id, redirect_uri, resource_uri) where revoked_at is null and resource_uri is not null",
    "alter table stockcontrol.oauth_grant_events drop constraint if exists oauth_grant_events_event_type_check",
    "alter table stockcontrol.oauth_grant_events add constraint oauth_grant_events_event_type_check check (event_type in ('Connected', 'Reauthorised', 'ScopeChanged', 'Revoked', 'Refreshed', 'RefreshReplayDetected'))",
    `
      create table stockcontrol.oauth_refresh_tokens (
        id uuid primary key,
        grant_id uuid not null references stockcontrol.oauth_grants (id) on delete restrict,
        client_id varchar(160) not null,
        resource_uri varchar(2048) not null,
        token_hash char(64) not null unique,
        expires_at timestamptz not null,
        used_at timestamptz,
        revoked_at timestamptz,
        created_at timestamptz not null default now()
      )
    `,
    "create index oauth_refresh_tokens_grant_idx on stockcontrol.oauth_refresh_tokens (grant_id, created_at desc)",
    "create index oauth_refresh_tokens_expiry_idx on stockcontrol.oauth_refresh_tokens (expires_at) where used_at is null and revoked_at is null",
  ]),
  downStatements: Object.freeze([
    "drop table if exists stockcontrol.oauth_refresh_tokens",
    "drop index if exists stockcontrol.oauth_grants_active_connection_idx",
    "alter table stockcontrol.oauth_grant_events drop constraint if exists oauth_grant_events_event_type_check",
    "alter table stockcontrol.oauth_grant_events add constraint oauth_grant_events_event_type_check check (event_type in ('Connected', 'Reauthorised', 'ScopeChanged', 'Revoked', 'Refreshed'))",
    "alter table stockcontrol.oauth_grants drop column if exists resource_uri",
    "drop index if exists stockcontrol.oauth_authorization_requests_resource_idx",
    "drop index if exists stockcontrol.oauth_authorization_requests_handle_idx",
    "alter table stockcontrol.oauth_authorization_requests drop column if exists denied_at",
    "alter table stockcontrol.oauth_authorization_requests drop column if exists authorization_code_expires_at",
    "alter table stockcontrol.oauth_authorization_requests drop column if exists approval_handle_hash",
    "alter table stockcontrol.oauth_authorization_requests drop column if exists resource_uri",
    "delete from stockcontrol.oauth_authorization_requests where user_id is null",
    "alter table stockcontrol.oauth_authorization_requests alter column user_id set not null",
  ]),
} satisfies CanonicalMigrationDefinition);

const checkedMigration = createChecksummedMigration(mcpOAuthInteroperabilityMigrationDefinition);

export const mcpOAuthInteroperabilityMigration = checkedMigration.migration;
export const mcpOAuthInteroperabilityMigrationIntegrity = checkedMigration.descriptor;
