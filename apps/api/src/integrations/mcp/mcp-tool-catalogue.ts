import type { Capability, McpOperation } from "@stockcontrol/contracts";

import type { McpConfiguration } from "./mcp-configuration";
import { safeJsonObject } from "./mcp-utils";
import type { McpScope } from "./oauth.service";

/**
 * The tool contract, kept apart from the executor that runs it. A tool is a
 * name, the scope and role capability it needs, the shape it accepts and the
 * shape it answers with — nothing here reaches a database. Effective
 * permission stays the intersection of the granted OAuth scope and the
 * caller's live role capability, so a tool added here can never widen what a
 * role may do.
 */

export const CONTRACT_VERSION = "1.3";
export const MAX_LIMIT = 100;
export const MAX_OFFSET = 10_000;
const MAX_DATE_RANGE_MS = 31 * 86_400_000;

export interface ToolSpec {
  readonly name: string;
  readonly operation: McpOperation;
  readonly scopes: readonly McpScope[];
  readonly capability: Capability;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  /** Deletes something a later call cannot recreate. */
  readonly destructive?: boolean;
  readonly project: (value: unknown) => Readonly<Record<string, unknown>>;
  readonly validate: (value: unknown) => Readonly<Record<string, unknown>>;
}

export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly annotations?: Readonly<Record<string, unknown>>;
}

export class ToolValidationError extends Error {
  public constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "ToolValidationError";
  }
}

const record = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};

const text = (value: unknown, field: string, maximum = 200): string => {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    throw new ToolValidationError(field, `Enter ${field}.`);
  }
  return value.trim();
};

const optionalText = (value: unknown, field: string, maximum = 200): string | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return text(value, field, maximum);
};

/**
 * Audit projection is deliberately non-validating. Invalid input still needs
 * a durable Received record; validation happens only after authentication and
 * the audit row has been written.
 */
const projectedOptionalText = (value: unknown, maximum = 200): string | undefined =>
  typeof value === "string" ? value.trim().slice(0, maximum) : undefined;

const id = (value: unknown, field: string): string => {
  const candidate = text(value, field, 80);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(candidate)
  ) {
    throw new ToolValidationError(field, `Enter a valid ${field}.`);
  }
  return candidate;
};

const page = (
  limitValue: unknown,
  offsetValue: unknown = undefined,
): { readonly limit: number; readonly offset: number } => {
  const limit = limitValue === undefined ? 50 : Number(limitValue);
  const offset = offsetValue === undefined ? 0 : Number(offsetValue);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new ToolValidationError("limit", `Limit must be between 1 and ${String(MAX_LIMIT)}.`);
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) {
    throw new ToolValidationError("offset", "Offset is outside the supported range.");
  }
  return { limit, offset };
};

const date = (value: unknown, field: string): string | undefined => {
  const candidate = optionalText(value, field, 40);
  if (candidate === undefined) {
    return undefined;
  }
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    throw new ToolValidationError(field, `Enter a valid ${field} timestamp.`);
  }
  return parsed.toISOString();
};

const validateRange = (from: string | undefined, to: string | undefined): void => {
  if (from === undefined || to === undefined) {
    return;
  }
  if (new Date(to).getTime() < new Date(from).getTime()) {
    throw new ToolValidationError("to", "The end of the date range must be after its start.");
  }
  if (new Date(to).getTime() - new Date(from).getTime() > MAX_DATE_RANGE_MS) {
    throw new ToolValidationError("to", "Date ranges are limited to 31 days.");
  }
};

const quantity = (value: unknown, field: string): string => {
  const candidate = text(value, field, 40);
  if (!/^\d+(?:\.\d{1,3})?$/u.test(candidate) || Number(candidate) <= 0) {
    throw new ToolValidationError(
      field,
      "Enter a quantity greater than zero with at most three decimal places.",
    );
  }
  return candidate;
};

/**
 * A stocktake may legitimately count zero, which every other quantity in the
 * system refuses.
 */
const countedQuantity = (value: unknown, field: string): string => {
  const candidate = text(value, field, 40);
  if (!/^\d+(?:\.\d{1,3})?$/u.test(candidate)) {
    throw new ToolValidationError(
      field,
      "Enter a counted quantity of zero or more with at most three decimal places.",
    );
  }
  return candidate;
};

const flag = (value: unknown, field: string): boolean => {
  if (typeof value !== "boolean") {
    throw new ToolValidationError(field, `Set ${field} to true or false.`);
  }
  return value;
};

const role = (value: unknown, field: string): string => {
  const candidate = text(value, field, 20);
  if (!["Engineer", "Office", "Admin"].includes(candidate)) {
    throw new ToolValidationError(field, "Choose Engineer, Office or Admin.");
  }
  return candidate;
};

const imageMediaType = (value: unknown, field: string): "image/png" | "image/jpeg" => {
  const candidate = text(value, field, 20);
  if (candidate !== "image/png" && candidate !== "image/jpeg") {
    throw new ToolValidationError(field, "Use image/png or image/jpeg.");
  }
  return candidate;
};

/**
 * The size limit lives where the bytes are actually decoded
 * (`PhotosService`, against `PHOTO_MAX_BYTES`), not here — this only rejects
 * an empty or non-string payload before it reaches the transaction.
 */
const imageBytes = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new ToolValidationError(field, "Provide the image bytes as base64.");
  }
  return value;
};

type FieldKind =
  | "uuid"
  | "quantity"
  | "countedQuantity"
  | "text"
  | "note"
  | "nullableText"
  | "nullableQuantity"
  | "role"
  | "flag";

interface FieldSpec {
  readonly kind: FieldKind;
  readonly required?: boolean;
  readonly maximum?: number;
}

const validateField = (
  kind: FieldKind,
  value: unknown,
  field: string,
  maximum: number,
): unknown => {
  switch (kind) {
    case "uuid":
      return id(value, field);
    case "quantity":
      return quantity(value, field);
    case "countedQuantity":
      return countedQuantity(value, field);
    case "note":
      return text(value, field, 500);
    case "role":
      return role(value, field);
    case "flag":
      return flag(value, field);
    case "nullableQuantity":
      return value === null ? null : quantity(value, field);
    case "nullableText":
      return value === null ? null : text(value, field, maximum);
    case "text":
      return text(value, field, maximum);
  }
};

/**
 * Every write carries a caller-written summary of what it believes it is doing
 * and an idempotency key, so a retried tool call replays its receipt instead of
 * moving stock twice. `null` is a deliberate clearing of an optional field and
 * survives validation; absent means leave it alone.
 */
