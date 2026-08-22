import { randomUUID } from "node:crypto";

import {
  roleHasCapability,
  idempotencyConflict,
  type DashboardResponse,
  type McpOperation,
} from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";
import type { FastifyRequest } from "fastify";

import type { CatalogueService } from "../../inventory/catalogue.service";
import { requireQuantity, type StockService } from "../../inventory/stock.service";
import type { DashboardService } from "../../dashboard/dashboard.service";
import type { JobsService } from "../../jobs/jobs.service";
import type { StockRequestsService } from "../../requests/requests.service";
import type { CorrelationContext, StructuredLogger } from "@stockcontrol/platform";
import type { StockControlDatabase } from "@stockcontrol/platform-database";
import type { Kysely, Transaction } from "kysely";

import type { McpConfiguration } from "./mcp-configuration";
import { canonicalJson, safeJsonObject, safeString, sha256 } from "./mcp-utils";
import { McpAuditService, type McpCallHandle, type McpEffectLinkInput } from "./mcp-audit.service";
import type { McpRateLimiter } from "./mcp-rate-limiter";
import type { McpPrincipal, McpScope, OAuthService } from "./oauth.service";

const CONTRACT_VERSION = "1.1";
const MAX_LIMIT = 100;
const MAX_OFFSET = 10_000;
const MAX_DATE_RANGE_MS = 31 * 86_400_000;

