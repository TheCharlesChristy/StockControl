import { randomUUID } from "node:crypto";

import {
  capabilitiesForRole,
  roleHasCapability,
  idempotencyConflict,
  resourceUnavailable,
  type DashboardResponse,
} from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";
import type { FastifyRequest } from "fastify";

import type { CatalogueService } from "../../inventory/catalogue.service";
import { requireQuantity, type StockService } from "../../inventory/stock.service";
import type { DashboardService } from "../../dashboard/dashboard.service";
import type { JobsService } from "../../jobs/jobs.service";
import type { LocationsService } from "../../locations/locations.service";
import { listOpenReservations } from "../../persistence/read-models";
import type { StockRequestsService } from "../../requests/requests.service";
import type { UsersService } from "../../users/users.service";
import type { CorrelationContext, StructuredLogger } from "@stockcontrol/platform";
import type { StockControlDatabase } from "@stockcontrol/platform-database";
import type { Kysely, Transaction } from "kysely";

import type { McpConfiguration } from "./mcp-configuration";
import {
  CONTRACT_VERSION,
  findToolSpec,
  mcpToolDefinitions,
  ToolValidationError,
  type McpToolDefinition,
  type ToolSpec,
} from "./mcp-tool-catalogue";
import { canonicalJson, safeJsonObject, safeString, sha256 } from "./mcp-utils";
import { McpAuditService, type McpCallHandle, type McpEffectLinkInput } from "./mcp-audit.service";
import type { McpRateLimiter } from "./mcp-rate-limiter";
import type { McpPrincipal, OAuthService } from "./oauth.service";

export { mcpToolDefinitions, ToolValidationError };
export type { McpToolDefinition };

export interface McpExecutionResponse {
  readonly value?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
  readonly isError: boolean;
}

/**
 * Everything a tool can reach. Passing one object rather than a positional
 * list keeps a new tool's dependency from silently landing in the wrong
 * constructor slot.
 */
export interface McpToolServices {
  readonly database: Kysely<StockControlDatabase>;
  readonly audit: McpAuditService;
  readonly oauth: OAuthService;
  readonly configuration: McpConfiguration;
  readonly dashboard: DashboardService;
  readonly catalogue: CatalogueService;
  readonly stock: StockService;
  readonly jobs: JobsService;
  readonly requests: StockRequestsService;
  readonly locations: LocationsService;
  readonly users: UsersService;
  readonly correlation: CorrelationContext;
  readonly logger: StructuredLogger;
  readonly rateLimiter?: McpRateLimiter | undefined;
}

const record = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};

const asString = (value: unknown): string => value as string;
const asOptionalString = (value: unknown): string | undefined => value as string | undefined;
const asNumber = (value: unknown): number => value as number;

/** `undefined` leaves a field alone; `null` clears it. */
const optionalField = <T>(
  input: Readonly<Record<string, unknown>>,
  field: string,
): Readonly<Record<string, T>> =>
  Object.prototype.hasOwnProperty.call(input, field) && input[field] !== undefined
    ? ({ [field]: input[field] } as Readonly<Record<string, T>>)
    : {};

export class McpToolExecutor {
  private readonly activeCalls = new Set<string>();

  public constructor(private readonly services: McpToolServices) {}