const writeArguments = (
  value: unknown,
  fields: Readonly<Record<string, FieldSpec>>,
): Readonly<Record<string, unknown>> => {
  const input = record(value);
  const output: [string, unknown][] = [];
  for (const [field, spec] of Object.entries(fields)) {
    const candidate = input[field];
    const clearing = candidate === null && spec.kind.startsWith("nullable");
    if (!clearing && (candidate === undefined || candidate === null || candidate === "")) {
      if (spec.required === true) {
        throw new ToolValidationError(field, `Enter ${field}.`);
      }
      continue;
    }
    output.push([field, validateField(spec.kind, candidate, field, spec.maximum ?? 200)]);
  }
  output.push(["actionSummary", text(input["actionSummary"], "actionSummary", 300)]);
  output.push(["idempotencyKey", text(input["idempotencyKey"], "idempotencyKey", 200)]);
  return Object.fromEntries(output);
};

const required = (kind: FieldKind, maximum?: number): FieldSpec => ({
  kind,
  required: true,
  ...(maximum === undefined ? {} : { maximum }),
});

const optional = (kind: FieldKind, maximum?: number): FieldSpec => ({
  kind,
  ...(maximum === undefined ? {} : { maximum }),
});

const stringProperty = (maxLength: number): Readonly<Record<string, unknown>> => ({
  type: "string",
  maxLength,
});

const pagingProperties = {
  limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
  offset: { type: "integer", minimum: 0, maximum: MAX_OFFSET },
} as const;