interface ToolSpec {
  readonly name: string;
  readonly operation: McpOperation;
  readonly scopes: readonly McpScope[];
  readonly capability:
    | "view"
    | "requestStock"
    | "manageStock"
    | "issue"
    | "reserve"
    | "collect"
    | "reviewStockRequests";
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
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

export interface McpExecutionResponse {
  readonly value?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
  readonly isError: boolean;
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

const toolSpecs: readonly ToolSpec[] = [
  {
    name: "get_operational_summary",
    operation: "read",
    scopes: ["activity:read"],
    capability: "view",
    description:
      "Summarise operational inventory, job, reservation and request activity in your role scope.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    project: (value) => safeJsonObject(value),
    validate: () => ({}),
  },
  {
    name: "search_items",
    operation: "read",
    scopes: ["stock:read"],
    capability: "view",
    description: "Search active StockControl items and their current availability.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        search: { type: "string", maxLength: 200 },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
        offset: { type: "integer", minimum: 0, maximum: MAX_OFFSET },
      },
    },
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
    inputSchema: {
      type: "object",
      required: ["itemId"],
      additionalProperties: false,
      properties: { itemId: { type: "string" } },
    },
    project: (value) => ({ itemId: record(value)["itemId"] }),
    validate: (value) => ({ itemId: id(record(value)["itemId"], "itemId") }),
  },
  {
    name: "list_transactions",
    operation: "read",
    scopes: ["activity:read"],
    capability: "view",
    description: "List stock transactions in the caller's permitted activity scope.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        itemId: { type: "string" },
        jobId: { type: "string" },
        from: { type: "string", format: "date-time" },
        to: { type: "string", format: "date-time" },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
        offset: { type: "integer", minimum: 0, maximum: MAX_OFFSET },
      },
    },
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
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string", enum: ["Open", "Closed"] },
        search: { type: "string", maxLength: 200 },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
        offset: { type: "integer", minimum: 0, maximum: MAX_OFFSET },
      },
    },
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
    inputSchema: {
      type: "object",
      required: ["jobId"],
      additionalProperties: false,
      properties: { jobId: { type: "string" } },
    },
    project: (value) => ({ jobId: record(value)["jobId"] }),
    validate: (value) => ({ jobId: id(record(value)["jobId"], "jobId") }),
  },
  {
    name: "list_stock_requests",
    operation: "read",
    scopes: ["activity:read"],
    capability: "view",
    description:
      "List stock requests, narrowed to your own requests unless your role can review the queue.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string", enum: ["Pending", "Approved", "Rejected", "Cancelled"] },
        itemId: { type: "string" },
        jobId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
        offset: { type: "integer", minimum: 0, maximum: MAX_OFFSET },
      },
    },
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
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
        offset: { type: "integer", minimum: 0, maximum: MAX_OFFSET },
      },
    },
    project: (value) => safeJsonObject(value),
    validate: (value) => page(record(value)["limit"], record(value)["offset"]),
  },
  {
    name: "request_stock",
    operation: "write",
    scopes: ["stock:request"],
    capability: "requestStock",
    description: "Create a stock request for a specific item, optionally for a job.",
    inputSchema: {
      type: "object",
      required: ["itemId", "quantity", "actionSummary", "idempotencyKey"],
      additionalProperties: false,
      properties: {
        itemId: { type: "string" },
        quantity: { type: "string" },
        jobId: { type: "string" },
        note: { type: "string", maxLength: 500 },
        actionSummary: { type: "string", maxLength: 300 },
        idempotencyKey: { type: "string", maxLength: 200 },
      },
    },
    project: (value) => safeJsonObject(value),
    validate: (value) =>
      writeArguments(value, { itemId: true, quantity: true, jobId: false, note: false }),
  },
  {
    name: "reserve_stock",
    operation: "write",
    scopes: ["stock:write"],
    capability: "reserve",
    description: "Reserve a precise quantity of an item for an open job.",
    inputSchema: {
      type: "object",
      required: ["jobId", "itemId", "quantity", "actionSummary", "idempotencyKey"],
      additionalProperties: false,
      properties: {
        jobId: { type: "string" },
        itemId: { type: "string" },
        quantity: { type: "string" },
        actionSummary: { type: "string", maxLength: 300 },
        idempotencyKey: { type: "string", maxLength: 200 },
      },
    },
    project: (value) => safeJsonObject(value),
    validate: (value) => writeArguments(value, { jobId: true, itemId: true, quantity: true }),
  },
  {
    name: "receive_stock",
    operation: "write",
    scopes: ["stock:write"],
    capability: "manageStock",
    description: "Receive a precise quantity of an item into a store location.",
    inputSchema: {
      type: "object",
      required: ["itemId", "locationId", "quantity", "actionSummary", "idempotencyKey"],
      additionalProperties: false,
      properties: {
        itemId: { type: "string" },
        locationId: { type: "string" },
        quantity: { type: "string" },
        actionSummary: { type: "string", maxLength: 300 },
        idempotencyKey: { type: "string", maxLength: 200 },
      },
    },
    project: (value) => safeJsonObject(value),
    validate: (value) => writeArguments(value, { itemId: true, locationId: true, quantity: true }),
  },
  {
    name: "issue_stock",
    operation: "write",
    scopes: ["stock:write"],
    capability: "issue",
    description: "Issue a precise quantity of an item from a store location, optionally to a job.",
    inputSchema: {
      type: "object",
      required: ["itemId", "locationId", "quantity", "actionSummary", "idempotencyKey"],
      additionalProperties: false,
      properties: {
        itemId: { type: "string" },
        locationId: { type: "string" },
        quantity: { type: "string" },
        jobId: { type: "string" },
        actionSummary: { type: "string", maxLength: 300 },
        idempotencyKey: { type: "string", maxLength: 200 },
      },
    },
    project: (value) => safeJsonObject(value),
    validate: (value) =>
      writeArguments(value, { itemId: true, locationId: true, quantity: true, jobId: false }),
  },
  {
    name: "transfer_stock",
    operation: "write",
    scopes: ["stock:write"],
    capability: "manageStock",
    description: "Transfer a precise quantity between two explicit store locations.",
    inputSchema: {
      type: "object",
      required: [
        "itemId",
        "fromLocationId",
        "toLocationId",
        "quantity",
        "actionSummary",
        "idempotencyKey",
      ],
      additionalProperties: false,
      properties: {
        itemId: { type: "string" },
        fromLocationId: { type: "string" },
        toLocationId: { type: "string" },
        quantity: { type: "string" },
        actionSummary: { type: "string", maxLength: 300 },
        idempotencyKey: { type: "string", maxLength: 200 },
      },
    },
    project: (value) => safeJsonObject(value),
    validate: (value) =>
      writeArguments(value, {
        itemId: true,
        fromLocationId: true,
        toLocationId: true,
        quantity: true,
      }),
  },
  {
    name: "collect_reserved_stock",
    operation: "write",
    scopes: ["stock:write"],
    capability: "collect",
    description: "Collect a precise quantity from an explicit reservation and store location.",
    inputSchema: {
      type: "object",
      required: [
        "reservationId",
        "sourceLocationId",
        "quantity",
        "actionSummary",
        "idempotencyKey",
      ],
      additionalProperties: false,
      properties: {
        reservationId: { type: "string" },
        sourceLocationId: { type: "string" },
        quantity: { type: "string" },
        actionSummary: { type: "string", maxLength: 300 },
        idempotencyKey: { type: "string", maxLength: 200 },
      },
    },
    project: (value) => safeJsonObject(value),
    validate: (value) =>
      writeArguments(value, { reservationId: true, sourceLocationId: true, quantity: true }),
  },
  {
    name: "approve_stock_request",
    operation: "write",
    scopes: ["requests:review"],
    capability: "reviewStockRequests",
    description: "Approve one explicit pending stock request, optionally amending quantity.",
    inputSchema: {
      type: "object",
      required: ["requestId", "actionSummary", "idempotencyKey"],
      additionalProperties: false,
      properties: {
        requestId: { type: "string" },
        quantity: { type: "string" },
        decisionNote: { type: "string", maxLength: 500 },
        actionSummary: { type: "string", maxLength: 300 },
        idempotencyKey: { type: "string", maxLength: 200 },
      },
    },
    project: (value) => safeJsonObject(value),
    validate: (value) =>
      writeArguments(value, { requestId: true, quantity: false, decisionNote: false }),
  },
  {
    name: "reject_stock_request",
    operation: "write",
    scopes: ["requests:review"],
    capability: "reviewStockRequests",
    description: "Reject one explicit pending stock request with a reason.",
    inputSchema: {
      type: "object",
      required: ["requestId", "decisionNote", "actionSummary", "idempotencyKey"],
      additionalProperties: false,
      properties: {
        requestId: { type: "string" },
        decisionNote: { type: "string", maxLength: 500 },
        actionSummary: { type: "string", maxLength: 300 },
        idempotencyKey: { type: "string", maxLength: 200 },
      },
    },
    project: (value) => safeJsonObject(value),
    validate: (value) => writeArguments(value, { requestId: true, decisionNote: true }),
  },
];

