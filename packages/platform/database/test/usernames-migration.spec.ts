import { describe, expect, it } from "vitest";

import {
  usernamesMigrationDefinition,
  usernamesMigrationIntegrity,
} from "../src/migrations/0008-usernames";
import { MIGRATION_INTEGRITY_MANIFEST, MIGRATION_NAMES } from "../src/migrations/provider";

describe("usernames migration", () => {
  const upStatements = usernamesMigrationDefinition.upStatements;
  const upSql = upStatements.join("\n");
  const downSql = usernamesMigrationDefinition.downStatements.join("\n");

  const indexOfStatement = (fragment: string): number =>
    upStatements.findIndex((statement) => statement.includes(fragment));

  it("is the eighth canonical migration with a recorded checksum", () => {
    expect(usernamesMigrationDefinition).toMatchObject({
      name: "0008_usernames",
      version: 8,
    });
    expect(usernamesMigrationIntegrity).toEqual({
      name: "0008_usernames",
      version: 8,
      checksum: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
  });

  it("is registered in the provider and the integrity manifest", () => {
    expect(MIGRATION_NAMES).toContain("0008_usernames");
    expect(MIGRATION_INTEGRITY_MANIFEST["0008_usernames"]).toEqual(usernamesMigrationIntegrity);
  });

  it("gives every account a unique lowercase username", () => {
    expect(upSql).toContain("add column username varchar(32)");
    expect(upSql).toContain("alter column username set not null");
    expect(upSql).toContain("check (username = lower(username))");
    expect(upSql).toContain("create unique index users_username_key");
  });

  /*
   * A column that is NOT NULL before its backfill runs rejects every existing
   * row, so the order of these three statements is the migration working at
   * all rather than a matter of taste.
   */
  it("backfills before demanding that every row has a username", () => {
    expect(indexOfStatement("add column username")).toBeLessThan(indexOfStatement("do $$"));
    expect(indexOfStatement("do $$")).toBeLessThan(
      indexOfStatement("alter column username set not null"),
    );
  });

  it("takes the username from the address a person already signs in with", () => {
    expect(upSql).toContain("split_part(account.email, '@', 1)");
    expect(upSql).toContain("regexp_replace(base, '^[._-]+', '')");
    expect(upSql).toContain("left(base, 28)");
  });

  /*
   * Trimming a long local part can cut it mid-word and leave a trailing dot,
   * which the application's own username rule refuses — so the trailing trim
   * has to happen after the truncation, not before it.
   */
  it("trims a trailing separator left behind by the truncation", () => {
    expect(upSql.indexOf("left(base, 28)")).toBeLessThan(
      upSql.indexOf("regexp_replace(base, '[._-]+$', '')"),
    );
  });

  /*
   * `base || row_number()` looks equivalent and is not: `sam` derived from
   * `sam@…` and `sam1` derived from `sam1@…` both want `sam1`, and numbering
   * in one pass cannot see the clash it just created.
   */
  it("re-checks each candidate rather than numbering duplicates in one pass", () => {
    expect(upSql).toContain(
      "while exists (select 1 from stockcontrol.users where username = candidate)",
    );
    expect(upSql).not.toContain("row_number()");
  });

  it("lets an account exist without an email address", () => {
    expect(upSql).toContain("alter column email drop not null");
  });

  /*
   * The application can now clear an address. Storing '' for "no address"
   * alongside NULL would give the same state two spellings, and every query
   * would have to know about both.
   */
  it("keeps a cleared address as null rather than an empty string", () => {
    expect(upSql).toContain("check (email is null or length(email) > 0)");
  });

  it("undoes the username column and the relaxed address together", () => {
    expect(downSql).toContain("drop column if exists username");
    expect(downSql).toContain("drop index if exists stockcontrol.users_username_key");
    expect(downSql).toContain("alter column email set not null");
  });
});