/** Every write tool accepts the same two bookkeeping arguments. */
const writeProperties = (
  properties: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> => ({
  ...properties,
  actionSummary: stringProperty(300),
  idempotencyKey: stringProperty(200),
});

const writeSchema = (
  properties: Readonly<Record<string, unknown>>,
  requiredFields: readonly string[],
): Readonly<Record<string, unknown>> => ({
  type: "object",
  required: [...requiredFields, "actionSummary", "idempotencyKey"],
  additionalProperties: false,
  properties: writeProperties(properties),
});

const readSchema = (
  properties: Readonly<Record<string, unknown>> = {},
  requiredFields: readonly string[] = [],
): Readonly<Record<string, unknown>> => ({
  type: "object",
  ...(requiredFields.length === 0 ? {} : { required: [...requiredFields] }),
  additionalProperties: false,
  properties,
});

const passthrough = (value: unknown): Readonly<Record<string, unknown>> => safeJsonObject(value);

const idOnly =
  (field: string) =>
  (value: unknown): Readonly<Record<string, unknown>> => ({ [field]: record(value)[field] });

const readSpecs: readonly ToolSpec[] = [
  {
    name: "whoami",
    operation: "read",
    scopes: [],
    capability: "view",
    description:
      "Identify the StockControl user this connection acts as, their role, what that role may do and which scopes were granted.",
    inputSchema: readSchema(),
    project: () => ({}),
    validate: () => ({}),
  },
  {
    name: "get_operational_summary",
    operation: "read",
    scopes: ["activity:read"],
    capability: "view",
    description:
      "Summarise operational inventory, job, reservation and request activity in your role scope.",
    inputSchema: readSchema(),
    project: (value) => safeJsonObject(value),
    validate: () => ({}),
  },
  {
    name: "get_dashboard",
    operation: "read",
    scopes: ["activity:read"],
    capability: "view",
    description:
      "Read the full dashboard for your role: an Engineer's own jobs, reservations and requests, or the office view of low stock, open reservations, pending requests and recent movements.",
    inputSchema: readSchema(),
    project: () => ({}),
    validate: () => ({}),
  },
  {
    name: "search_items",
    operation: "read",
    scopes: ["stock:read"],
    capability: "view",
    description: "Search active StockControl items and their current availability.",
    inputSchema: readSchema({ search: stringProperty(200), ...pagingProperties }),
    project: (value) => {
      const input = record(value);
      return {
        search: projectedOptionalText(input["search"]),
        limit: input["limit"],
        offset: input["offset"],
      };
    },
    validate: (value) => {
      const input = record(value);
      const paging = page(input["limit"], input["offset"]);
      return { search: optionalText(input["search"], "search"), ...paging };
    },
  },
  {
    name: "get_item",
    operation: "read",
    scopes: ["stock:read"],
    capability: "view",
    description: "Get one item, its balances and role-scoped recent activity.",
    inputSchema: readSchema({ itemId: { type: "string" } }, ["itemId"]),
    project: idOnly("itemId"),
    validate: (value) => ({ itemId: id(record(value)["itemId"], "itemId") }),
  },
  {
    name: "lookup_item",
    operation: "read",
    scopes: ["stock:read"],
    capability: "view",
    description:
      "Resolve a scanned or typed code — an item reference, a supplier barcode or a part number — to the item it belongs to.",
    inputSchema: readSchema({ code: stringProperty(200) }, ["code"]),
    project: (value) => ({ code: projectedOptionalText(record(value)["code"]) }),
    validate: (value) => ({ code: text(record(value)["code"], "code") }),
  },
  {
    name: "list_low_stock_items",
    operation: "read",
    scopes: ["stock:read"],
    capability: "view",
    description: "List active items whose available quantity has fallen below their threshold.",
    inputSchema: readSchema({ ...pagingProperties }),
    project: (value) => safeJsonObject(value),
    validate: (value) => page(record(value)["limit"], record(value)["offset"]),
  },
  {
    name: "list_transactions",
    operation: "read",
    scopes: ["activity:read"],
    capability: "view",
    description: "List stock transactions in the caller's permitted activity scope.",
    inputSchema: readSchema({
      itemId: { type: "string" },
      jobId: { type: "string" },
      from: { type: "string", format: "date-time" },
      to: { type: "string", format: "date-time" },
      ...pagingProperties,
    }),
    project: (value) => safeJsonObject(value),
    validate: (value) => {
      const input = record(value);
      const from = date(input["from"], "from");
      const to = date(input["to"], "to");
      validateRange(from, to);
      const paging = page(input["limit"], input["offset"]);
      return {
        itemId: input["itemId"] === undefined ? undefined : id(input["itemId"], "itemId"),
        jobId: input["jobId"] === undefined ? undefined : id(input["jobId"], "jobId"),
        from,
        to,
        ...paging,
      };
    },
  },
  {
    name: "list_jobs",
    operation: "read",
    scopes: ["activity:read"],
    capability: "view",
    description: "List open or closed jobs visible to the caller.",
    inputSchema: readSchema({
      status: { type: "string", enum: ["Open", "Closed"] },
      search: stringProperty(200),
      ...pagingProperties,
    }),
    project: (value) => safeJsonObject(value),
    validate: (value) => {
      const input = record(value);
      const status = input["status"];
      if (status !== undefined && status !== "Open" && status !== "Closed")
        throw new ToolValidationError("status", "Status must be Open or Closed.");
      return {
        status,
        search: optionalText(input["search"], "search"),
        ...page(input["limit"], input["offset"]),
      };
    },
  },
  {
    name: "get_job",
    operation: "read",
    scopes: ["activity:read"],
    capability: "view",
    description: "Get one job, reservations, site stock and permitted recent activity.",
    inputSchema: readSchema({ jobId: { type: "string" } }, ["jobId"]),
    project: idOnly("jobId"),
    validate: (value) => ({ jobId: id(record(value)["jobId"], "jobId") }),
  },
  {
    name: "list_reservations",
    operation: "read",
    scopes: ["activity:read"],
    capability: "view",
    description:
      "List open reservations with the job they are committed to, narrowed to your own unless your role sees all activity.",
    inputSchema: readSchema({ limit: pagingProperties.limit }),
    project: (value) => safeJsonObject(value),
    validate: (value) => ({ limit: page(record(value)["limit"]).limit }),
  },
  {
    name: "list_stock_requests",
    operation: "read",
    scopes: ["activity:read"],
    capability: "view",
    description:
      "List stock requests, narrowed to your own requests unless your role can review the queue.",
    inputSchema: readSchema({
      status: { type: "string", enum: ["Pending", "Approved", "Rejected", "Cancelled"] },
      itemId: { type: "string" },
      jobId: { type: "string" },
      ...pagingProperties,
    }),
    project: (value) => safeJsonObject(value),
    validate: (value) => {
      const input = record(value);
      const status = input["status"];
      if (
        status !== undefined &&
        (typeof status !== "string" ||
          !["Pending", "Approved", "Rejected", "Cancelled"].includes(status))
      )
        throw new ToolValidationError("status", "That request status is not supported.");
      const paging = page(input["limit"], input["offset"]);
      return {
        status,
        itemId: input["itemId"] === undefined ? undefined : id(input["itemId"], "itemId"),
        jobId: input["jobId"] === undefined ? undefined : id(input["jobId"], "jobId"),
        ...paging,
      };
    },
  },
  {
    name: "list_locations",
    operation: "read",
    scopes: ["stock:read"],
    capability: "view",
    description: "List active stores and job sites with stable IDs.",
    inputSchema: readSchema({ ...pagingProperties }),
    project: (value) => safeJsonObject(value),
    validate: (value) => page(record(value)["limit"], record(value)["offset"]),
  },
  {
    name: "search_locations",
    operation: "read",
    scopes: ["stock:read"],
    capability: "view",
    description:
      "Find store locations by code, name or search alias, with the full path each one sits on.",
    inputSchema: readSchema({ query: stringProperty(100) }, ["query"]),
    project: (value) => ({ query: projectedOptionalText(record(value)["query"], 100) }),
    validate: (value) => ({ query: text(record(value)["query"], "query", 100) }),
  },
  {
    name: "list_maps",
    operation: "read",
    scopes: ["stock:read"],
    capability: "view",
    description: "List the location maps, their status and how many locations each one holds.",
    inputSchema: readSchema(),
    project: () => ({}),
    validate: () => ({}),
  },
  {
    name: "get_map",
    operation: "read",
    scopes: ["stock:read"],
    capability: "view",
    description: "Get one map with the locations drawn on it and the stock status of each.",
    inputSchema: readSchema({ mapId: { type: "string" } }, ["mapId"]),
    project: idOnly("mapId"),
    validate: (value) => ({ mapId: id(record(value)["mapId"], "mapId") }),
  },
  {
    name: "list_users",
    operation: "read",
    scopes: ["users:read"],
    capability: "viewAllActivity",
    description: "List StockControl accounts, their roles and whether each is still active.",
    inputSchema: readSchema(),
    project: () => ({}),
    validate: () => ({}),
  },
  {
    name: "get_user_activity",
    operation: "read",
    scopes: ["users:read"],
    capability: "manageUsers",
    description:
      "Read what one person has been doing: recent movements, reservations and requests.",
    inputSchema: readSchema({ userId: { type: "string" } }, ["userId"]),
    project: idOnly("userId"),
    validate: (value) => ({ userId: id(record(value)["userId"], "userId") }),
  },
  {
    name: "list_mcp_activity",
    operation: "read",
    scopes: ["activity:read"],
    capability: "view",
    description:
      "List this connection's own past MCP tool calls and how each one turned out. Always scoped to your own activity, regardless of role.",
    inputSchema: readSchema({
      from: { type: "string", format: "date-time" },
      to: { type: "string", format: "date-time" },
      tool: stringProperty(120),
      outcome: {
        type: "string",
        enum: ["Succeeded", "Denied", "Failed", "Interrupted", "Incomplete"],
      },
      operation: { type: "string", enum: ["read", "write"] },
      ...pagingProperties,
    }),
    project: (value) => safeJsonObject(value),
    validate: (value) => {
      const input = record(value);
      const from = date(input["from"], "from");
      const to = date(input["to"], "to");
      validateRange(from, to);
      const outcome = input["outcome"];
      if (
        outcome !== undefined &&
        (typeof outcome !== "string" ||
          !["Succeeded", "Denied", "Failed", "Interrupted", "Incomplete"].includes(outcome))
      )
        throw new ToolValidationError("outcome", "That outcome is not supported.");
      const operation = input["operation"];
      if (operation !== undefined && operation !== "read" && operation !== "write")
        throw new ToolValidationError("operation", "Operation must be read or write.");
      const paging = page(input["limit"], input["offset"]);
      return {
        from,
        to,
        tool: optionalText(input["tool"], "tool", 120),
        outcome,
        operation,
        ...paging,
      };
    },
  },
];

const writeSpecs: readonly ToolSpec[] = [
  {
    name: "request_stock",
    operation: "write",
    scopes: ["stock:request"],
    capability: "requestStock",
    description: "Create a stock request for a specific item, optionally for a job.",
    inputSchema: writeSchema(
      {
        itemId: { type: "string" },
        quantity: { type: "string" },
        jobId: { type: "string" },
        note: stringProperty(500),
      },
      ["itemId", "quantity"],
    ),
    project: passthrough,
    validate: (value) =>
      writeArguments(value, {
        itemId: required("uuid"),
        quantity: required("quantity"),
        jobId: optional("uuid"),
        note: optional("note"),
      }),
  },
  {
    name: "cancel_stock_request",
    operation: "write",
    scopes: ["stock:request"],
    capability: "requestStock",
    description:
      "Withdraw one of your own stock requests while it is still waiting for a decision.",
    inputSchema: writeSchema({ requestId: { type: "string" } }, ["requestId"]),
    project: passthrough,
    validate: (value) => writeArguments(value, { requestId: required("uuid") }),
  },
  {
    name: "reserve_stock",
    operation: "write",
    scopes: ["stock:write"],
    capability: "reserve",
    description: "Reserve a precise quantity of an item for an open job.",
    inputSchema: writeSchema(
      { jobId: { type: "string" }, itemId: { type: "string" }, quantity: { type: "string" } },
      ["jobId", "itemId", "quantity"],
    ),
    project: passthrough,
    validate: (value) =>
      writeArguments(value, {
        jobId: required("uuid"),
        itemId: required("uuid"),
        quantity: required("quantity"),
      }),
  },
  {
    name: "receive_stock",
    operation: "write",
    scopes: ["stock:write"],
    capability: "manageStock",
    description: "Receive a precise quantity of an item into a store location.",
    inputSchema: writeSchema(
      { itemId: { type: "string" }, locationId: { type: "string" }, quantity: { type: "string" } },
      ["itemId", "locationId", "quantity"],
    ),
    project: passthrough,
    validate: (value) =>
      writeArguments(value, {
        itemId: required("uuid"),
        locationId: required("uuid"),
        quantity: required("quantity"),
      }),
  },
  {
    name: "issue_stock",
    operation: "write",
    scopes: ["stock:write"],
    capability: "issue",
    description: "Issue a precise quantity of an item from a store location, optionally to a job.",
    inputSchema: writeSchema(
      {
        itemId: { type: "string" },
        locationId: { type: "string" },
        quantity: { type: "string" },
        jobId: { type: "string" },
      },
      ["itemId", "locationId", "quantity"],
    ),
    project: passthrough,
    validate: (value) =>
      writeArguments(value, {
        itemId: required("uuid"),
        locationId: required("uuid"),
        quantity: required("quantity"),
        jobId: optional("uuid"),
      }),
  },
  {
    name: "transfer_stock",
    operation: "write",
    scopes: ["stock:write"],
    capability: "manageStock",
    description: "Transfer a precise quantity between two explicit store locations.",
    inputSchema: writeSchema(
      {
        itemId: { type: "string" },
        fromLocationId: { type: "string" },
        toLocationId: { type: "string" },
        quantity: { type: "string" },
      },
      ["itemId", "fromLocationId", "toLocationId", "quantity"],
    ),
    project: passthrough,
    validate: (value) =>
      writeArguments(value, {
        itemId: required("uuid"),
        fromLocationId: required("uuid"),
        toLocationId: required("uuid"),
        quantity: required("quantity"),
      }),
  },
  {
    name: "adjust_stock",
    operation: "write",
    scopes: ["stock:write"],
    capability: "manageStock",
    description:
      "Correct the recorded quantity of an item in a store location to a counted figure, with a reason for the correction.",
    inputSchema: writeSchema(
      {
        itemId: { type: "string" },
        locationId: { type: "string" },
        countedQuantity: { type: "string" },
        reason: stringProperty(500),
      },
      ["itemId", "locationId", "countedQuantity", "reason"],
    ),
    project: passthrough,
    validate: (value) =>
      writeArguments(value, {
        itemId: required("uuid"),
        locationId: required("uuid"),
        countedQuantity: required("countedQuantity"),
        reason: required("note"),
      }),
  },
  {
    name: "collect_reserved_stock",
    operation: "write",
    scopes: ["stock:write"],
    capability: "collect",
    description: "Collect a precise quantity from an explicit reservation and store location.",
    inputSchema: writeSchema(
      {
        reservationId: { type: "string" },
        sourceLocationId: { type: "string" },
        quantity: { type: "string" },
      },
      ["reservationId", "sourceLocationId", "quantity"],
    ),
    project: passthrough,
    validate: (value) =>
      writeArguments(value, {
        reservationId: required("uuid"),
        sourceLocationId: required("uuid"),
        quantity: required("quantity"),
      }),
  },
  {
    name: "release_reservation",
    operation: "write",
    scopes: ["stock:write"],
    capability: "releaseReservation",
    description:
      "Give an uncollected reservation back to available stock, with a reason for the release.",
    inputSchema: writeSchema({ reservationId: { type: "string" }, reason: stringProperty(500) }, [
      "reservationId",
      "reason",
    ]),
    project: passthrough,
    validate: (value) =>
      writeArguments(value, { reservationId: required("uuid"), reason: required("note") }),
  },
  {
    name: "approve_stock_request",
    operation: "write",
    scopes: ["requests:review"],
    capability: "reviewStockRequests",
    description: "Approve one explicit pending stock request, optionally amending quantity.",
    inputSchema: writeSchema(
      {
        requestId: { type: "string" },
        quantity: { type: "string" },
        decisionNote: stringProperty(500),
      },
      ["requestId"],
    ),
    project: passthrough,
    validate: (value) =>
      writeArguments(value, {
        requestId: required("uuid"),
        quantity: optional("quantity"),
        decisionNote: optional("note"),
      }),
  },
  {
    name: "reject_stock_request",
    operation: "write",
    scopes: ["requests:review"],
    capability: "reviewStockRequests",
    description: "Reject one explicit pending stock request with a reason.",
    inputSchema: writeSchema({ requestId: { type: "string" }, decisionNote: stringProperty(500) }, [
      "requestId",
      "decisionNote",
    ]),
    project: passthrough,
    validate: (value) =>
      writeArguments(value, { requestId: required("uuid"), decisionNote: required("note") }),
  },
  {
    name: "create_item",
    operation: "write",
    scopes: ["catalogue:write"],
    capability: "manageCatalogue",
    description:
      "Add an item to the catalogue. The reference is allocated for you unless you supply one.",
    inputSchema: writeSchema(
      {
        name: stringProperty(200),
        unit: stringProperty(20),
        reference: stringProperty(60),
        barcode: stringProperty(60),
        partNumber: stringProperty(60),
        lowStockThreshold: { type: "string" },
      },
      ["name", "unit"],
    ),
    project: passthrough,
    validate: (value) =>
      writeArguments(value, {
        name: required("text"),
        unit: required("text", 20),
        reference: optional("text", 60),
        barcode: optional("text", 60),
        partNumber: optional("text", 60),
        lowStockThreshold: optional("quantity"),
      }),
  },
  {
    name: "update_item",
    operation: "write",
    scopes: ["catalogue:write"],
    capability: "manageCatalogue",
    description:
      "Change an item's details. Send null for barcode, partNumber or lowStockThreshold to clear it; an item's reference and history never change.",
    inputSchema: writeSchema(
      {
        itemId: { type: "string" },
        name: stringProperty(200),
        unit: stringProperty(20),
        barcode: { type: ["string", "null"], maxLength: 60 },
        partNumber: { type: ["string", "null"], maxLength: 60 },
        lowStockThreshold: { type: ["string", "null"] },
        isActive: { type: "boolean" },
      },
      ["itemId"],
    ),
    project: passthrough,
    validate: (value) =>
      writeArguments(value, {
        itemId: required("uuid"),
        name: optional("text"),
        unit: optional("text", 20),
        barcode: optional("nullableText", 60),
        partNumber: optional("nullableText", 60),
        lowStockThreshold: optional("nullableQuantity"),
        isActive: optional("flag"),
      }),
  },
  {
    name: "archive_item",
    operation: "write",
    scopes: ["catalogue:write"],
    capability: "manageCatalogue",
    description:
      "Retire an item from use. Its balances and history stay exactly where they are; it simply stops being usable in new stock operations.",
    inputSchema: writeSchema({ itemId: { type: "string" } }, ["itemId"]),
    project: passthrough,
    validate: (value) => writeArguments(value, { itemId: required("uuid") }),
  },
  {
    name: "set_item_cover_photo",
    operation: "write",
    scopes: ["catalogue:write"],
    capability: "manageCatalogue",
    description: "Make one of an item's existing photos the one shown first.",
    inputSchema: writeSchema({ itemId: { type: "string" }, photoId: { type: "string" } }, [
      "itemId",
      "photoId",
    ]),
    project: passthrough,
    validate: (value) =>
      writeArguments(value, { itemId: required("uuid"), photoId: required("uuid") }),
  },
  {
    name: "create_job",
    operation: "write",
    scopes: ["jobs:write"],
    capability: "manageJobs",
    description:
      "Open a job and the job-site location that belongs to it. The job number is allocated for you unless you supply one.",
    inputSchema: writeSchema(
      { name: stringProperty(200), customer: stringProperty(200), number: stringProperty(40) },
      ["name", "customer"],
    ),
    project: passthrough,
    validate: (value) =>
      writeArguments(value, {
        name: required("text"),
        customer: required("text"),
        number: optional("text", 40),
      }),
  },
  {
    name: "close_job",
    operation: "write",
    scopes: ["jobs:write"],
    capability: "manageJobs",
    description:
      "Close a job, releasing every uncollected reservation on it back to available stock.",
    inputSchema: writeSchema({ jobId: { type: "string" } }, ["jobId"]),
    project: passthrough,
    validate: (value) => writeArguments(value, { jobId: required("uuid") }),
  },
  {
    name: "assign_job",
    operation: "write",
    scopes: ["jobs:write"],
    capability: "manageJobs",
    description: "Put someone on a job. Assigning an already-assigned person changes nothing.",
    inputSchema: writeSchema({ jobId: { type: "string" }, userId: { type: "string" } }, [
      "jobId",
      "userId",
    ]),
    project: passthrough,
    validate: (value) =>
      writeArguments(value, { jobId: required("uuid"), userId: required("uuid") }),
  },
  {
    name: "unassign_job",
    operation: "write",
    scopes: ["jobs:write"],
    capability: "manageJobs",
    description: "Take someone off a job. Their recorded activity on it is untouched.",
    inputSchema: writeSchema({ jobId: { type: "string" }, userId: { type: "string" } }, [
      "jobId",
      "userId",
    ]),
    project: passthrough,
    validate: (value) =>
      writeArguments(value, { jobId: required("uuid"), userId: required("uuid") }),
  },
  {
    name: "archive_location",
    operation: "write",
    scopes: ["locations:write"],
    capability: "manageLocations",
    description:
      "Retire a store location without erasing it. Anything drawn inside it re-derives its parent from what remains.",
    inputSchema: writeSchema({ locationId: { type: "string" } }, ["locationId"]),
    project: passthrough,
    validate: (value) => writeArguments(value, { locationId: required("uuid") }),
  },
  {
    name: "delete_location",
    operation: "write",
    scopes: ["locations:write"],
    capability: "manageLocations",
    description:
      "Permanently delete a store location that was never used. A location with stock or history is refused and must be archived instead.",
    destructive: true,
    inputSchema: writeSchema({ locationId: { type: "string" } }, ["locationId"]),
    project: passthrough,
    validate: (value) => writeArguments(value, { locationId: required("uuid") }),
  },
  {
    name: "archive_map",
    operation: "write",
    scopes: ["locations:write"],
    capability: "manageLocations",
    description: "Archive a map and every location drawn on it.",
    inputSchema: writeSchema({ mapId: { type: "string" } }, ["mapId"]),
    project: passthrough,
    validate: (value) => writeArguments(value, { mapId: required("uuid") }),
  },
  {
    name: "update_user",
    operation: "write",
    scopes: ["users:write"],
    capability: "manageUsers",
    description:
      "Change an account's name, username, email address, role or active state. Passwords are never set through MCP. Send null for email to remove the address.",
    inputSchema: writeSchema(
      {
        userId: { type: "string" },
        username: stringProperty(60),
        email: { type: ["string", "null"], maxLength: 200 },
        displayName: stringProperty(200),
        role: { type: "string", enum: ["Engineer", "Office", "Admin"] },
        isActive: { type: "boolean" },
      },
      ["userId"],
    ),
    project: passthrough,
    validate: (value) =>
      writeArguments(value, {
        userId: required("uuid"),
        username: optional("text", 60),
        email: optional("nullableText"),
        displayName: optional("text"),
        role: optional("role"),
        isActive: optional("flag"),
      }),
  },
  {
    name: "deactivate_user",
    operation: "write",
    scopes: ["users:write"],
    capability: "manageUsers",
    description:
      "Stop an account signing in and end its live sessions. The last active Admin cannot be deactivated.",
    inputSchema: writeSchema({ userId: { type: "string" } }, ["userId"]),
    project: passthrough,
    validate: (value) => writeArguments(value, { userId: required("uuid") }),
  },
  {
    name: "create_map",
    operation: "write",
    scopes: ["locations:write"],
    capability: "manageLocations",
    description: "Create a new, empty location map with a code and a name.",
    inputSchema: writeSchema({ code: stringProperty(60), name: stringProperty(200) }, [
      "code",
      "name",
    ]),
    project: passthrough,
    validate: (value) =>
      writeArguments(value, { code: required("text", 60), name: required("text") }),
  },
  {
    name: "upload_item_photo",
    operation: "write",
    scopes: ["catalogue:write"],
    capability: "manageCatalogue",
    description:
      "Add a photo to an item. Accepts PNG or JPEG bytes as base64; an item can hold at most 10 photos.",
    inputSchema: writeSchema(
      {
        itemId: { type: "string" },
        originalFileName: stringProperty(255),
        mediaType: { type: "string", enum: ["image/png", "image/jpeg"] },
        contentBase64: { type: "string" },
      },
      ["itemId", "originalFileName", "mediaType", "contentBase64"],
    ),
    /**
     * Never writes the image bytes themselves into the audit trail — only
     * their length. The Received record still exists before validation, per
     * this file's rule that a projector must not make an invocation vanish,
     * but a multi-megabyte payload has no place in an insert-only log meant
     * for accountability, not blob storage.
     */
    project: (value) => {
      const input = record(value);
      const contentBase64 = input["contentBase64"];
      return {
        itemId: projectedOptionalText(input["itemId"], 80),
        originalFileName: projectedOptionalText(input["originalFileName"], 255),
        mediaType: projectedOptionalText(input["mediaType"], 20),
        contentBase64Length: typeof contentBase64 === "string" ? contentBase64.length : undefined,
      };
    },
    validate: (value) => {
      const input = record(value);
      return {
        itemId: id(input["itemId"], "itemId"),
        originalFileName: text(input["originalFileName"], "originalFileName", 255),
        mediaType: imageMediaType(input["mediaType"], "mediaType"),
        contentBase64: imageBytes(input["contentBase64"], "contentBase64"),
        actionSummary: text(input["actionSummary"], "actionSummary", 300),
        idempotencyKey: text(input["idempotencyKey"], "idempotencyKey", 200),
      };
    },
  },
  {
    name: "delete_item_photo",
    operation: "write",
    scopes: ["catalogue:write"],
    capability: "manageCatalogue",
    description: "Remove one of an item's photos.",
    inputSchema: writeSchema({ itemId: { type: "string" }, photoId: { type: "string" } }, [
      "itemId",
      "photoId",
    ]),
    project: passthrough,
    validate: (value) =>
      writeArguments(value, { itemId: required("uuid"), photoId: required("uuid") }),
  },
  {
    name: "create_user",
    operation: "write",
    scopes: ["users:write"],
    capability: "manageUsers",
    description:
      "Create a StockControl account. The account is created with no usable password — it cannot sign in until an Admin sets one through StockControl's own reset-password flow, since passwords are never set through MCP.",
    inputSchema: writeSchema(
      {
        username: stringProperty(60),
        email: stringProperty(200),
        displayName: stringProperty(200),
        role: { type: "string", enum: ["Engineer", "Office", "Admin"] },
      },
      ["username", "displayName", "role"],
    ),
    project: passthrough,
    validate: (value) =>
      writeArguments(value, {
        username: required("text", 60),
        email: optional("text", 200),
        displayName: required("text"),
        role: required("role"),
      }),
  },
];

export const toolSpecs: readonly ToolSpec[] = [...readSpecs, ...writeSpecs];

export const findToolSpec = (name: string): ToolSpec | undefined =>
  toolSpecs.find((candidate) => candidate.name === name);

const idSchema = { type: "string", format: "uuid" } as const;
const nullableIdSchema = { type: ["string", "null"], format: "uuid" } as const;

const itemSummarySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: idSchema,
    reference: { type: "string" },
    name: { type: "string" },
    unit: { type: "string" },
    barcode: { type: ["string", "null"] },
    partNumber: { type: ["string", "null"] },
    lowStockThreshold: { type: ["string", "null"] },
    isActive: { type: "boolean" },
    onHand: { type: "string" },
    inStores: { type: "string" },
    atJobSites: { type: "string" },
    reserved: { type: "string" },
    reservedForYou: { type: "string" },
    available: { type: "string" },
    belowThreshold: { type: "boolean" },
    coverPhotoUrl: { type: ["string", "null"] },
  },
  required: [
    "id",
    "reference",
    "name",
    "unit",
    "barcode",
    "partNumber",
    "lowStockThreshold",
    "isActive",
    "onHand",
    "inStores",
    "atJobSites",
    "reserved",
    "reservedForYou",
    "available",
    "belowThreshold",
    "coverPhotoUrl",
  ],
} as const;

const locationBalanceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    locationId: idSchema,
    locationCode: { type: "string" },
    locationName: { type: "string" },
    kind: { type: "string", enum: ["Store", "JobSite"] },
    quantity: { type: "string" },
    unit: { type: "string" },
  },
  required: ["locationId", "locationCode", "locationName", "kind", "quantity"],
} as const;

const itemPhotoSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: idSchema,
    url: { type: "string", format: "uri-reference" },
    originalFileName: { type: "string" },
    isCover: { type: "boolean" },
  },
  required: ["id", "url", "originalFileName", "isCover"],
} as const;

const transactionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: idSchema,
    kind: {
      type: "string",
      enum: ["Receive", "Issue", "Transfer", "Adjust", "Reserve", "Collect", "Release"],
    },
    itemId: idSchema,
    itemReference: { type: "string" },
    itemName: { type: "string" },
    itemPhotoUrl: { type: ["string", "null"] },
    unit: { type: "string" },
    quantity: { type: "string" },
    fromLocationCode: { type: ["string", "null"] },
    toLocationCode: { type: ["string", "null"] },
    jobNumber: { type: ["string", "null"] },
    reason: { type: ["string", "null"] },
    actorUserId: idSchema,
    actorName: { type: "string" },
    occurredAt: { type: "string", format: "date-time" },
  },
  required: [
    "id",
    "kind",
    "itemId",
    "itemReference",
    "itemName",
    "itemPhotoUrl",
    "unit",
    "quantity",
    "fromLocationCode",
    "toLocationCode",
    "jobNumber",
    "reason",
    "actorUserId",
    "actorName",
    "occurredAt",
  ],
} as const;

const itemDetailSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ...itemSummarySchema.properties,
    balances: { type: "array", items: locationBalanceSchema },
    recentTransactions: { type: "array", items: transactionSchema },
    photos: { type: "array", items: itemPhotoSchema },
  },
  required: [...itemSummarySchema.required, "balances", "recentTransactions", "photos"],
} as const;

const locationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: idSchema,
    code: { type: "string" },
    name: { type: "string" },
    kind: { type: "string", enum: ["Store", "JobSite"] },
    jobId: nullableIdSchema,
    isActive: { type: "boolean" },
    path: { type: "string" },
  },
  required: ["id", "code", "name", "kind", "jobId", "isActive", "path"],
} as const;

const locationSearchResultSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: idSchema,
    code: { type: "string" },
    name: { type: "string" },
    path: { type: "string" },
    status: { type: "string", enum: ["Active", "Archived"] },
    mapId: nullableIdSchema,
    matchedOn: { type: "string", enum: ["code", "name", "alias"] },
  },
  required: ["id", "code", "name", "path", "status", "mapId", "matchedOn"],
} as const;

const jobAssigneeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    userId: idSchema,
    displayName: { type: "string" },
    role: { type: "string", enum: ["Engineer", "Office", "Admin"] },
  },
  required: ["userId", "displayName", "role"],
} as const;

const jobSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: idSchema,
    number: { type: "string" },
    name: { type: "string" },
    customer: { type: "string" },
    status: { type: "string", enum: ["Open", "Closed"] },
    jobSiteLocationId: idSchema,
    openReservationCount: { type: "integer" },
    assignees: { type: "array", items: jobAssigneeSchema },
    createdAt: { type: "string", format: "date-time" },
    closedAt: { type: ["string", "null"], format: "date-time" },
  },
  required: [
    "id",
    "number",
    "name",
    "customer",
    "status",
    "jobSiteLocationId",
    "openReservationCount",
    "assignees",
    "createdAt",
    "closedAt",
  ],
} as const;

const reservationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: idSchema,
    itemId: idSchema,
    itemReference: { type: "string" },
    itemName: { type: "string" },
    itemPhotoUrl: { type: ["string", "null"] },
    unit: { type: "string" },
    quantityReserved: { type: "string" },
    quantityCollected: { type: "string" },
    quantityOutstanding: { type: "string" },
    status: { type: "string", enum: ["Open", "Fulfilled", "Released"] },
    createdById: idSchema,
    createdByName: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
  },
  required: [
    "id",
    "itemId",
    "itemReference",
    "itemName",
    "itemPhotoUrl",
    "unit",
    "quantityReserved",
    "quantityCollected",
    "quantityOutstanding",
    "status",
    "createdById",
    "createdByName",
    "createdAt",
  ],
} as const;