export class ToolValidationError extends Error {
  public constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "ToolValidationError";
  }
}

const writeArguments = (
  value: unknown,
  requiredFields: Readonly<Record<string, boolean>>,
): Readonly<Record<string, unknown>> => {
  const input = record(value);
  const output: [string, unknown][] = [];
  for (const [field, required] of Object.entries(requiredFields)) {
    const candidate = input[field];
    if (candidate === undefined || candidate === null || candidate === "") {
      if (required) {
        throw new ToolValidationError(field, `Enter ${field}.`);
      }
      continue;
    }
    if (field.endsWith("Id")) {
      output.push([field, id(candidate, field)]);
    } else if (field === "quantity") {
      const quantity = text(candidate, field, 40);
      if (!/^\d+(?:\.\d{1,3})?$/u.test(quantity) || Number(quantity) <= 0) {
        throw new ToolValidationError(
          field,
          "Enter a quantity greater than zero with at most three decimal places.",
        );
      }
      output.push([field, quantity]);
    } else if (field === "note" || field === "decisionNote") {
      output.push([field, text(candidate, field, 500)]);
    }
  }
  output.push(["actionSummary", text(input["actionSummary"], "actionSummary", 300)]);
  output.push(["idempotencyKey", text(input["idempotencyKey"], "idempotencyKey", 200)]);
  return Object.fromEntries(output);
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
      ...(tool.operation === "read"
        ? { annotations: { readOnlyHint: true, openWorldHint: false } }
        : {
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false,
            },
          }),
    }));

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

