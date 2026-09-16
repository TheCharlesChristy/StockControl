import type { Kysely, Transaction } from "kysely";

import type { StockControlDatabase } from "../schema";

export type RetentionExecutor = Kysely<StockControlDatabase> | Transaction<StockControlDatabase>;

/**
 * How long a group of records is kept, in days.
 *
 * Two knobs on purpose. A retention period is the kind of thing that gets
 * changed once, by somebody who has thought about it, and written down in
 * `docs/legal/retention-schedule.md` — not tuned per table until nobody can
 * say what the policy is any more.
 */
export interface RetentionWindows {
  /** Records of who did what: through the assistant, or on a map. */
  readonly auditDays: number;
  /** Working state left behind by an assisted stock capture session. */
  readonly captureDays: number;
}

/** Twelve months, which is what ADR 0010 commits to for assistant activity. */
export const DEFAULT_AUDIT_DAYS = 365;

/**
 * Ninety days. The receipt a capture session produces lives in `transactions`
 * and is a business record; everything below is the working-out, and a quarter
 * is long enough to investigate a disputed count.
 */
export const DEFAULT_CAPTURE_DAYS = 90;

export const DEFAULT_RETENTION_WINDOWS: RetentionWindows = Object.freeze({
  auditDays: DEFAULT_AUDIT_DAYS,
  captureDays: DEFAULT_CAPTURE_DAYS,
});

/**
 * The parents whose age decides when a dependent row expires.
 *
 * Every foreign key these rules touch is `on delete restrict`, which is
 * deliberate — nothing this job deletes disappears silently because something
 * else did. The consequence for retention is that a child has to be aged out
 * on its parent's clock rather than its own: a tool call from thirteen months
 * ago whose last event landed a minute later would otherwise leave an orphan
 * that the parent's delete then trips over.
 */
type RetentionParent = "captureSessions" | "captureBatches" | "toolCalls";

/**
 * Which rows a rule claims. `own` ages a table on its own timestamp — or, for
 * a row whose life can end one of two ways (explicit revocation, or simply
 * running out), the earlier-populated of two columns, so an owner who never
 * bothered to revoke does not get a credential kept forever on a technicality.
 * `parent` ages a row on the parent named, through the foreign key given.
 */
type RetentionScope =
  | { readonly kind: "own"; readonly column: string | readonly [primary: string, fallback: string] }
  | { readonly kind: "parent"; readonly column: string; readonly parent: RetentionParent };

export interface RetentionRule {
  readonly table: keyof StockControlDatabase;
  readonly window: keyof RetentionWindows;
  readonly scope: RetentionScope;
  /** Why the record stops being needed. Read by whoever reviews the policy. */
  readonly reason: string;
  /**
   * A second gate some rules need beyond their scope: only touch a row once
   * this column is set. `stock_recognition_images` uses it so the metadata
   * row never outlives the object it describes — if the worker that deletes
   * the bytes has fallen behind, the row survives to give it another chance,
   * rather than leaving an object in the bucket nothing can find again.
   */
  readonly requireColumnNotNull?: string;
  /**
   * Other tables that still restrict-reference this row, for a rule aged on
   * its own clock rather than a parent's. Ordering children before their
   * parent in the list below is not enough on its own here: a dependent can
   * be inserted long after this row's own clock already reads "expired" — a
   * replay attempt against a refresh token nobody has used in years still
   * writes an event today — so the row is kept a little longer whenever one
   * of these still points at it, rather than trip the restrict constraint
   * and roll back every table's retention work for the night.
   */
  readonly blockedByDependents?: readonly {
    readonly table: keyof StockControlDatabase;
    readonly column: string;
  }[];
}

/*
 * Ordered. Children come before the parent they hang from, because the
 * restrict constraints mean the parent's delete fails otherwise.
 */
