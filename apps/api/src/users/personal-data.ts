import { sql, type ExpressionBuilder, type Kysely } from "kysely";

import type { JsonObject, StockControlDatabase } from "@stockcontrol/platform-database";

const SCHEMA = "stockcontrol" as const;

/**
 * How a source's rows are matched to the person asking.
 *
 * `direct` is the common case: one or more columns on the row itself point
 * straight at `users`. `viaSession` is for a table that only points at a
 * `stock_recognition_sessions` row, which is itself what points at the
 * person — the raw capture evidence, not just the session record built from
 * it. `mcpToolCallsActor` is the one genuinely special case: a tool call is
 * inserted before it is authorised, so its own `actor_user_id` can still be
 * null when the row is written, and the actor is only known for certain once
 * a later event on the same call records it — the same resolution
 * `mcp-activity.service.ts` uses to answer "whose call was this".
 * `mcpToolCallEventsActor` is the same problem one table over: the earliest
 * event on a call — the one recorded before authorisation, which is exactly
 * the event that could carry the null — has no actor of its own to match
 * `direct` against. Matching straight on `actor_user_id` would silently drop
 * that row from the person's own export, so this matches through the call's
 * resolved actor instead, the way a `viaSession` source matches through its
 * session.
 */
export type PersonalDataScope =
  | { readonly kind: "direct"; readonly columns: readonly string[] }
  | { readonly kind: "viaSession"; readonly column: string }
  | { readonly kind: "mcpToolCallsActor" }
  | { readonly kind: "mcpToolCallEventsActor" };

/**
 * Everywhere a person appears in this database, and what to call it when they
 * ask for a copy.
 *
 * This list is exhaustive on purpose, and the integration spec beside it reads
 * the live schema to prove it: a new table with a column pointing at `users`
 * fails that test until it is named here. A subject access request answered
 * from a list somebody forgot to update is a worse answer than none, because
 * it looks complete. That check only catches a table with a direct foreign
 * key to `users`, though — `viaSession` sources are personal data by
 * indirection, so they are not something a schema query can discover for you.
 *
 * `users` itself is deliberately absent — it is the subject block, assembled by
 * hand so that the password hash cannot travel with it.
 */
export interface PersonalDataSource {
  /** Plain English, because this is read by the person the data is about. */
  readonly label: string;
  readonly table: keyof StockControlDatabase;
  readonly scope: PersonalDataScope;
  /** How the rows are ordered, newest first. */
  readonly orderBy: string;
  /** Columns withheld, and never sent. */
  readonly withhold?: readonly string[];
  /**
   * Cleared as part of the same account deletion this list is also used to
   * gate, so a row here is not a reason to refuse it. Sign-in sessions and a
   * profile photo do not outlive the account; nothing else on this list is
   * true of.
   */
  readonly clearedOnDeletion?: boolean;
}

