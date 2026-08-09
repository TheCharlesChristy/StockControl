import { describe, expect, it } from "vitest";

import {
  assistedStockCaptureMigrationDefinition,
  assistedStockCaptureMigrationIntegrity,
} from "../src/migrations/0007-assisted-stock-capture";
import { MIGRATION_INTEGRITY_MANIFEST, MIGRATION_NAMES } from "../src/migrations/provider";
import { RUNTIME_TABLE_PRIVILEGES } from "../src/migrations/runner";

const CAPTURE_TABLES = [
  "stock_capture_batches",
  "stock_recognition_sessions",
  "stock_recognition_images",
  "stock_recognition_candidates",
  "stock_recognition_jobs",
  "item_visual_examples",
  "stock_capture_entries",
  "recognition_feedback",
] as const;

describe("assisted stock capture migration", () => {
  const upSql = assistedStockCaptureMigrationDefinition.upStatements.join("\n");
  const downSql = assistedStockCaptureMigrationDefinition.downStatements.join("\n");

  it("is the seventh canonical migration with a recorded checksum", () => {
    expect(assistedStockCaptureMigrationDefinition).toMatchObject({
      name: "0007_assisted_stock_capture",
      version: 7,
    });
    expect(assistedStockCaptureMigrationIntegrity).toEqual({
      name: "0007_assisted_stock_capture",
      version: 7,
      checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("is registered in the provider and the integrity manifest", () => {
    expect(MIGRATION_NAMES).toContain("0007_assisted_stock_capture");
    expect(MIGRATION_INTEGRITY_MANIFEST["0007_assisted_stock_capture"]).toEqual(
      assistedStockCaptureMigrationIntegrity,
    );
  });

  it.each(CAPTURE_TABLES)("creates stockcontrol.%s", (table) => {
    expect(upSql).toContain(`create table stockcontrol.${table} (`);
    expect(downSql).toContain(`drop table if exists stockcontrol.${table}`);
  });

  it("drops tables in the reverse of their dependency order", () => {
    const dropped = assistedStockCaptureMigrationDefinition.downStatements.map((statement) =>
      statement.replace("drop table if exists stockcontrol.", ""),
    );
    expect(dropped.indexOf("stock_capture_entries")).toBeLessThan(
      dropped.indexOf("stock_recognition_sessions"),
    );
    expect(dropped.indexOf("stock_recognition_sessions")).toBeLessThan(
      dropped.indexOf("stock_capture_batches"),
    );
  });

  it("grants every new table a reviewed runtime privilege set", () => {
    for (const table of CAPTURE_TABLES) {
      expect(RUNTIME_TABLE_PRIVILEGES[table].length).toBeGreaterThan(0);
    }
  });

  /*
   * The entry row is the proof that a receipt happened once. Granting delete
   * would let a retry remove the record of the first attempt and then create a
   * second receipt, which is the exact failure the table exists to prevent.
   */
  it("withholds delete on the entry table that makes commits idempotent", () => {
    expect(RUNTIME_TABLE_PRIVILEGES.stock_capture_entries).not.toContain("delete");
  });

  /* The application owns deletion: Railway Buckets have no lifecycle rules. */
  it("grants delete where the application is obliged to destroy evidence", () => {
    expect(RUNTIME_TABLE_PRIVILEGES.stock_recognition_images).toContain("delete");
    expect(RUNTIME_TABLE_PRIVILEGES.stock_recognition_candidates).toContain("delete");
    expect(RUNTIME_TABLE_PRIVILEGES.item_visual_examples).toContain("delete");
  });

  it("keeps the session state check in step with the pipeline states", () => {
    for (const status of [
      "AwaitingUpload",
      "Queued",
      "ProcessingBarcode",
      "ProcessingImages",
      "Enriching",
      "Fusing",
      "ReviewReady",
      "Committed",
      "Failed",
      "Cancelled",
      "Expired",
    ]) {
      expect(upSql).toContain(`'${status}'`);
    }
  });

  it("bounds a session to five photographs in the database, not only the API", () => {
    expect(upSql).toContain("photo_count smallint not null check (photo_count between 0 and 5)");
    expect(upSql).toContain("ordinal smallint not null check (ordinal between 1 and 5)");
  });

  it("stops one session uploading two photographs into the same position", () => {
    expect(upSql).toContain(
      "create unique index stock_recognition_images_session_ordinal on stockcontrol.stock_recognition_images (session_id, ordinal)",
    );
  });

  it("stops a session being committed twice", () => {
    expect(upSql).toContain(
      "create unique index stock_capture_entries_session_key on stockcontrol.stock_capture_entries (session_id)",
    );
    expect(upSql).toContain(
      "create unique index stock_capture_entries_transaction_key on stockcontrol.stock_capture_entries (transaction_id)",
    );
  });

  it("makes enqueueing idempotent across the whole queue", () => {
    expect(upSql).toContain(
      "create unique index stock_recognition_jobs_deduplication_key on stockcontrol.stock_recognition_jobs (deduplication_key)",
    );
  });

  /*
   * Without an index restricted to claimable work, the claim query degrades
   * into a scan over every job the installation has ever run.
   */
  it("indexes the claim query on claimable work only", () => {
    expect(upSql).toContain(
      "create index stock_recognition_jobs_claim_idx on stockcontrol.stock_recognition_jobs (available_at, id) where status in ('Ready', 'Retry', 'Running')",
    );
  });

  it("indexes the janitor query on objects that still exist", () => {
    expect(upSql).toContain(
      "create index stock_recognition_images_deletion_idx on stockcontrol.stock_recognition_images (delete_after) where deleted_at is null",
    );
  });

  it("refuses a half-set lease", () => {
    expect(upSql).toContain("stock_recognition_jobs_lease_pairing");
  });

  it("refuses an internal candidate with no item and an external one with an item", () => {
    expect(upSql).toContain("stock_recognition_candidates_kind_item");
  });

  it("refuses a committed entry missing its results, or a pending one carrying them", () => {
    expect(upSql).toContain("stock_capture_entries_result_state");
  });

  /*
   * Recognition evidence is purged; the stock ledger is not. A foreign key from
   * a transaction to a candidate would make the purge impossible.
   */
  it("never points the stock ledger at recognition evidence", () => {
    expect(upSql).not.toMatch(/alter table stockcontrol\.transactions/u);
    expect(upSql).not.toMatch(/alter table stockcontrol\.stock_levels/u);
  });

  it("checks every stored digest is a lowercase SHA-256", () => {
    const digestChecks = upSql.match(/~ '\^\[0-9a-f\]\{64\}\$'/gu) ?? [];
    expect(digestChecks.length).toBeGreaterThanOrEqual(4);
  });
});