export const RETENTION_RULES: readonly RetentionRule[] = Object.freeze([
  {
    table: "mcp_effect_links",
    window: "auditDays",
    scope: { kind: "parent", column: "call_id", parent: "toolCalls" },
    reason: "Links a tool call to the business record it produced; that record outlives it.",
  },
  {
    table: "mcp_command_receipts",
    window: "auditDays",
    scope: { kind: "parent", column: "call_id", parent: "toolCalls" },
    reason: "Proves a retried command committed once. Idempotency keys do not live a year.",
  },
  {
    table: "mcp_tool_call_events",
    window: "auditDays",
    scope: { kind: "parent", column: "call_id", parent: "toolCalls" },
    reason: "The lifecycle of one assistant call: what was allowed, and what happened.",
  },
  {
    table: "mcp_tool_calls",
    window: "auditDays",
    scope: { kind: "own", column: "received_at" },
    reason: "What a named person asked the assistant to do, and the arguments it validated.",
  },
  {
    table: "oauth_grant_events",
    window: "auditDays",
    scope: { kind: "own", column: "occurred_at" },
    reason: "When a person connected, reauthorised or revoked an assistant grant.",
  },
  {
    table: "oauth_refresh_tokens",
    window: "auditDays",
    /*
     * `revoked_at` is null for a token nobody has explicitly killed, and a
     * token abandoned rather than revoked — the owner just stopped using the
     * assistant — is exactly as dead once `expires_at` passes; it just has
     * no one moment marking it. Ageing on whichever happened falls back to
     * the token's own hard expiry when there was no explicit revocation.
     */
    scope: { kind: "own", column: ["revoked_at", "expires_at"] },
    reason: "The credential for a connection that was explicitly revoked, or that expired unused.",
  },
  {
    table: "oauth_grants",
    window: "auditDays",
    /* Same reasoning as the refresh token above, on the grant's own token. */
    scope: { kind: "own", column: ["revoked_at", "refresh_token_expires_at"] },
    /*
     * A dependent can still be inserted long after this clock reads
     * "expired" — a replay attempt against a refresh token nobody has used
     * in years writes an `oauth_grant_events` row today — so the grant waits
     * for those to clear too, rather than trip the restrict FK and roll
     * back every table's retention work for the night.
     */
    blockedByDependents: [
      { table: "oauth_grant_events", column: "grant_id" },
      { table: "oauth_refresh_tokens", column: "grant_id" },
      { table: "mcp_tool_calls", column: "oauth_grant_id" },
    ],
    reason:
      "A revoked, or naturally expired, assistant connection should not outlive its own end forever.",
  },
  {
    table: "map_edit_events",
    window: "auditDays",
    scope: { kind: "own", column: "occurred_at" },
    reason: "Who moved a location on a map, and what it looked like before they did.",
  },
  {
    table: "recognition_feedback",
    window: "captureDays",
    scope: { kind: "parent", column: "session_id", parent: "captureSessions" },
    reason: "Whether a person accepted or corrected what the recogniser suggested.",
  },
  {
    table: "stock_recognition_candidates",
    window: "captureDays",
    scope: { kind: "parent", column: "session_id", parent: "captureSessions" },
    reason: "What the recogniser proposed. The answer that was chosen is already on the item.",
  },
  {
    table: "stock_recognition_images",
    window: "captureDays",
    scope: { kind: "parent", column: "session_id", parent: "captureSessions" },
    requireColumnNotNull: "deleted_at",
    reason:
      "The row that described the bytes, kept only until the worker confirms the bytes themselves are gone — a stockroom photograph can catch somebody in the background, so it is evidence rather than a business record.",
  },
  {
    table: "stock_recognition_jobs",
    window: "captureDays",
    scope: { kind: "parent", column: "session_id", parent: "captureSessions" },
    reason: "Queue rows for work that finished months ago.",
  },
  {
    table: "stock_capture_entries",
    window: "captureDays",
    scope: { kind: "parent", column: "session_id", parent: "captureSessions" },
    reason: "The idempotency record for a commit that has long since settled.",
  },
  {
    table: "stock_recognition_sessions",
    window: "captureDays",
    scope: { kind: "parent", column: "id", parent: "captureSessions" },
    reason: "The session itself, once everything that pointed at it has gone.",
  },
  {
    table: "stock_capture_batches",
    window: "captureDays",
    scope: { kind: "parent", column: "id", parent: "captureBatches" },
    /*
     * An Open batch is not exempt on status alone any more: one still
     * genuinely in flight has a session under it, and `expiredParentIds` in
     * `purge.ts` excludes anything that does. What is left eligible under
     * "Open" is a batch `startBatch` created that nothing was ever done
     * with — closing it is not something the app was ever told to do,
     * because nobody told the app anything after opening it.
     */
    reason:
      "The batch itself, once everything under it has finished and closed, or nothing was ever created under it at all.",
  },
]);

/*
 * Deliberately absent, and for the same reason both times.
 *
 * `transactions` is the stock ledger. It is a business record the company has
 * to keep for six years, and it is also the record of who moved what — so it
 * is monitoring data that cannot just be aged out on a twelve-month clock. It
 * is append-only by grant, `stock_levels` is derived from it, and deleting a
 * row would quietly falsify a count. Erasure at the six-year boundary is a
 * reviewed manual operation, not a nightly job.
 *
 * `users` is not aged out either. A leaver is deactivated, which ends their
 * access immediately; the row survives because the ledger points at it.
 * `docs/legal/retention-schedule.md` records both positions.
 */

export const cutoffFor = (rule: RetentionRule, windows: RetentionWindows, now: Date): Date =>
  new Date(now.getTime() - windows[rule.window] * 24 * 60 * 60 * 1_000);

export class RetentionConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RetentionConfigurationError";
  }
}

/**
 * Reads a window from the environment.
 *
 * A retention period that silently falls back to a default because somebody
 * typed `RETENTION_AUDIT_DAYS=twelve` is worse than one that refuses to run:
 * the job would report success while keeping records for a year nobody chose.
 */
const readWindow = (
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
): number => {
  const raw = environment[name];

  if (raw === undefined) {
    return fallback;
  }

  const trimmed = raw.trim();

  if (!/^[1-9][0-9]{0,4}$/u.test(trimmed)) {
    throw new RetentionConfigurationError(`${name} must be a whole number of days above zero.`);
  }

  return Number(trimmed);
};

export const loadRetentionWindows = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RetentionWindows => ({
  auditDays: readWindow(environment, "RETENTION_AUDIT_DAYS", DEFAULT_AUDIT_DAYS),
  captureDays: readWindow(environment, "RETENTION_CAPTURE_DAYS", DEFAULT_CAPTURE_DAYS),
});

/** The parent kinds a `parent`-scoped rule can follow. */
export type { RetentionParent };