const outputSchemaFor = (name: string): Readonly<Record<string, unknown>> => {
  if (name === "search_items") {
    return pageSchema(itemSummarySchema);
  }
  if (name === "list_transactions") {
    return pageSchema(transactionSchema);
  }
  if (name === "list_stock_requests") {
    return pageSchema(stockRequestSchema);
  }
  if (name === "list_jobs")
    return {
      type: "object",
      additionalProperties: false,
      properties: {
        jobs: { type: "array", items: jobSchema },
        limit: { type: "integer" },
        offset: { type: "integer" },
        hasMore: { type: "boolean" },
      },
      required: ["jobs", "limit", "offset", "hasMore"],
    };
  if (name === "list_locations") {
    return {
      type: "object",
      additionalProperties: false,
      properties: {
        locations: { type: "array", items: locationSchema },
        limit: { type: "integer" },
        offset: { type: "integer" },
        hasMore: { type: "boolean" },
      },
      required: ["locations", "limit", "offset", "hasMore"],
    };
  }
  if (name === "get_item")
    return {
      type: "object",
      additionalProperties: false,
      properties: {
        item: itemDetailSchema,
      },
      required: ["item"],
    };
  if (name === "get_job")
    return {
      type: "object",
      additionalProperties: false,
      properties: {
        job: jobDetailSchema,
      },
      required: ["job"],
    };
  if (name === "get_operational_summary") {
    return operationalSummarySchema;
  }
  if (name === "request_stock" || name === "approve_stock_request") {
    return {
      type: "object",
      additionalProperties: false,
      properties: {
        requestId: { type: "string" },
        itemId: { type: "string" },
        jobId: { type: ["string", "null"] },
        reservationId: { type: ["string", "null"] },
      },
      required: ["requestId", "itemId", "jobId", "reservationId"],
    };
  }
  if (name === "reject_stock_request") {
    return {
      type: "object",
      additionalProperties: false,
      properties: {
        requestId: { type: "string" },
        itemId: { type: "string" },
        jobId: { type: ["string", "null"] },
      },
      required: ["requestId", "itemId", "jobId"],
    };
  }
  if (["reserve_stock", "collect_reserved_stock"].includes(name)) {
    return stockOperationSchema(false);
  }
  return stockOperationSchema(true);
};

export class McpToolExecutor {
  private readonly activeCalls = new Set<string>();

  public constructor(
    private readonly database: Kysely<StockControlDatabase>,
    private readonly audit: McpAuditService,
    private readonly oauth: OAuthService,
    private readonly configuration: McpConfiguration,
    private readonly dashboard: DashboardService,
    private readonly catalogue: CatalogueService,
    private readonly stock: StockService,
    private readonly jobs: JobsService,
    private readonly requests: StockRequestsService,
    private readonly correlation: CorrelationContext,
    private readonly logger: StructuredLogger,
    private readonly rateLimiter?: McpRateLimiter,
  ) {}

  public tools(): readonly McpToolDefinition[] {
    return mcpToolDefinitions(this.configuration);
  }

  public isInFlight(callId: string): boolean {
    return this.activeCalls.has(callId);
  }

  public authenticate(request: FastifyRequest): Promise<McpPrincipal | null> {
    return this.principalFrom(request);
  }

