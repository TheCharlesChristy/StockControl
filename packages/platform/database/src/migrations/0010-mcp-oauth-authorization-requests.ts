import { createChecksummedMigration, type CanonicalMigrationDefinition } from "./integrity";

export const mcpOAuthAuthorizationRequestsMigrationDefinition = Object.freeze({
  name: "0010_mcp_oauth_authorization_requests",
  version: 10,
  upStatements: Object.freeze([
    `
      create table stockcontrol.oauth_authorization_requests (
        id uuid primary key,
        user_id uuid not null references stockcontrol.users (id) on delete restrict,
        client_id varchar(160) not null,
        redirect_uri varchar(2048) not null,
        state varchar(512),
        requested_scopes jsonb not null default '[]'::jsonb,
        code_challenge varchar(128) not null,
        code_challenge_method varchar(16) not null,
        authorization_code_hash char(64),
        expires_at timestamptz not null,
        approved_at timestamptz,
        consumed_at timestamptz,
        created_at timestamptz not null default now(),
        constraint oauth_authorization_requests_scopes_array check (jsonb_typeof(requested_scopes) = 'array'),
        constraint oauth_authorization_requests_pkce check (code_challenge_method = 'S256')
      )
    `,
    "create unique index oauth_authorization_requests_code_idx on stockcontrol.oauth_authorization_requests (authorization_code_hash) where authorization_code_hash is not null",
    "create index oauth_authorization_requests_user_idx on stockcontrol.oauth_authorization_requests (user_id, created_at desc)",
    "create index oauth_authorization_requests_expiry_idx on stockcontrol.oauth_authorization_requests (expires_at) where consumed_at is null",
  ]),
  downStatements: Object.freeze(["drop table if exists stockcontrol.oauth_authorization_requests"]),
} satisfies CanonicalMigrationDefinition);

const checkedMigration = createChecksummedMigration(
  mcpOAuthAuthorizationRequestsMigrationDefinition,
);

export const mcpOAuthAuthorizationRequestsMigration = checkedMigration.migration;
export const mcpOAuthAuthorizationRequestsMigrationIntegrity = checkedMigration.descriptor;