/** An open reservation carries the job it is committed to. */
const dashboardReservationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ...reservationSchema.properties,
    jobId: idSchema,
    jobNumber: { type: "string" },
    jobName: { type: "string" },
  },
  required: [...reservationSchema.required, "jobId", "jobNumber", "jobName"],
} as const;

const jobDetailSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ...jobSchema.properties,
    reservations: { type: "array", items: reservationSchema },
    jobSiteStock: { type: "array", items: locationBalanceSchema },
    recentTransactions: { type: "array", items: transactionSchema },
  },
  required: [...jobSchema.required, "reservations", "jobSiteStock", "recentTransactions"],
} as const;

const stockRequestSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: idSchema,
    reference: { type: "string" },
    itemId: idSchema,
    itemReference: { type: "string" },
    itemName: { type: "string" },
    itemPhotoUrl: { type: ["string", "null"] },
    unit: { type: "string" },
    jobId: nullableIdSchema,
    jobNumber: { type: ["string", "null"] },
    jobName: { type: ["string", "null"] },
    quantity: { type: "string" },
    note: { type: ["string", "null"] },
    status: { type: "string", enum: ["Pending", "Approved", "Rejected", "Cancelled"] },
    requestedById: idSchema,
    requestedByName: { type: "string" },
    decidedByName: { type: ["string", "null"] },
    decisionNote: { type: ["string", "null"] },
    reservationId: nullableIdSchema,
    createdAt: { type: "string", format: "date-time" },
    decidedAt: { type: ["string", "null"], format: "date-time" },
  },
  required: [
    "id",
    "reference",
    "itemId",
    "itemReference",
    "itemName",
    "itemPhotoUrl",
    "unit",
    "jobId",
    "jobNumber",
    "jobName",
    "quantity",
    "note",
    "status",
    "requestedById",
    "requestedByName",
    "decidedByName",
    "decisionNote",
    "reservationId",
    "createdAt",
    "decidedAt",
  ],
} as const;

const userSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: idSchema,
    username: { type: "string" },
    email: { type: ["string", "null"] },
    displayName: { type: "string" },
    role: { type: "string", enum: ["Engineer", "Office", "Admin"] },
    isActive: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    profilePhotoUrl: { type: ["string", "null"] },
  },
  required: [
    "id",
    "username",
    "email",
    "displayName",
    "role",
    "isActive",
    "createdAt",
    "profilePhotoUrl",
  ],
} as const;

const mapBackgroundSchema = {
  type: "object",
  properties: { kind: { type: "string", enum: ["Blank", "FloorPlan"] } },
  required: ["kind"],
} as const;

const mapSummarySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: idSchema,
    code: { type: "string" },
    name: { type: "string" },
    status: { type: "string", enum: ["Active", "Archived"] },
    revision: { type: "integer" },
    background: mapBackgroundSchema,
    locationCount: { type: "integer" },
  },
  required: ["id", "code", "name", "status", "revision", "background", "locationCount"],
} as const;

/**
 * Geometry and the stock-status summary are left open: their shapes are unions
 * the browser editor owns, and pinning them here would make a map tool fail
 * validation the moment the editor gains a shape.
 */
const mapLocationSchema = {
  type: "object",
  properties: {
    id: idSchema,
    code: { type: "string" },
    name: { type: "string" },
    status: { type: "string", enum: ["Active", "Archived"] },
    depth: { type: "integer" },
    path: { type: "string" },
  },
  required: ["id", "code", "name", "status", "path"],
} as const;

const mapSchema = {
  type: "object",
  properties: {
    id: idSchema,
    code: { type: "string" },
    name: { type: "string" },
    status: { type: "string", enum: ["Active", "Archived"] },
    revision: { type: "integer" },
    background: mapBackgroundSchema,
    locations: { type: "array", items: mapLocationSchema },
  },
  required: ["id", "code", "name", "status", "revision", "locations"],
} as const;

const pageSchema = (
  items: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> => ({
  type: "object",
  additionalProperties: false,
  properties: {
    rows: { type: "array", items },
    total: { type: "integer" },
    limit: { type: "integer" },
    offset: { type: "integer" },
    hasMore: { type: "boolean" },
  },
  required: ["rows", "total", "limit", "offset", "hasMore"],
});

const listSchema = (
  key: string,
  items: Readonly<Record<string, unknown>>,
  paged = true,
): Readonly<Record<string, unknown>> => ({
  type: "object",
  additionalProperties: false,
  properties: {
    [key]: { type: "array", items },
    ...(paged
      ? { limit: { type: "integer" }, offset: { type: "integer" }, hasMore: { type: "boolean" } }
      : {}),
  },
  required: paged ? [key, "limit", "offset", "hasMore"] : [key],
});

const wrapperSchema = (
  key: string,
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> => ({
  type: "object",
  additionalProperties: false,
  properties: { [key]: value },
  required: [key],
});

const stockOperationSchema = (reservationNullable: boolean): Readonly<Record<string, unknown>> => ({
  type: "object",
  additionalProperties: false,
  properties: {
    itemId: idSchema,
    transactionId: idSchema,
    reservationId: reservationNullable ? nullableIdSchema : idSchema,
  },
  required: ["itemId", "transactionId", "reservationId"],
});

const referenceSchema = (
  properties: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});

const operationalSummarySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    role: { type: "string", enum: ["Engineer", "Office", "Admin"] },
    assignedJobCount: { type: "integer" },
    openReservationCount: { type: "integer" },
    requestCount: { type: "integer" },
    counts: { type: "object" },
    lowStockCount: { type: "integer" },
    pendingRequestCount: { type: "integer" },
    recentTransactionCount: { type: "integer" },
  },
  required: ["role"],
} as const;