  public async execute(
    request: FastifyRequest,
    toolName: string,
    rawArguments: unknown,
    clientRequestId: string | null,
  ): Promise<McpExecutionResponse> {
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string" || !/^Bearer\s+\S+$/iu.test(authorization)) {
      return {
        error: {
          code: "mcp.authentication_required",
          message: "Authenticate with an OAuth bearer token.",
        },
        isError: true,
      };
    }
    const spec = toolSpecs.find((candidate) => candidate.name === toolName);
    let projected: Readonly<Record<string, unknown>>;
    try {
      projected = spec?.project(rawArguments) ?? {};
    } catch {
      // A future projector must never be able to make an invocation vanish
      // before the immutable Received record exists.
      projected = safeJsonObject(rawArguments);
    }
    const handle = await this.audit.start({
      callId: randomUUID(),
      correlationId: this.correlation.normalize(request.headers["x-request-id"]),
      actorUserId: null,
      grantId: null,
      toolName: toolName.slice(0, 120),
      contractVersion: CONTRACT_VERSION,
      operation: spec?.operation ?? "read",
      arguments: projected,
      actionSummary: safeString(record(rawArguments)["actionSummary"]),
      clientRequestId: clientRequestId?.slice(0, 200) ?? null,
    });
    this.activeCalls.add(handle.callId);