export const PERSONAL_DATA_SOURCES: readonly PersonalDataSource[] = Object.freeze([
  {
    label: "Sign-in sessions",
    table: "sessions",
    scope: { kind: "direct", columns: ["user_id"] },
    orderBy: "issued_at",
    /*
     * The id is a digest of the session token, so it is not a usable
     * credential — but it is derived from one, it tells the person nothing
     * they can read, and an Admin may produce this file for somebody else.
     * When it stops being needed and stops being sent, both stay true no
     * matter what the storage scheme becomes. The times are what answer the
     * question "when was I signed in", and those stay.
     */
    withhold: ["id"],
    clearedOnDeletion: true,
  },
  {
    label: "Profile photo",
    table: "user_profile_photos",
    scope: { kind: "direct", columns: ["user_id"] },
    orderBy: "created_at",
    clearedOnDeletion: true,
  },
  {
    label: "Stock you moved",
    table: "transactions",
    scope: { kind: "direct", columns: ["actor_user_id"] },
    orderBy: "occurred_at",
  },
  {
    label: "Stock you reserved",
    table: "reservations",
    scope: { kind: "direct", columns: ["created_by_user_id"] },
    orderBy: "created_at",
  },
  {
    label: "Stock requests you raised or decided",
    table: "stock_requests",
    scope: { kind: "direct", columns: ["requested_by_user_id", "decided_by_user_id"] },
    orderBy: "created_at",
  },
  {
    label: "Jobs you were assigned to",
    table: "job_assignments",
    scope: { kind: "direct", columns: ["user_id", "assigned_by_user_id"] },
    orderBy: "assigned_at",
  },
  {
    label: "Changes you made to a map",
    table: "map_edit_events",
    scope: { kind: "direct", columns: ["actor_user_id"] },
    orderBy: "occurred_at",
  },
  {
    label: "Floor plans you uploaded",
    table: "floor_plan_documents",
    scope: { kind: "direct", columns: ["created_by_user_id"] },
    orderBy: "created_at",
  },
  {
    label: "Item photos you uploaded",
    table: "item_photos",
    scope: { kind: "direct", columns: ["created_by_user_id"] },
    orderBy: "created_at",
  },
  {
    label: "Item photos you confirmed as a match",
    table: "item_visual_examples",
    scope: { kind: "direct", columns: ["verified_by_user_id"] },
    orderBy: "created_at",
  },
  {
    label: "Assistant connections",
    table: "oauth_grants",
    scope: { kind: "direct", columns: ["user_id"] },
    orderBy: "created_at",
    /* Token digests are credentials, not information about the person. */
    withhold: [
      "authorization_code_hash",
      "authorization_code_challenge",
      "access_token_hash",
      "refresh_token_hash",
    ],
  },
  {
    label: "Assistant connection history",
    table: "oauth_grant_events",
    scope: { kind: "direct", columns: ["user_id"] },
    orderBy: "occurred_at",
  },
  {
    label: "Assistant sign-in attempts",
    table: "oauth_authorization_requests",
    scope: { kind: "direct", columns: ["user_id"] },
    orderBy: "created_at",
    withhold: ["approval_handle_hash", "authorization_code_hash", "code_challenge"],
  },
  {
    label: "What you asked the assistant to do",
    table: "mcp_tool_calls",
    /*
     * Not `direct`: `actor_user_id` on the call row itself is null until the
     * call is authorised, so matching only that column silently drops the
     * calls made before authorisation finished. The true owner is resolved
     * the same way `mcp-activity.service.ts` resolves it for the activity
     * screen — the call's own column if set, else the earliest event on it
     * that recorded one.
     */
    scope: { kind: "mcpToolCallsActor" },
    orderBy: "received_at",
  },
  {
    label: "What the assistant did about it",
    table: "mcp_tool_call_events",
    /*
     * Not `direct`, for the reason `mcp_tool_calls` above is not: the
     * earliest event on a call is written before authorisation resolves who
     * it belongs to, so its own `actor_user_id` can be null. Matching
     * through the call's resolved actor catches that row along with every
     * other event on the same call, rather than only the ones written after
     * authorisation happened to record an actor.
     */
    scope: { kind: "mcpToolCallEventsActor" },
    orderBy: "occurred_at",
  },
  {
    label: "Assistant command receipts",
    table: "mcp_command_receipts",
    scope: { kind: "direct", columns: ["actor_user_id"] },
    orderBy: "committed_at",
  },
  {
    label: "Stock you added by photograph",
    table: "stock_capture_batches",
    scope: { kind: "direct", columns: ["actor_user_id"] },
    orderBy: "created_at",
  },
  {
    label: "Photographs you took to identify stock",
    table: "stock_recognition_sessions",
    scope: { kind: "direct", columns: ["actor_user_id"] },
    orderBy: "created_at",
  },
  {
    label: "The photographs themselves",
    table: "stock_recognition_images",
    scope: { kind: "viaSession", column: "session_id" },
    orderBy: "created_at",
  },
  {
    label: "What the recogniser proposed from your photographs",
    table: "stock_recognition_candidates",
    scope: { kind: "viaSession", column: "session_id" },
    orderBy: "created_at",
  },
  {
    label: "Background work queued for your photographs",
    table: "stock_recognition_jobs",
    scope: { kind: "viaSession", column: "session_id" },
    orderBy: "created_at",
  },
  {
    label: "Stock you confirmed from a photograph",
    table: "stock_capture_entries",
    scope: { kind: "direct", columns: ["actor_user_id"] },
    orderBy: "created_at",
  },
  {
    label: "Whether you accepted what the recogniser suggested",
    table: "recognition_feedback",
    scope: { kind: "direct", columns: ["actor_user_id"] },
    orderBy: "created_at",
  },
]);

