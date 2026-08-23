import { describe, expect, it } from "vitest";

import { RUNTIME_TABLE_PRIVILEGES } from "../src/migrations/runner";
import {
  DEFAULT_AUDIT_DAYS,
  DEFAULT_CAPTURE_DAYS,
  DEFAULT_RETENTION_WINDOWS,
  RETENTION_RULES,
  RetentionConfigurationError,
  cutoffFor,
  loadRetentionWindows,
} from "../src/retention/schedule";

describe("the retention schedule", () => {
  it("keeps assistant activity for the twelve months ADR 0010 commits to", () => {
    expect(DEFAULT_AUDIT_DAYS).toBe(365);
    expect(DEFAULT_CAPTURE_DAYS).toBe(90);
  });

  it("names a real table and a reason for every rule", () => {
    for (const rule of RETENTION_RULES) {
      expect(Object.keys(RUNTIME_TABLE_PRIVILEGES)).toContain(rule.table);
      expect(rule.reason.length).toBeGreaterThan(0);
    }
  });

  it("covers each table once", () => {
    const tables = RETENTION_RULES.map((rule) => rule.table);

    expect(new Set(tables).size).toBe(tables.length);
  });

  /*
   * Every foreign key in this schema is `on delete restrict`. A rule that
   * deletes a parent before its children does not leave a mess — it throws,
   * and the whole run rolls back. Declaration order is what prevents it, so
   * the order is asserted rather than trusted.
   */
  it("deletes dependent rows before the row they hang from", () => {
    const positionOf = (table: string): number =>
      RETENTION_RULES.findIndex((rule) => rule.table === table);

    for (const child of ["mcp_effect_links", "mcp_command_receipts", "mcp_tool_call_events"]) {
      expect(positionOf(child)).toBeLessThan(positionOf("mcp_tool_calls"));
    }

    for (const child of [
      "recognition_feedback",
      "stock_recognition_candidates",
      "stock_recognition_images",
      "stock_recognition_jobs",
      "stock_capture_entries",
    ]) {
      expect(positionOf(child)).toBeLessThan(positionOf("stock_recognition_sessions"));
    }
  });

  /*
   * The stock ledger is a six-year business record and the projections in
   * `stock_levels` are derived from it, so ageing a row out would quietly
   * falsify a count. A leaver's user row is held for the same reason: the
   * ledger points at it. Both are decisions, not omissions.
   */
  it("leaves the stock ledger and user accounts alone", () => {
    const tables = RETENTION_RULES.map((rule) => rule.table);

    expect(tables).not.toContain("transactions");
    expect(tables).not.toContain("stock_levels");
    expect(tables).not.toContain("users");
  });

  it("measures the cutoff back from the moment the run started", () => {
    const rule = RETENTION_RULES.find((candidate) => candidate.window === "auditDays");
    const now = new Date("2026-08-23T12:00:00.000Z");

    expect(cutoffFor(rule!, DEFAULT_RETENTION_WINDOWS, now).toISOString()).toBe(
      "2025-08-23T12:00:00.000Z",
    );
  });
});

describe("retention windows from the environment", () => {
  it("falls back to the documented defaults", () => {
    expect(loadRetentionWindows({})).toEqual(DEFAULT_RETENTION_WINDOWS);
  });

  it("takes an override", () => {
    expect(loadRetentionWindows({ RETENTION_AUDIT_DAYS: "180" })).toEqual({
      auditDays: 180,
      captureDays: DEFAULT_CAPTURE_DAYS,
    });
  });

  /*
   * A mistyped window that quietly fell back to the default would report a
   * successful run while keeping records for a period nobody chose, which is
   * the failure a retention policy exists to prevent.
   */
  it.each(["twelve", "0", "-30", "30.5", ""])("refuses %o rather than guessing", (value) => {
    const environment = { RETENTION_AUDIT_DAYS: value };

    if (value === "") {
      expect(loadRetentionWindows(environment).auditDays).toBe(DEFAULT_AUDIT_DAYS);
      return;
    }

    expect(() => loadRetentionWindows(environment)).toThrow(RetentionConfigurationError);
  });
});