    try {
      let principal: McpPrincipal | null;
      try {
        principal = await this.principalFrom(request);
      } catch (error: unknown) {
        const failure = this.audit.failureFrom(error);
        await this.audit.event(handle.callId, "Failed", {
          failureCode: failure.code,
          durationMs: Date.now() - handle.receivedAt.getTime(),
          resultSummary: { outcome: "failed" },
        });
        return {
          error: { code: failure.code, message: "Authentication could not be completed." },
          isError: true,
        };
      }
      if (principal === null) {
        return this.failure(
          handle,
          "Denied",
          "mcp.authentication_required",
          "Authenticate with an OAuth bearer token.",
        );
      }
      if (!this.configuration.enabled) {
        return this.failure(
          handle,
          "Denied",
          "mcp.disabled",
          "The MCP integration is not enabled.",
          principal,
        );
      }
      if (
        spec === undefined ||
        (spec.operation === "read" && !this.configuration.readToolsEnabled) ||
        (spec.operation === "write" && !this.configuration.writeToolsEnabled)
      ) {
        return this.failure(
          handle,
          "Denied",
          "mcp.tool_disabled",
          "That tool is not enabled.",
          principal,
        );
      }

      let argumentsValue: Readonly<Record<string, unknown>>;
      try {
        argumentsValue = spec.validate(rawArguments);
      } catch (error: unknown) {
        const message =
          error instanceof ToolValidationError
            ? error.message
            : "The tool arguments were not accepted.";
        return this.failure(handle, "Failed", "mcp.invalid_arguments", message, principal);
      }

      if (!this.authorised(principal, spec)) {
        return this.failure(
          handle,
          "Denied",
          "mcp.permission_denied",
          "Your current StockControl role or granted scope cannot use this tool.",
          principal,
        );
      }
      const rateLimit = this.rateLimiter?.check(principal.user.id, principal.grantId, spec.name);
      if (rateLimit !== undefined && !rateLimit.allowed) {
        return this.failure(
          handle,
          "Denied",
          "mcp.rate_limited",
          "This MCP connection is temporarily rate limited.",
          principal,
        );
      }
      try {
        await this.audit.event(handle.callId, "Authorised", {
          actorUserId: principal.user.id,
          grantId: principal.grantId,
        });
        const value =
          spec.operation === "write"
            ? await this.runWrite(spec.name, argumentsValue, principal, handle)
            : await this.runRead(spec.name, argumentsValue, principal);
        if (spec.operation === "read") {
          const summary = McpAuditService.resultSummary(value);
          await this.audit.event(handle.callId, "Succeeded", {
            ...summary,
            durationMs: Date.now() - handle.receivedAt.getTime(),
          });
        }
        this.logger.log({
          event: "mcp.tool.succeeded",
          tool: spec.name,
          operation: spec.operation,
          actorUserId: principal.user.id,
          durationMs: Date.now() - handle.receivedAt.getTime(),
        });
        return { value, isError: false };
      } catch (error: unknown) {
        const failure = this.audit.failureFrom(error);
        await this.audit.event(handle.callId, "Failed", {
          actorUserId: principal.user.id,
          grantId: principal.grantId,
          failureCode: failure.code,
          durationMs: Date.now() - handle.receivedAt.getTime(),
          resultSummary: { outcome: "failed" },
        });
        this.logger.warn({
          event: "mcp.tool.failed",
          tool: spec.name,
          failureCode: failure.code,
          actorUserId: principal.user.id,
        });
        return { error: { code: failure.code, message: failure.detail }, isError: true };
      }
    } finally {
      this.activeCalls.delete(handle.callId);
    }
  }

  private async principalFrom(request: FastifyRequest): Promise<McpPrincipal | null> {
    const header = request.headers.authorization;
    if (typeof header !== "string" || !/^Bearer\s+/iu.test(header)) {
      return null;
    }
    const token = header.replace(/^Bearer\s+/iu, "").trim();
    if (token.length === 0 || token.length > 512) return null;
    return this.oauth.resolveAccessToken(token);
  }

  private authorised(principal: McpPrincipal, spec: ToolSpec): boolean {
    return (
      spec.scopes.every((scope) => principal.scopes.includes(scope)) &&
      roleHasCapability(principal.user.role, spec.capability)
    );
  }

  private async runRead(
    name: string,
    input: Readonly<Record<string, unknown>>,
    principal: McpPrincipal,
  ): Promise<unknown> {
    const viewer = {
      viewerUserId: principal.user.id,
      scopeActivityToViewer: !roleHasCapability(principal.user.role, "viewAllActivity"),
    };
    const jobViewer = {
      ...viewer,
      restrictToAssignedJobs: !roleHasCapability(principal.user.role, "viewAllActivity"),
    };
    switch (name) {
      case "get_operational_summary": {
        const dashboard = await this.dashboard.forUser({
          id: principal.user.id,
          role: principal.user.role,
        });
        return operationalSummary(dashboard);
      }
      case "search_items": {
        const page = await this.catalogue.listItems({
          search: input["search"] as string | undefined,
          limit: input["limit"] as number,
          offset: input["offset"] as number,
          activeOnly: true,
          viewerUserId: principal.user.id,
        });
        return { ...page, hasMore: page.offset + page.rows.length < page.total };
      }
      case "get_item":
        return { item: await this.stock.itemDetail(input["itemId"] as string, viewer) };
      case "list_transactions": {
        const page = await this.catalogue.listTransactions({
          itemId: input["itemId"] as string | undefined,
          jobId: input["jobId"] as string | undefined,
          from: input["from"] === undefined ? undefined : new Date(input["from"] as string),
          to: input["to"] === undefined ? undefined : new Date(input["to"] as string),
          limit: input["limit"] as number,
          offset: input["offset"] as number,
          actorUserId: roleHasCapability(principal.user.role, "viewAllActivity")
            ? undefined
            : principal.user.id,
        });
        return { ...page, hasMore: page.offset + page.rows.length < page.total };
      }
      case "list_jobs": {
        const limit = input["limit"] as number;
        const page = await this.jobs.list({
          status: input["status"] as "Open" | "Closed" | undefined,
          search: input["search"] as string | undefined,
          limit: limit + 1,
          offset: input["offset"] as number,
          ...(roleHasCapability(principal.user.role, "viewAllActivity")
            ? {}
            : { assignedTo: principal.user.id }),
        });
        return {
          jobs: page.slice(0, limit),
          limit,
          offset: input["offset"] as number,
          hasMore: page.length > limit,
        };
      }
      case "get_job":
        return { job: await this.jobs.detail(input["jobId"] as string, jobViewer) };
      case "list_stock_requests": {
        const page = await this.requests.list({
          status: input["status"] as "Pending" | "Approved" | "Rejected" | "Cancelled" | undefined,
          itemId: input["itemId"] as string | undefined,
          jobId: input["jobId"] as string | undefined,
          requestedByUserId: roleHasCapability(principal.user.role, "reviewStockRequests")
            ? undefined
            : principal.user.id,
          limit: input["limit"] as number,
          offset: input["offset"] as number,
        });
        return { ...page, hasMore: page.offset + page.rows.length < page.total };
      }
      case "list_locations": {
        const limit = input["limit"] as number;
        const page = await this.catalogue.listLocations({
          limit: limit + 1,
          offset: input["offset"] as number,
          activeOnly: true,
        });
        return {
          locations: page.slice(0, limit),
          limit,
          offset: input["offset"] as number,
          hasMore: page.length > limit,
        };
      }
      default:
        throw new Error("Unknown MCP tool.");
    }
  }

  private async runWrite(
    name: string,
    input: Readonly<Record<string, unknown>>,
    principal: McpPrincipal,
    handle: McpCallHandle,
  ): Promise<Readonly<Record<string, unknown>>> {
    const idempotencyKey = input["idempotencyKey"] as string;
    const fingerprint = sha256(canonicalJson(input));
    return this.database.transaction().execute(async (tx) => {
      await this.audit.lockIdempotency(tx, principal.user.id, name, idempotencyKey);
      const prior = await this.audit.findReceipt(tx, principal.user.id, name, idempotencyKey);
      if (prior !== null) {
        if (prior.requestFingerprint !== fingerprint) {
          throw new ApplicationFailureException(
            idempotencyConflict({
              detail: "That idempotency key was already used with different arguments.",
            }),
          );
        }
        await this.audit.copyEffectLinks(tx, prior.callId, handle.callId);
        const summary = McpAuditService.resultSummary(prior.result);
        await this.audit.event(
          handle.callId,
          "Succeeded",
          { ...summary, durationMs: Date.now() - handle.receivedAt.getTime() },
          tx,
        );
        return prior.result;
      }

      const result = await this.executeWriteInTransaction(tx, name, input, principal);
      const compact = McpAuditService.compactWriteResult(result);
      await this.audit.insertReceipt(tx, {
        actorUserId: principal.user.id,
        toolName: name,
        idempotencyKey,
        requestFingerprint: fingerprint,
        callId: handle.callId,
        result: compact,
      });
      await this.audit.linkEffects(tx, handle.callId, effectsFor(result));
      const summary = McpAuditService.resultSummary(compact);
      await this.audit.event(
        handle.callId,
        "Succeeded",
        { ...summary, durationMs: Date.now() - handle.receivedAt.getTime() },
        tx,
      );
      return compact;
    });
  }

  private async executeWriteInTransaction(
    tx: Transaction<StockControlDatabase>,
    name: string,
    input: Readonly<Record<string, unknown>>,
    principal: McpPrincipal,
  ): Promise<unknown> {
    const actor = {
      actorUserId: principal.user.id,
      scopeActivityToActor: !roleHasCapability(principal.user.role, "viewAllActivity"),
    };
    switch (name) {
      case "request_stock": {
        const request = await this.requests.createInTransaction(tx, {
          requestedByUserId: principal.user.id,
          itemId: input["itemId"] as string,
          quantity: input["quantity"] as string,
          jobId: (input["jobId"] as string | undefined) ?? null,
          note: (input["note"] as string | undefined) ?? null,
        });
        return {
          requestId: request.id,
          itemId: request.itemId,
          jobId: request.jobId,
          reservationId: request.reservationId,
        };
      }
      case "reserve_stock":
        return this.stock.reserveInTransaction(tx, {
          ...actor,
          jobId: input["jobId"] as string,
          itemId: input["itemId"] as string,
          quantity: requireQuantity(input["quantity"] as string),
        });
      case "receive_stock":
        return this.stock.receiveInTransaction(tx, {
          ...actor,
          itemId: input["itemId"] as string,
          locationId: input["locationId"] as string,
          quantity: requireQuantity(input["quantity"] as string),
        });
      case "issue_stock":
        return this.stock.issueInTransaction(tx, {
          ...actor,
          itemId: input["itemId"] as string,
          locationId: input["locationId"] as string,
          quantity: requireQuantity(input["quantity"] as string),
          jobId: (input["jobId"] as string | undefined) ?? null,
        });
      case "transfer_stock":
        return this.stock.transferInTransaction(tx, {
          ...actor,
          itemId: input["itemId"] as string,
          fromLocationId: input["fromLocationId"] as string,
          toLocationId: input["toLocationId"] as string,
          quantity: requireQuantity(input["quantity"] as string),
        });
      case "collect_reserved_stock":
        return this.stock.collectInTransaction(tx, {
          ...actor,
          reservationId: input["reservationId"] as string,
          sourceLocationId: input["sourceLocationId"] as string,
          quantity: requireQuantity(input["quantity"] as string),
        });
      case "approve_stock_request": {
        const request = await this.requests.approveInTransaction(tx, {
          requestId: input["requestId"] as string,
          decidedByUserId: principal.user.id,
          decisionNote: (input["decisionNote"] as string | undefined) ?? null,
          scopeActivityToActor: actor.scopeActivityToActor,
          ...(input["quantity"] === undefined ? {} : { quantity: input["quantity"] as string }),
        });
        return {
          requestId: request.id,
          itemId: request.itemId,
          jobId: request.jobId,
          reservationId: request.reservationId,
        };
      }
      case "reject_stock_request": {
        const request = await this.requests.rejectInTransaction(tx, {
          requestId: input["requestId"] as string,
          decidedByUserId: principal.user.id,
          decisionNote: input["decisionNote"] as string,
          scopeActivityToActor: actor.scopeActivityToActor,
        });
        return { requestId: request.id, itemId: request.itemId, jobId: request.jobId };
      }
      default:
        throw new Error("Unknown MCP write tool.");
    }
  }

  private async failure(
    handle: McpCallHandle,
    event: "Denied" | "Failed",
    code: string,
    message: string,
    principal: McpPrincipal | null = null,
  ): Promise<McpExecutionResponse> {
    await this.audit.event(handle.callId, event, {
      actorUserId: principal?.user.id ?? null,
      grantId: principal?.grantId ?? null,
      failureCode: code,
      durationMs: Date.now() - handle.receivedAt.getTime(),
      resultSummary: { outcome: event.toLowerCase() },
    });
    this.activeCalls.delete(handle.callId);
    return { error: { code, message }, isError: true };
  }
}

