import { sql, type ExpressionBuilder, type Kysely } from "kysely";

import type { JsonObject, StockControlDatabase } from "@stockcontrol/platform-database";

const SCHEMA = "stockcontrol" as const;

/**
 * Everywhere a person appears in this database, and what to call it when they
 * ask for a copy.
 *
 * This list is exhaustive on purpose, and the integration spec beside it reads
 * the live schema to prove it: a new table with a column pointing at `users`
 * fails that test until it is named here. A subject access request answered
 * from a list somebody forgot to update is a worse answer than none, because
 * it looks complete.
 *
 * `users` itself is deliberately absent — it is the subject block, assembled by
 * hand so that the password hash cannot travel with it.
 */
export interface PersonalDataSource {
  /** Plain English, because this is read by the person the data is about. */
  readonly label: string;
  readonly table: keyof StockControlDatabase;
  /** The columns that can point at this person. Any match includes the row. */
  readonly columns: readonly string[];
  /** How the rows are ordered, newest first. */
  readonly orderBy: string;
  /** Columns withheld, and never sent. */
  readonly withhold?: readonly string[];
}

export const PERSONAL_DATA_SOURCES: readonly PersonalDataSource[] = Object.freeze([
  {
    label: "Sign-in sessions",
    table: "sessions",
    columns: ["user_id"],
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
  },
  {
    label: "Profile photo",
    table: "user_profile_photos",
    columns: ["user_id"],
    orderBy: "created_at",
  },
  {
    label: "Stock you moved",
    table: "transactions",
    columns: ["actor_user_id"],
    orderBy: "occurred_at",
  },
  {
    label: "Stock you reserved",
    table: "reservations",
    columns: ["created_by_user_id"],
    orderBy: "created_at",
  },
  {
    label: "Stock requests you raised or decided",
    table: "stock_requests",
    columns: ["requested_by_user_id", "decided_by_user_id"],
    orderBy: "created_at",
  },
  {
    label: "Jobs you were assigned to",
    table: "job_assignments",
    columns: ["user_id", "assigned_by_user_id"],
    orderBy: "assigned_at",
  },
  {
    label: "Changes you made to a map",
    table: "map_edit_events",
    columns: ["actor_user_id"],
    orderBy: "occurred_at",
  },
  {
    label: "Floor plans you uploaded",
    table: "floor_plan_documents",
    columns: ["created_by_user_id"],
    orderBy: "created_at",
  },
  {
    label: "Item photos you uploaded",
    table: "item_photos",
    columns: ["created_by_user_id"],
    orderBy: "created_at",
  },
  {
    label: "Item photos you confirmed as a match",
    table: "item_visual_examples",
    columns: ["verified_by_user_id"],
    orderBy: "created_at",
  },
  {
    label: "Assistant connections",
    table: "oauth_grants",
    columns: ["user_id"],
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
    columns: ["user_id"],
    orderBy: "occurred_at",
  },
  {
    label: "Assistant sign-in attempts",
    table: "oauth_authorization_requests",
    columns: ["user_id"],
    orderBy: "created_at",
    withhold: ["approval_handle_hash", "authorization_code_hash", "code_challenge"],
  },
  {
    label: "What you asked the assistant to do",
    table: "mcp_tool_calls",
    columns: ["actor_user_id"],
    orderBy: "received_at",
  },
  {
    label: "What the assistant did about it",
    table: "mcp_tool_call_events",
    columns: ["actor_user_id"],
    orderBy: "occurred_at",
  },
  {
    label: "Assistant command receipts",
    table: "mcp_command_receipts",
    columns: ["actor_user_id"],
    orderBy: "committed_at",
  },
  {
    label: "Stock you added by photograph",
    table: "stock_capture_batches",
    columns: ["actor_user_id"],
    orderBy: "created_at",
  },
  {
    label: "Photographs you took to identify stock",
    table: "stock_recognition_sessions",
    columns: ["actor_user_id"],
    orderBy: "created_at",
  },
  {
    label: "Stock you confirmed from a photograph",
    table: "stock_capture_entries",
    columns: ["actor_user_id"],
    orderBy: "created_at",
  },
  {
    label: "Whether you accepted what the recogniser suggested",
    table: "recognition_feedback",
    columns: ["actor_user_id"],
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
  "This is everything StockControl holds that is about you, on the day it was produced.",
  "Your password is not included. It is stored as a one-way hash, which cannot be turned back into a password and is not information about you.",
  "Where a record involves somebody else — the person who assigned you a job, for example — they appear as an identifier rather than a name, so that answering your request does not hand out theirs.",
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
  where(build: (builder: ExpressionBuilder<never, never>) => unknown): DynamicSelect;
  orderBy(column: unknown, direction: string): DynamicSelect;
  execute(): Promise<readonly Record<string, unknown>[]>;
}

const readSection = async (
  database: Kysely<StockControlDatabase>,
  source: PersonalDataSource,
  userId: string,
): Promise<PersonalDataSection> => {
  const base = database
    .withSchema(SCHEMA)
    .selectFrom<AnyTable>(source.table)
    .selectAll() as unknown as DynamicSelect;

  const rows = await base
    .where((builder) =>
      (builder as unknown as ExpressionBuilderLike).or(
        source.columns.map((column) =>
          (builder as unknown as ExpressionBuilderLike)(sql.ref(column), "=", userId),
        ),
      ),
    )
    .orderBy(sql.ref(source.orderBy), "desc")
    .execute();

  const withheld = new Set(source.withhold ?? []);

  return {
    label: source.label,
    table: source.table,
    rowCount: rows.length,
    rows: rows.map((row) =>
      Object.fromEntries(
        Object.entries(row)
          .filter(([column]) => !withheld.has(column))
          .map(([column, value]) => [column, serialisable(value)]),
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
  const account = await database
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
    sections.push(await readSection(database, source, userId));
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
};