export interface PersonalDataSubject {
  readonly id: string;
  readonly username: string;
  readonly email: string | null;
  readonly displayName: string;
  readonly role: string;
  readonly isActive: boolean;
  readonly mustChangePassword: boolean;
  readonly passwordChangedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PersonalDataSection {
  readonly label: string;
  readonly table: string;
  readonly rowCount: number;
  readonly rows: readonly JsonObject[];
}

export interface PersonalDataExport {
  readonly exportedAt: string;
  readonly subject: PersonalDataSubject;
  readonly sections: readonly PersonalDataSection[];
  readonly notes: readonly string[];
}

const EXPORT_NOTES: readonly string[] = Object.freeze([
  "This is a copy of the records StockControl holds about you, on the day it was produced.",
  "Your password is not included. It is withheld for security: it is stored as a one-way hash, which cannot be turned back into a password.",
  "Where a record involves somebody else — the person who assigned you a job, for example — they appear as an identifier rather than a name, so that answering your request does not hand out theirs. Free-text fields (a request note, a reason recorded against a map change) are not rewritten, so it remains possible for one to mention someone else by name; that is weighed against their rights before it is sent on.",
  "Where a record includes an uploaded file — a profile photo, a floor plan, a photograph taken to identify stock — this export lists the file's name or key, its size and its checksum, but not the file's bytes. Ask an Admin for a copy of the file itself if you need it.",
  "Records of stock you moved are kept because they are the company's accounting records. They are explained in the privacy notice, along with how long everything is kept.",
]);

/*
 * Kysely types a select against a literal table name. The sources above carry
 * names as data so the list reads as a policy and can be checked against the
 * live schema, which costs a cast here. Columns go through `sql.ref`, so they
 * are identifiers; the user id stays a bound value.
 */
type AnyTable = keyof StockControlDatabase;

/**
 * The expression builder as this file uses it: callable to make a comparison,
 * and `or` to join them. Kysely's own type needs the table's column names as
 * literals, which is exactly what these sources deliberately do not have.
 */
interface ExpressionBuilderLike {
  (left: unknown, operator: string, right: unknown): unknown;
  or(expressions: readonly unknown[]): unknown;
}

interface DynamicSelect {
  select(columns: readonly unknown[]): DynamicSelect;
  selectAll(): DynamicSelect;
  where(build: (builder: ExpressionBuilder<never, never>) => unknown): DynamicSelect;
  orderBy(column: unknown, direction: string): DynamicSelect;
  execute(): Promise<readonly Record<string, unknown>[]>;
}

interface DynamicFilterable {
  where(build: (builder: ExpressionBuilder<never, never>) => unknown): DynamicFilterable;
  limit(count: number): DynamicFilterable;
  executeTakeFirst(): Promise<Record<string, unknown> | undefined>;
}

/**
 * The `coalesce(actor_user_id, earliest recorded event actor)` match
 * `mcp-activity.service.ts` uses to resolve who a tool call belongs to, as a
 * boolean expression comparable against a bound user id.
 */
const mcpToolCallsActorMatches = (userId: string): unknown =>
  sql<boolean>`coalesce(
    mcp_tool_calls.actor_user_id,
    (
      select actor_event.actor_user_id
      from ${sql.raw(`${SCHEMA}.mcp_tool_call_events`)} actor_event
      where actor_event.call_id = mcp_tool_calls.id
        and actor_event.actor_user_id is not null
      order by actor_event.occurred_at asc, actor_event.id asc
      limit 1
    )
  ) = ${userId}`;

/**
 * The boolean expression a source's `where` clause is built from, shared
 * between reading every matching row and merely asking whether at least one
 * exists.
 */
const matchExpression = (source: PersonalDataSource, userId: string) => (builder: unknown) => {
  switch (source.scope.kind) {
    case "direct":
      return (builder as ExpressionBuilderLike).or(
        source.scope.columns.map((column) =>
          (builder as ExpressionBuilderLike)(sql.ref(column), "=", userId),
        ),
      );
    case "viaSession":
      return (builder as ExpressionBuilderLike)(
        sql.ref(source.scope.column),
        "in",
        sql`(select id from ${sql.raw(`${SCHEMA}.stock_recognition_sessions`)} where actor_user_id = ${userId})`,
      );
    case "mcpToolCallsActor":
      return mcpToolCallsActorMatches(userId);
    case "mcpToolCallEventsActor":
      return (builder as ExpressionBuilderLike)(
        sql.ref("call_id"),
        "in",
        sql`(select mcp_tool_calls.id from ${sql.raw(`${SCHEMA}.mcp_tool_calls`)} where ${mcpToolCallsActorMatches(userId)})`,
      );
  }
};

/**
 * The columns `withhold` leaves selectable, read from the live schema rather
 * than assumed. A withheld column is excluded from the query itself this
 * way — never read from the database for this code path at all, rather than
 * fetched and then dropped once it is already sitting in application memory.
 */
const selectableColumns = async (
  database: Kysely<StockControlDatabase>,
  table: keyof StockControlDatabase,
  withheld: ReadonlySet<string>,
): Promise<readonly string[]> => {
  const columns = await sql<{ readonly column_name: string }>`
    select column_name
    from information_schema.columns
    where table_schema = ${SCHEMA} and table_name = ${table}
  `.execute(database);

  return columns.rows.map((row) => row.column_name).filter((column) => !withheld.has(column));
};

const readSection = async (
  database: Kysely<StockControlDatabase>,
  source: PersonalDataSource,
  userId: string,
): Promise<PersonalDataSection> => {
  const withheld = new Set(source.withhold ?? []);
  const query = database
    .withSchema(SCHEMA)
    .selectFrom<AnyTable>(source.table) as unknown as DynamicSelect;

  const base =
    withheld.size === 0
      ? query.selectAll()
      : query.select(
          (await selectableColumns(database, source.table, withheld)).map((column) =>
            sql.ref(column),
          ),
        );

  const rows = await base
    .where(matchExpression(source, userId))
    .orderBy(sql.ref(source.orderBy), "desc")
    .execute();

  return {
    label: source.label,
    table: source.table,
    rowCount: rows.length,
    rows: rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([column, value]) => [column, serialisable(value)]),
      ),
    ),
  };
};

