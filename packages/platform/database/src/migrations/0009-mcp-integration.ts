import { createChecksummedMigration, type CanonicalMigrationDefinition } from "./integrity";

/**
 * Durable state for the private ChatGPT MCP connection. OAuth grant state is
 * mutable; every other table in this migration is append-only and receives no
 * update or delete privilege in the runtime role.
 */
export const mcpIntegrationMigrationDefinition = Object.freeze({
  name: "0009_mcp_integration",
  version: 9,
  upStatements: Object.freeze([
    `
      create table stockcontrol.oauth_grants (
        id uuid primary key,
        user_id uuid not null references stockcontrol.users (id) on delete restrict,
        client_id varchar(160) not null,
        redirect_uri varchar(2048) not null,
        granted_scopes jsonb not null default '[]'::jsonb,
        authorization_code_hash char(64),
        authorization_code_challenge varchar(128),
        authorization_code_method varchar(16),
        authorization_code_expires_at timestamptz,
        authorization_code_used_at timestamptz,
        access_token_hash char(64),
        access_token_expires_at timestamptz,
        refresh_token_hash char(64),
        refresh_token_expires_at timestamptz,
        revoked_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint oauth_grants_scopes_array check (jsonb_typeof(granted_scopes) = 'array'),
        constraint oauth_grants_code_pairing check (
          (authorization_code_hash is null and authorization_code_expires_at is null)
          or (authorization_code_hash is not null and authorization_code_expires_at is not null)
        )
      )
    `,
    "create unique index oauth_grants_access_token_hash on stockcontrol.oauth_grants (access_token_hash) where access_token_hash is not null",
    "create unique index oauth_grants_refresh_token_hash on stockcontrol.oauth_grants (refresh_token_hash) where refresh_token_hash is not null",
    "create index oauth_grants_user_idx on stockcontrol.oauth_grants (user_id, created_at desc)",
    "create index oauth_grants_expiry_idx on stockcontrol.oauth_grants (access_token_expires_at) where revoked_at is null",
    `
      create table stockcontrol.oauth_grant_events (
        id uuid primary key,
        grant_id uuid not null references stockcontrol.oauth_grants (id) on delete restrict,
        user_id uuid not null references stockcontrol.users (id) on delete restrict,
        event_type varchar(24) not null check (event_type in ('Connected', 'Reauthorised', 'ScopeChanged', 'Revoked', 'Refreshed')),
        scopes jsonb not null default '[]'::jsonb,
        occurred_at timestamptz not null default now(),
        constraint oauth_grant_events_scopes_array check (jsonb_typeof(scopes) = 'array')
      )
    `,
    "create index oauth_grant_events_grant_idx on stockcontrol.oauth_grant_events (grant_id, occurred_at desc)",
    `
      create table stockcontrol.mcp_tool_calls (
        id uuid primary key,
        correlation_id varchar(128) not null,
        actor_user_id uuid references stockcontrol.users (id) on delete restrict,
        oauth_grant_id uuid references stockcontrol.oauth_grants (id) on delete restrict,
        tool_name varchar(120) not null,
        contract_version varchar(32) not null,
        operation varchar(8) not null check (operation in ('read', 'write')),
        arguments jsonb not null default '{}'::jsonb,
        arguments_sha256 char(64) not null check (arguments_sha256 ~ '^[0-9a-f]{64}$'),
        action_summary varchar(300),
        client_request_id varchar(200),
        received_at timestamptz not null default now(),
        constraint mcp_tool_calls_arguments_object check (jsonb_typeof(arguments) = 'object')
      )
    `,
    "create index mcp_tool_calls_received_idx on stockcontrol.mcp_tool_calls (received_at desc)",
    "create index mcp_tool_calls_actor_idx on stockcontrol.mcp_tool_calls (actor_user_id, received_at desc)",
    "create index mcp_tool_calls_tool_idx on stockcontrol.mcp_tool_calls (tool_name, received_at desc)",
    "create index mcp_tool_calls_grant_idx on stockcontrol.mcp_tool_calls (oauth_grant_id, received_at desc)",
    `
      create table stockcontrol.mcp_tool_call_events (
        id uuid primary key,
        call_id uuid not null references stockcontrol.mcp_tool_calls (id) on delete restrict,
        actor_user_id uuid references stockcontrol.users (id) on delete restrict,
        oauth_grant_id uuid references stockcontrol.oauth_grants (id) on delete restrict,
        event_type varchar(16) not null check (event_type in ('Received', 'Authorised', 'Denied', 'Succeeded', 'Failed', 'Interrupted')),
        occurred_at timestamptz not null default now(),
        failure_code varchar(120),
        duration_ms integer check (duration_ms is null or duration_ms >= 0),
        result_summary jsonb not null default '{}'::jsonb,
        record_count integer check (record_count is null or record_count >= 0),
        record_types jsonb not null default '[]'::jsonb,
        response_digest char(64),
        constraint mcp_tool_call_events_summary_object check (jsonb_typeof(result_summary) = 'object'),
        constraint mcp_tool_call_events_types_array check (jsonb_typeof(record_types) = 'array'),
        constraint mcp_tool_call_events_digest check (response_digest is null or response_digest ~ '^[0-9a-f]{64}$')
      )
    `,
    "create index mcp_tool_call_events_call_idx on stockcontrol.mcp_tool_call_events (call_id, occurred_at)",
    "create index mcp_tool_call_events_actor_idx on stockcontrol.mcp_tool_call_events (actor_user_id, occurred_at desc)",
    "create index mcp_tool_call_events_outcome_idx on stockcontrol.mcp_tool_call_events (event_type, occurred_at desc)",
    `
      create table stockcontrol.mcp_effect_links (
        id uuid primary key,
        call_id uuid not null references stockcontrol.mcp_tool_calls (id) on delete restrict,
        effect_type varchar(32) not null,
        effect_id uuid not null,
        linked_at timestamptz not null default now(),
        constraint mcp_effect_links_effect_type check (effect_type in ('transaction', 'reservation', 'request', 'job', 'item', 'location'))
      )
    `,
    "create unique index mcp_effect_links_unique_effect on stockcontrol.mcp_effect_links (call_id, effect_type, effect_id)",
    "create index mcp_effect_links_effect_idx on stockcontrol.mcp_effect_links (effect_type, effect_id)",
    `
      create table stockcontrol.mcp_command_receipts (
        id uuid primary key,
        actor_user_id uuid not null references stockcontrol.users (id) on delete restrict,
        tool_name varchar(120) not null,
        idempotency_key varchar(200) not null,
        request_fingerprint char(64) not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
        call_id uuid not null references stockcontrol.mcp_tool_calls (id) on delete restrict,
        result jsonb not null default '{}'::jsonb,
        result_digest char(64) not null check (result_digest ~ '^[0-9a-f]{64}$'),
        committed_at timestamptz not null default now(),
        constraint mcp_command_receipts_result_object check (jsonb_typeof(result) = 'object'),
        constraint mcp_command_receipts_key_scope unique (actor_user_id, tool_name, idempotency_key)
      )
    `,
    "create index mcp_command_receipts_call_idx on stockcontrol.mcp_command_receipts (call_id)",
    "create index mcp_command_receipts_committed_idx on stockcontrol.mcp_command_receipts (committed_at desc)",
  ]),
  downStatements: Object.freeze([
    "drop table if exists stockcontrol.mcp_command_receipts",
    "drop table if exists stockcontrol.mcp_effect_links",
    "drop table if exists stockcontrol.mcp_tool_call_events",
    "drop table if exists stockcontrol.mcp_tool_calls",
    "drop table if exists stockcontrol.oauth_grant_events",
    "drop table if exists stockcontrol.oauth_grants",
  ]),
} satisfies CanonicalMigrationDefinition);

const checkedMcpIntegrationMigration = createChecksummedMigration(
  mcpIntegrationMigrationDefinition,
);

export const mcpIntegrationMigration = checkedMcpIntegrationMigration.migration;
export const mcpIntegrationMigrationIntegrity = checkedMcpIntegrationMigration.descriptor;