  public tools(): readonly McpToolDefinition[] {
    return mcpToolDefinitions(this.services.configuration);
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
    const { audit, configuration, correlation, logger, rateLimiter } = this.services;
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
    const spec = findToolSpec(toolName);
    let projected: Readonly<Record<string, unknown>>;
    try {
      projected = spec?.project(rawArguments) ?? {};
    } catch {
      // A future projector must never be able to make an invocation vanish
      // before the immutable Received record exists.
      projected = safeJsonObject(rawArguments);
    }
    const handle = await audit.start({
      callId: randomUUID(),
      correlationId: correlation.normalize(request.headers["x-request-id"]),
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
        const failure = audit.failureFrom(error);
        await audit.event(handle.callId, "Failed", {
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
      if (!configuration.enabled) {
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
        (spec.operation === "read" && !configuration.readToolsEnabled) ||
        (spec.operation === "write" && !configuration.writeToolsEnabled)
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
      const rateLimit = rateLimiter?.check(principal.user.id, principal.grantId, spec.name);
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
        await audit.event(handle.callId, "Authorised", {
          actorUserId: principal.user.id,
          grantId: principal.grantId,
        });
        const value =
          spec.operation === "write"
            ? await this.runWrite(spec.name, argumentsValue, principal, handle)
            : await this.runRead(spec.name, argumentsValue, principal);
        if (spec.operation === "read") {
          const summary = McpAuditService.resultSummary(value);
          await audit.event(handle.callId, "Succeeded", {
            ...summary,
            durationMs: Date.now() - handle.receivedAt.getTime(),
          });
        }
        logger.log({
          event: "mcp.tool.succeeded",
          tool: spec.name,
          operation: spec.operation,
          actorUserId: principal.user.id,
          durationMs: Date.now() - handle.receivedAt.getTime(),
        });
        return { value, isError: false };
      } catch (error: unknown) {
        const failure = audit.failureFrom(error);
        await audit.event(handle.callId, "Failed", {
          actorUserId: principal.user.id,
          grantId: principal.grantId,
          failureCode: failure.code,
          durationMs: Date.now() - handle.receivedAt.getTime(),
          resultSummary: { outcome: "failed" },
        });
        logger.warn({
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
    return this.services.oauth.resolveAccessToken(token);
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
    const { catalogue, dashboard, jobs, locations, requests, stock, users } = this.services;
    const seesEverything = roleHasCapability(principal.user.role, "viewAllActivity");
    const viewer = {
      viewerUserId: principal.user.id,
      scopeActivityToViewer: !seesEverything,
    };
    const jobViewer = { ...viewer, restrictToAssignedJobs: !seesEverything };
    switch (name) {
      case "whoami":
        return {
          userId: principal.user.id,
          username: principal.user.username,
          displayName: principal.user.displayName,
          role: principal.user.role,
          capabilities: [...capabilitiesForRole(principal.user.role)],
          scopes: [...principal.scopes],
          clientId: principal.clientId,
          contractVersion: CONTRACT_VERSION,
        };
      case "get_operational_summary": {
        const view = await dashboard.forUser({
          id: principal.user.id,
          role: principal.user.role,
        });
        return operationalSummary(view);
      }
      case "get_dashboard":
        return dashboard.forUser({ id: principal.user.id, role: principal.user.role });
      case "search_items": {
        const page = await catalogue.listItems({
          search: asOptionalString(input["search"]),
          limit: asNumber(input["limit"]),
          offset: asNumber(input["offset"]),
          activeOnly: true,
          viewerUserId: principal.user.id,
        });
        return { ...page, hasMore: page.offset + page.rows.length < page.total };
      }
      case "get_item":
        return { item: await stock.itemDetail(asString(input["itemId"]), viewer) };
      case "lookup_item": {
        const match = await catalogue.findByCode(asString(input["code"]));
        if (match === undefined) {
          throw new ApplicationFailureException(
            resourceUnavailable({ detail: "No item matches that code." }),
          );
        }
        return { item: await stock.itemDetail(match.id, viewer) };
      }
      case "list_low_stock_items": {
        const page = await catalogue.listItems({
          limit: asNumber(input["limit"]),
          offset: asNumber(input["offset"]),
          activeOnly: true,
          belowThresholdOnly: true,
          viewerUserId: principal.user.id,
        });
        return { ...page, hasMore: page.offset + page.rows.length < page.total };
      }
      case "list_transactions": {
        const page = await catalogue.listTransactions({
          itemId: asOptionalString(input["itemId"]),
          jobId: asOptionalString(input["jobId"]),
          from: input["from"] === undefined ? undefined : new Date(asString(input["from"])),
          to: input["to"] === undefined ? undefined : new Date(asString(input["to"])),
          limit: asNumber(input["limit"]),
          offset: asNumber(input["offset"]),
          actorUserId: seesEverything ? undefined : principal.user.id,
        });
        return { ...page, hasMore: page.offset + page.rows.length < page.total };
      }
      case "list_jobs": {
        const limit = asNumber(input["limit"]);
        const page = await jobs.list({
          status: input["status"] as "Open" | "Closed" | undefined,
          search: asOptionalString(input["search"]),
          limit: limit + 1,
          offset: asNumber(input["offset"]),
          ...(seesEverything ? {} : { assignedTo: principal.user.id }),
        });
        return {
          jobs: page.slice(0, limit),
          limit,
          offset: asNumber(input["offset"]),
          hasMore: page.length > limit,
        };
      }
      case "get_job":
        return { job: await jobs.detail(asString(input["jobId"]), jobViewer) };
      case "list_reservations":
        return {
          reservations: await listOpenReservations(this.services.database, {
            limit: asNumber(input["limit"]),
            ...(seesEverything ? {} : { createdByUserId: principal.user.id }),
          }),
        };
      case "list_stock_requests": {
        const page = await requests.list({
          status: input["status"] as "Pending" | "Approved" | "Rejected" | "Cancelled" | undefined,
          itemId: asOptionalString(input["itemId"]),
          jobId: asOptionalString(input["jobId"]),
          requestedByUserId: roleHasCapability(principal.user.role, "reviewStockRequests")
            ? undefined
            : principal.user.id,
          limit: asNumber(input["limit"]),
          offset: asNumber(input["offset"]),
        });
        return { ...page, hasMore: page.offset + page.rows.length < page.total };
      }
      case "list_locations": {
        const limit = asNumber(input["limit"]);
        const page = await catalogue.listLocations({
          limit: limit + 1,
          offset: asNumber(input["offset"]),
          activeOnly: true,
        });
        return {
          locations: page.slice(0, limit),
          limit,
          offset: asNumber(input["offset"]),
          hasMore: page.length > limit,
        };
      }
      case "search_locations":
        return { locations: await locations.search(asString(input["query"])) };
      case "list_maps":
        return { maps: await locations.maps() };
      case "get_map":
        return { map: await locations.map(asString(input["mapId"])) };
      case "list_users":
        return { users: await users.list() };
      case "get_user_activity":
        return users.activity(asString(input["userId"]));
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
    const { audit, database } = this.services;
    const idempotencyKey = asString(input["idempotencyKey"]);
    const fingerprint = sha256(canonicalJson(input));
    return database.transaction().execute(async (tx) => {
      await audit.lockIdempotency(tx, principal.user.id, name, idempotencyKey);
      const prior = await audit.findReceipt(tx, principal.user.id, name, idempotencyKey);
      if (prior !== null) {
        if (prior.requestFingerprint !== fingerprint) {
          throw new ApplicationFailureException(
            idempotencyConflict({
              detail: "That idempotency key was already used with different arguments.",
            }),
          );
        }
        await audit.copyEffectLinks(tx, prior.callId, handle.callId);
        const summary = McpAuditService.resultSummary(prior.result);
        await audit.event(
          handle.callId,
          "Succeeded",
          { ...summary, durationMs: Date.now() - handle.receivedAt.getTime() },
          tx,
        );
        return prior.result;
      }

      const result = await this.executeWriteInTransaction(tx, name, input, principal);
      const compact = McpAuditService.compactWriteResult(result);
      await audit.insertReceipt(tx, {
        actorUserId: principal.user.id,
        toolName: name,
        idempotencyKey,
        requestFingerprint: fingerprint,
        callId: handle.callId,
        result: compact,
      });
      await audit.linkEffects(tx, handle.callId, effectsFor(result));
      const summary = McpAuditService.resultSummary(compact);
      await audit.event(
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
    const { catalogue, jobs, locations, requests, stock, users } = this.services;
    const seesEverything = roleHasCapability(principal.user.role, "viewAllActivity");
    const actor = {
      actorUserId: principal.user.id,
      scopeActivityToActor: !seesEverything,
    };
    const viewer = {
      viewerUserId: principal.user.id,
      scopeActivityToViewer: !seesEverything,
    };
    switch (name) {
      case "request_stock": {
        const request = await requests.createInTransaction(tx, {
          requestedByUserId: principal.user.id,
          itemId: asString(input["itemId"]),
          quantity: asString(input["quantity"]),
          jobId: asOptionalString(input["jobId"]) ?? null,
          note: asOptionalString(input["note"]) ?? null,
        });
        return {
          requestId: request.id,
          itemId: request.itemId,
          jobId: request.jobId,
          reservationId: request.reservationId,
        };
      }
      case "cancel_stock_request": {
        const request = await requests.cancelInTransaction(
          tx,
          asString(input["requestId"]),
          principal.user.id,
        );
        return { requestId: request.id, itemId: request.itemId, jobId: request.jobId };
      }
      case "reserve_stock":
        return stock.reserveInTransaction(tx, {
          ...actor,
          jobId: asString(input["jobId"]),
          itemId: asString(input["itemId"]),
          quantity: requireQuantity(asString(input["quantity"])),
        });
      case "receive_stock":
        return stock.receiveInTransaction(tx, {
          ...actor,
          itemId: asString(input["itemId"]),
          locationId: asString(input["locationId"]),
          quantity: requireQuantity(asString(input["quantity"])),
        });
      case "issue_stock":
        return stock.issueInTransaction(tx, {
          ...actor,
          itemId: asString(input["itemId"]),
          locationId: asString(input["locationId"]),
          quantity: requireQuantity(asString(input["quantity"])),
          jobId: asOptionalString(input["jobId"]) ?? null,
        });
      case "transfer_stock":
        return stock.transferInTransaction(tx, {
          ...actor,
          itemId: asString(input["itemId"]),
          fromLocationId: asString(input["fromLocationId"]),
          toLocationId: asString(input["toLocationId"]),
          quantity: requireQuantity(asString(input["quantity"])),
        });
      case "adjust_stock":
        return stock.adjustInTransaction(tx, {
          ...actor,
          itemId: asString(input["itemId"]),
          locationId: asString(input["locationId"]),
          countedQuantity: requireQuantity(asString(input["countedQuantity"]), "countedQuantity"),
          reason: asString(input["reason"]),
        });
      case "collect_reserved_stock":
        return stock.collectInTransaction(tx, {
          ...actor,
          reservationId: asString(input["reservationId"]),
          sourceLocationId: asString(input["sourceLocationId"]),
          quantity: requireQuantity(asString(input["quantity"])),
        });
      case "release_reservation":
        return stock.releaseInTransaction(tx, {
          ...actor,
          reservationId: asString(input["reservationId"]),
          reason: asString(input["reason"]),
        });
      case "approve_stock_request": {
        const request = await requests.approveInTransaction(tx, {
          requestId: asString(input["requestId"]),
          decidedByUserId: principal.user.id,
          decisionNote: asOptionalString(input["decisionNote"]) ?? null,
          scopeActivityToActor: actor.scopeActivityToActor,
          ...optionalField<string>(input, "quantity"),
        });
        return {
          requestId: request.id,
          itemId: request.itemId,
          jobId: request.jobId,
          reservationId: request.reservationId,
        };
      }
      case "reject_stock_request": {
        const request = await requests.rejectInTransaction(tx, {
          requestId: asString(input["requestId"]),
          decidedByUserId: principal.user.id,
          decisionNote: asString(input["decisionNote"]),
          scopeActivityToActor: actor.scopeActivityToActor,
        });
        return { requestId: request.id, itemId: request.itemId, jobId: request.jobId };
      }
      case "create_item": {
        const item = await catalogue.createItemInTransaction(
          tx,
          {
            reference: asOptionalString(input["reference"]) ?? null,
            name: asString(input["name"]),
            unit: asString(input["unit"]),
            barcode: asOptionalString(input["barcode"]) ?? null,
            partNumber: asOptionalString(input["partNumber"]) ?? null,
            lowStockThreshold: asOptionalString(input["lowStockThreshold"]) ?? null,
          },
          viewer,
        );
        return { itemId: item.id };
      }
      case "update_item": {
        const item = await catalogue.updateItemInTransaction(
          tx,
          asString(input["itemId"]),
          {
            ...optionalField<string>(input, "name"),
            ...optionalField<string>(input, "unit"),
            ...optionalField<string | null>(input, "barcode"),
            ...optionalField<string | null>(input, "partNumber"),
            ...optionalField<string | null>(input, "lowStockThreshold"),
            ...optionalField<boolean>(input, "isActive"),
          },
          viewer,
        );
        return { itemId: item.id };
      }
      case "archive_item": {
        const item = await catalogue.updateItemInTransaction(
          tx,
          asString(input["itemId"]),
          { isActive: false },
          viewer,
        );
        return { itemId: item.id };
      }
      case "set_item_cover_photo": {
        const item = await catalogue.setItemPhotoCoverInTransaction(
          tx,
          asString(input["itemId"]),
          asString(input["photoId"]),
          viewer,
        );
        return { itemId: item.id, photoId: asString(input["photoId"]) };
      }
      case "create_job": {
        const job = await jobs.createInTransaction(tx, {
          number: asOptionalString(input["number"]) ?? null,
          name: asString(input["name"]),
          customer: asString(input["customer"]),
        });
        return { jobId: job.id, locationId: job.locationId };
      }
      case "close_job":
        return stock.closeJobInTransaction(tx, principal.user.id, asString(input["jobId"]));
      case "assign_job":
        await jobs.assignInTransaction(
          tx,
          asString(input["jobId"]),
          asString(input["userId"]),
          principal.user.id,
        );
        return { jobId: asString(input["jobId"]), userId: asString(input["userId"]) };
      case "unassign_job":
        await jobs.unassignInTransaction(tx, asString(input["jobId"]), asString(input["userId"]));
        return { jobId: asString(input["jobId"]), userId: asString(input["userId"]) };
      case "archive_location":
        return locations.archiveInTransaction(tx, asString(input["locationId"]));
      case "delete_location":
        return locations.removeInTransaction(tx, asString(input["locationId"]));
      case "archive_map":
        return locations.archiveMapInTransaction(tx, asString(input["mapId"]), principal.user.id);
      case "update_user": {
        const user = await users.updateInTransaction(
          tx,
          principal.user.id,
          asString(input["userId"]),
          {
            ...optionalField<string>(input, "username"),
            ...optionalField<string | null>(input, "email"),
            ...optionalField<string>(input, "displayName"),
            ...optionalField<"Engineer" | "Office" | "Admin">(input, "role"),
            ...optionalField<boolean>(input, "isActive"),
          },
        );
        return { userId: user.id };
      }
      case "deactivate_user": {
        const user = await users.updateInTransaction(
          tx,
          principal.user.id,
          asString(input["userId"]),
          { isActive: false },
        );
        return { userId: user.id };
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
    await this.services.audit.event(handle.callId, event, {
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
  add("location", safe["locationId"]);
  add("map", safe["mapId"]);
  add("user", safe["userId"]);
  add("photo", safe["photoId"]);
  const nestedItem = safe["item"];
  if (typeof nestedItem === "object" && nestedItem !== null && !Array.isArray(nestedItem)) {
    add("item", (nestedItem as Readonly<Record<string, unknown>>)["id"]);
  }
  return effects;
};