/**
 * The dashboard payload is a union discriminated on role, and the two arms
 * share no field but `role`. Describing it loosely keeps a client's schema
 * check honest rather than failing whichever arm it was not written for.
 */
const dashboardSchema = {
  type: "object",
  properties: { role: { type: "string", enum: ["Engineer", "Office", "Admin"] } },
  required: ["role"],
} as const;

const whoamiSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    userId: idSchema,
    username: { type: "string" },
    displayName: { type: "string" },
    role: { type: "string", enum: ["Engineer", "Office", "Admin"] },
    capabilities: { type: "array", items: { type: "string" } },
    scopes: { type: "array", items: { type: "string" } },
    clientId: { type: "string" },
    contractVersion: { type: "string" },
  },
  required: [
    "userId",
    "username",
    "displayName",
    "role",
    "capabilities",
    "scopes",
    "clientId",
    "contractVersion",
  ],
} as const;

const userActivitySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    user: userSchema,
    recentTransactions: { type: "array", items: transactionSchema },
    openReservations: { type: "array", items: dashboardReservationSchema },
    stockRequests: { type: "array", items: stockRequestSchema },
    counts: { type: "object" },
  },
  required: ["user", "recentTransactions", "openReservations", "stockRequests", "counts"],
} as const;

const mcpEffectLinkSchema = {
  type: "object",
  additionalProperties: false,
  properties: { type: { type: "string" }, id: { type: "string" } },
  required: ["type", "id"],
} as const;

const mcpToolCallSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: idSchema,
    correlationId: { type: "string" },
    actorUserId: nullableIdSchema,
    actorName: { type: ["string", "null"] },
    grantId: { type: ["string", "null"] },
    clientId: { type: ["string", "null"] },
    toolName: { type: "string" },
    contractVersion: { type: "string" },
    operation: { type: "string", enum: ["read", "write"] },
    outcome: {
      type: "string",
      enum: ["Succeeded", "Denied", "Failed", "Interrupted", "Incomplete"],
    },
    arguments: { type: "object" },
    actionSummary: { type: ["string", "null"] },
    failureCode: { type: ["string", "null"] },
    durationMs: { type: ["integer", "null"] },
    effectLinks: { type: "array", items: mcpEffectLinkSchema },
    receivedAt: { type: "string", format: "date-time" },
    completedAt: { type: ["string", "null"], format: "date-time" },
  },
  required: [
    "id",
    "correlationId",
    "actorUserId",
    "actorName",
    "grantId",
    "clientId",
    "toolName",
    "contractVersion",
    "operation",
    "outcome",
    "arguments",
    "actionSummary",
    "failureCode",
    "durationMs",
    "effectLinks",
    "receivedAt",
    "completedAt",
  ],
} as const;

const requestDecisionSchema = referenceSchema({
  requestId: { type: "string" },
  itemId: { type: "string" },
  jobId: { type: ["string", "null"] },
  reservationId: { type: ["string", "null"] },
});

const outputSchemas: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  whoami: whoamiSchema,
  get_operational_summary: operationalSummarySchema,
  get_dashboard: dashboardSchema,
  search_items: pageSchema(itemSummarySchema),
  get_item: wrapperSchema("item", itemDetailSchema),
  lookup_item: wrapperSchema("item", itemDetailSchema),
  list_low_stock_items: pageSchema(itemSummarySchema),
  list_transactions: pageSchema(transactionSchema),
  list_jobs: listSchema("jobs", jobSchema),
  get_job: wrapperSchema("job", jobDetailSchema),
  list_reservations: listSchema("reservations", dashboardReservationSchema, false),
  list_stock_requests: pageSchema(stockRequestSchema),
  list_locations: listSchema("locations", locationSchema),
  search_locations: listSchema("locations", locationSearchResultSchema, false),
  list_maps: listSchema("maps", mapSummarySchema, false),
  get_map: wrapperSchema("map", mapSchema),
  list_users: listSchema("users", userSchema, false),
  get_user_activity: userActivitySchema,
  request_stock: requestDecisionSchema,
  approve_stock_request: requestDecisionSchema,
  cancel_stock_request: referenceSchema({
    requestId: { type: "string" },
    itemId: { type: "string" },
    jobId: { type: ["string", "null"] },
  }),
  reject_stock_request: referenceSchema({
    requestId: { type: "string" },
    itemId: { type: "string" },
    jobId: { type: ["string", "null"] },
  }),
  reserve_stock: stockOperationSchema(false),
  collect_reserved_stock: stockOperationSchema(false),
  create_item: referenceSchema({ itemId: { type: "string" } }),
  update_item: referenceSchema({ itemId: { type: "string" } }),
  archive_item: referenceSchema({ itemId: { type: "string" } }),
  set_item_cover_photo: referenceSchema({
    itemId: { type: "string" },
    photoId: { type: "string" },
  }),
  create_job: referenceSchema({ jobId: { type: "string" }, locationId: { type: "string" } }),
  close_job: referenceSchema({
    jobId: { type: "string" },
    releasedReservationCount: { type: "integer" },
  }),
  assign_job: referenceSchema({ jobId: { type: "string" }, userId: { type: "string" } }),
  unassign_job: referenceSchema({ jobId: { type: "string" }, userId: { type: "string" } }),
  archive_location: referenceSchema({ locationId: { type: "string" } }),
  delete_location: referenceSchema({ locationId: { type: "string" } }),
  archive_map: referenceSchema({ mapId: { type: "string" } }),
  update_user: referenceSchema({ userId: { type: "string" } }),
  deactivate_user: referenceSchema({ userId: { type: "string" } }),
  create_map: referenceSchema({ mapId: { type: "string" } }),
  upload_item_photo: referenceSchema({ itemId: { type: "string" }, photoId: { type: "string" } }),
  delete_item_photo: referenceSchema({ itemId: { type: "string" }, photoId: { type: "string" } }),
  create_user: referenceSchema({ userId: { type: "string" } }),
  list_mcp_activity: pageSchema(mcpToolCallSchema),
};

const outputSchemaFor = (name: string): Readonly<Record<string, unknown>> =>
  outputSchemas[name] ?? stockOperationSchema(true);

const annotationsFor = (tool: ToolSpec): Readonly<Record<string, unknown>> =>
  tool.operation === "read"
    ? { readOnlyHint: true, openWorldHint: false }
    : {
        readOnlyHint: false,
        destructiveHint: tool.destructive === true,
        idempotentHint: true,
        openWorldHint: false,
      };

export const mcpToolDefinitions = (configuration: McpConfiguration): readonly McpToolDefinition[] =>
  toolSpecs
    .filter((tool) =>
      tool.operation === "read" ? configuration.readToolsEnabled : configuration.writeToolsEnabled,
    )
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: outputSchemaFor(tool.name),
      annotations: annotationsFor(tool),
    }));