const operationalSummary = (dashboard: DashboardResponse): Readonly<Record<string, unknown>> => {
  if (dashboard.role === "Engineer") {
    return {
      role: dashboard.role,
      assignedJobCount: dashboard.myJobs.length,
      openReservationCount: dashboard.myReservations.length,
      requestCount: dashboard.myRequests.length,
    };
  }
  return {
    role: dashboard.role,
    counts: dashboard.counts,
    lowStockCount: dashboard.lowStock.length,
    pendingRequestCount: dashboard.pendingRequests.length,
    recentTransactionCount: dashboard.recentTransactions.length,
  };
};

const effectsFor = (value: unknown): readonly McpEffectLinkInput[] => {
  const safe = safeJsonObject(value);
  const effects: McpEffectLinkInput[] = [];
  const add = (type: McpEffectLinkInput["type"], candidate: unknown): void => {
    if (typeof candidate === "string" && /^[0-9a-f-]{20,80}$/iu.test(candidate)) {
      effects.push({ type, id: candidate });
    }
  };
  add("transaction", safe["transactionId"]);
  add("reservation", safe["reservationId"]);
  add("request", safe["requestId"]);
  add("job", safe["jobId"]);
  add("item", safe["itemId"]);
  const nestedItem = safe["item"];
  if (typeof nestedItem === "object" && nestedItem !== null && !Array.isArray(nestedItem)) {
    add("item", (nestedItem as Readonly<Record<string, unknown>>)["id"]);
  }
  return effects;
};
