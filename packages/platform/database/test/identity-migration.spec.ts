import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rawSql = vi.hoisted(() => {
  const executions: Array<{
    readonly statement: string;
    readonly execute: ReturnType<typeof vi.fn>;
  }> = [];

  return {
    executions,
    raw: vi.fn((statement: string) => {
      const query = {
        statement,
        execute: vi.fn().mockResolvedValue(undefined),
      };
      executions.push(query);
      return query;
    }),
  };
});

vi.mock("kysely", () => ({
  sql: {
    raw: rawSql.raw,
  },
}));

import {
  identityMigration,
  identityMigrationDefinition,
  identityMigrationIntegrity,
} from "../src/migrations/0002-identity";
import {
  checksumMigrationDefinition,
  createChecksummedMigration,
} from "../src/migrations/integrity";

describe("identity migration", () => {
  const database = { name: "identity-test" } as unknown as Kysely<unknown>;

  beforeEach(() => {
    rawSql.executions.length = 0;
    rawSql.raw.mockClear();
  });

  it("contains all identity stores and its security-critical constraints", () => {
    const sqlText = identityMigrationDefinition.upStatements.join("\n");

    for (const table of [
      "identity_users",
      "identity_password_credentials",
      "identity_totp_credentials",
      "identity_recovery_codes",
      "identity_permission_overrides",
      "identity_sessions",
      "identity_auth_challenges",
      "identity_invitations",
      "identity_password_resets",
      "identity_rate_limit_buckets",
      "identity_security_policy",
      "identity_mfa_recovery_requests",
      "identity_bootstrap_state",
      "identity_audit_events",
    ]) {
      expect(sqlText).toContain(`stockcontrol.${table}`);
    }

    expect(sqlText).toContain("normalised_email = lower(btrim(normalised_email))");
    expect(sqlText).toContain("octet_length(token_hash) = 32");
    expect(sqlText).toContain("identity_audit_events_append_only");
    expect(sqlText).toContain("integrity_version smallint not null");
    expect(sqlText).toContain("integrity_key_id varchar(100) not null");
    expect(sqlText).toContain("deferrable initially deferred");
    expect(sqlText).toContain("identity_final_capable_admin_required");
    expect(sqlText).not.toContain("create extension");
    expect(identityMigrationIntegrity.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fails closed on identity ownership, expiry, terminal-state, MFA, and session invariants", () => {
    const sqlText = identityMigrationDefinition.upStatements.join("\n");

    expect(sqlText).toContain("octet_length(secret_ciphertext) = 32");
    expect(sqlText).toContain("foreign key (totp_credential_id, user_id)");
    expect(sqlText).toContain("references stockcontrol.identity_totp_credentials(id, user_id)");
    expect(sqlText).toContain("recovery_codes_acknowledged_at >= verified_at");
    expect(sqlText).toContain("user_id uuid not null");
    expect(sqlText).toContain("consumed_at between created_at and expires_at");
    expect(sqlText).toContain("accepted_at between created_at and expires_at");
    expect(sqlText).toContain("completed_at between requested_at and expires_at");
    expect(sqlText).toContain("prevent_identity_terminal_record_mutation");
    expect(sqlText).toContain("enforce_identity_lifecycle_transition");
    expect(sqlText).toContain("enforce_identity_version_progression");
    expect(sqlText).toContain("version must advance by exactly one");
    expect(sqlText).toContain("prevent_identity_immutable_column_mutation");
    expect(sqlText).toContain("enforce_identity_security_state_progression");
    expect(sqlText).toContain("security state cannot regress");
    expect(sqlText).toContain("identity_active_session_user_required");
    expect(sqlText).toContain("identity_session_role_security_required");
    expect(sqlText).toContain("identity_active_totp_recovery_codes_required");
    expect(sqlText).toContain("identity_active_admin_security_required");
    expect(sqlText).toContain("absolute_expires_at <= issued_at + interval '12 hours'");
    expect(sqlText).toContain("idle_expires_at <= last_seen_at + interval '2 hours'");
    expect(sqlText.match(/create trigger identity_[a-z_]+_version_progression/g)).toHaveLength(11);
    expect(sqlText.match(/create trigger identity_[a-z_]+_immutable_columns/g)).toHaveLength(13);
    expect(
      sqlText.match(/create trigger identity_[a-z_]+_security_state_progression/g),
    ).toHaveLength(4);

    const rollbackSql = identityMigrationDefinition.downStatements.join("\n");
    expect(rollbackSql.match(/drop trigger identity_[a-z_]+_version_progression/g)).toHaveLength(
      11,
    );
    expect(rollbackSql.match(/drop trigger identity_[a-z_]+_immutable_columns/g)).toHaveLength(13);
    expect(
      rollbackSql.match(/drop trigger identity_[a-z_]+_security_state_progression/g),
    ).toHaveLength(4);
  });

  it("executes canonical up statements before recording the exact checksum", async () => {
    await identityMigration.up(database);

    expect(rawSql.executions).toHaveLength(identityMigrationDefinition.upStatements.length + 1);
    expect(rawSql.executions.map(({ statement }) => statement)).toEqual([
      ...identityMigrationDefinition.upStatements,
      expect.stringContaining(
        `values ('0002_identity', 1, '${identityMigrationIntegrity.checksum}')`,
      ),
    ]);
  });

  it("deletes its integrity record then rolls every object back in explicit order", async () => {
    if (identityMigration.down === undefined) {
      throw new Error("The identity migration must remain reversible.");
    }

    await identityMigration.down(database);

    expect(rawSql.executions.map(({ statement }) => statement)).toEqual([
      "delete from stockcontrol.migration_integrity where migration_name = '0002_identity'",
      ...identityMigrationDefinition.downStatements,
    ]);
    expect(identityMigrationDefinition.downStatements.at(-1)).toBe(
      "drop table stockcontrol.identity_users",
    );
  });

  it("changes its checksum when canonical SQL, name or version changes", () => {
    const baseline = checksumMigrationDefinition(identityMigrationDefinition);

    expect(
      checksumMigrationDefinition({
        ...identityMigrationDefinition,
        name: "0002_identity_changed",
      }),
    ).not.toBe(baseline);
    expect(
      checksumMigrationDefinition({
        ...identityMigrationDefinition,
        version: 2,
      }),
    ).not.toBe(baseline);
    expect(
      checksumMigrationDefinition({
        ...identityMigrationDefinition,
        upStatements: [...identityMigrationDefinition.upStatements, "select 1"],
      }),
    ).not.toBe(baseline);
  });

  it("stops immediately when a canonical statement fails", async () => {
    const migration = createChecksummedMigration({
      name: "failure_probe",
      version: 1,
      upStatements: ["select 1", "select 2"],
      downStatements: [],
    }).migration;
    rawSql.raw.mockImplementationOnce((statement: string) => ({
      statement,
      execute: vi.fn().mockRejectedValue(new Error("query failed")),
    }));

    await expect(migration.up(database)).rejects.toThrow("query failed");

    expect(rawSql.raw).toHaveBeenCalledTimes(1);
  });
});