/**
 * Turns a driver value into something that survives JSON. Dates become ISO
 * strings, and the embedding buffers become their size — the bytes of a
 * similarity vector are not information a person can read, and shipping
 * megabytes of them would bury the part of the export that is.
 */
const serialisable = (value: unknown): JsonObject[string] => {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `${String(value.byteLength)} bytes`;
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((entry) => serialisable(entry));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, serialisable(entry)]),
    );
  }

  /*
   * A count column arrives from the driver as a bigint, which JSON cannot
   * carry. Nothing else should reach here; if it does, saying so is better
   * than shipping "[object Object]" to somebody as a copy of their record.
   */
  return typeof value === "bigint" ? value.toString() : null;
};

/**
 * Assembles a copy of everything held about one person, for Article 15 of the
 * UK GDPR. Produced on demand rather than kept, so it is right on the day it
 * is asked for.
 */
export const exportPersonalData = async (
  database: Kysely<StockControlDatabase>,
  userId: string,
  now: Date = new Date(),
): Promise<PersonalDataExport | undefined> => {
  /*
   * One snapshot, not one query per section. Twenty-odd unbounded selects
   * against a growing set of tables take long enough that a write landing
   * mid-export is a real possibility, not a theoretical one — a job closed
   * between reading `stock_capture_batches` and `stock_recognition_sessions`
   * would otherwise read as two different moments in the same file. Read
   * only, because an export has no business taking a write lock.
   */
  return database
    .transaction()
    .setIsolationLevel("repeatable read")
    .setAccessMode("read only")
    .execute(async (transaction) => {
      const account = await transaction
        .withSchema(SCHEMA)
        .selectFrom("users")
        .select([
          "id",
          "username",
          "email",
          "display_name",
          "role",
          "is_active",
          "must_change_password",
          "password_changed_at",
          "created_at",
          "updated_at",
        ])
        .where("id", "=", userId)
        .executeTakeFirst();

      if (account === undefined) {
        return undefined;
      }

      const sections: PersonalDataSection[] = [];

      for (const source of PERSONAL_DATA_SOURCES) {
        sections.push(await readSection(transaction, source, userId));
      }

      return {
        exportedAt: now.toISOString(),
        subject: {
          id: account.id,
          username: account.username,
          email: account.email,
          displayName: account.display_name,
          role: account.role,
          isActive: account.is_active,
          mustChangePassword: account.must_change_password,
          passwordChangedAt: account.password_changed_at?.toISOString() ?? null,
          createdAt: account.created_at.toISOString(),
          updatedAt: account.updated_at.toISOString(),
        },
        sections,
        notes: EXPORT_NOTES,
      };
    });
};

/**
 * Whether a person has a row anywhere on the same list a subject access
 * request is answered from, excluding the two sources that a deletion clears
 * itself. Deletion is refused when this is true — the same list, so a table
 * added for an export can never silently stop being a reason to keep the
 * account, the way a hand-maintained second list once could.
 */
export const hasRecordedActivity = async (
  database: Kysely<StockControlDatabase>,
  userId: string,
): Promise<boolean> => {
  for (const source of PERSONAL_DATA_SOURCES) {
    if (source.clearedOnDeletion === true) continue;

    const query = database
      .withSchema(SCHEMA)
      .selectFrom<AnyTable>(source.table)
      .select(sql<number>`1`.as("present")) as unknown as DynamicFilterable;

    const found = await query.where(matchExpression(source, userId)).limit(1).executeTakeFirst();

    if (found !== undefined) return true;
  }

  return false;
};
