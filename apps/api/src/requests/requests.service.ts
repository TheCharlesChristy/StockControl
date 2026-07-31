import { randomUUID } from "node:crypto";

import type { StockRequestListResponse, StockRequestView } from "@stockcontrol/contracts";
import { resourceUnavailable, validationFailed } from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";
import type { StockControlDatabase } from "@stockcontrol/platform-database";
import { sql, type Kysely } from "kysely";

import type { StockService } from "../inventory/stock.service";
import { listStockRequests, type StockRequestQuery } from "../persistence/read-models";
import { parseQuantity, type Quantity } from "../stock/quantity";

const SCHEMA = "stockcontrol" as const;

export interface NewStockRequest {
  readonly requestedByUserId: string;
  readonly itemId: string;
  readonly quantity: string;
  readonly jobId: string | null;
  readonly note: string | null;
}

export interface Decision {
  readonly requestId: string;
  readonly decidedByUserId: string;
  readonly decisionNote: string | null;
  /** Approval may amend the quantity; rejection never does. */
  readonly quantity?: string | undefined;
  readonly scopeActivityToActor: boolean;
}

interface RequestRow {
  readonly id: string;
  readonly item_id: string;
  readonly job_id: string | null;
  readonly quantity: string;
  readonly status: string;
  readonly requested_by_user_id: string;
}

/**
 * Stock requests are demand, not stock. A pending request changes nothing;
 * approving one against a job creates an ordinary reservation through the same
 * stock engine a person would use, so availability arithmetic and the ledger
 * keep their single path. A request without a job is a note that the business
 * needs more of something — it is recorded and approved, but commits nothing.
 */
export class StockRequestsService {
  public constructor(
    private readonly database: Kysely<StockControlDatabase>,
    private readonly stock: StockService,
  ) {}

  public async list(query: StockRequestQuery): Promise<StockRequestListResponse> {
    const { rows, total } = await listStockRequests(this.database, query);

    return { rows, total, limit: query.limit, offset: query.offset };
  }

  public async create(input: NewStockRequest): Promise<StockRequestView> {
    const quantity = parseQuantity(input.quantity);

    if (quantity === null || quantity <= 0) {
      throw new ApplicationFailureException(
        validationFailed({ quantity: ["Enter a quantity greater than zero."] }),
      );
    }

    await this.requireActiveItem(input.itemId);

    if (input.jobId !== null) {
      await this.requireOpenJob(input.jobId);
    }

    const id = randomUUID();

    await this.database
      .withSchema(SCHEMA)
      .insertInto("stock_requests")
      .values({
        id,
        reference: await this.nextReference(),
        item_id: input.itemId,
        job_id: input.jobId,
        quantity: input.quantity,
        note: input.note,
        status: "Pending",
        requested_by_user_id: input.requestedByUserId,
        decided_by_user_id: null,
        decided_at: null,
        decision_note: null,
        reservation_id: null,
      })
      .execute();

    return this.requireView(id);
  }

  /**
   * Approving with a job commits the stock. If the reserve is refused — most
   * often because availability moved since the request was raised — the refusal
   * propagates and the request stays Pending, so it can be approved again once
   * stock arrives rather than being lost in a half-decided state.
   */
  public async approve(decision: Decision): Promise<StockRequestView> {
    const request = await this.requirePending(decision.requestId);
    const quantity = decision.quantity ?? request.quantity;
    const parsed = parseQuantity(quantity);

    if (parsed === null || parsed <= 0) {
      throw new ApplicationFailureException(
        validationFailed({ quantity: ["Enter a quantity greater than zero."] }),
      );
    }

    const reservationId =
      request.job_id === null
        ? null
        : await this.reserveFor(request.job_id, request.item_id, parsed, decision);

    await this.database
      .withSchema(SCHEMA)
      .updateTable("stock_requests")
      .set({
        status: "Approved",
        quantity,
        decided_by_user_id: decision.decidedByUserId,
        decided_at: new Date(),
        decision_note: decision.decisionNote,
        reservation_id: reservationId,
        updated_at: new Date(),
      })
      .where("id", "=", request.id)
      .execute();

    return this.requireView(request.id);
  }

  public async reject(decision: Decision): Promise<StockRequestView> {
    const request = await this.requirePending(decision.requestId);

    if (decision.decisionNote === null || decision.decisionNote.length === 0) {
      throw new ApplicationFailureException(
        validationFailed({ decisionNote: ["Say why this request is being turned down."] }),
      );
    }

    await this.database
      .withSchema(SCHEMA)
      .updateTable("stock_requests")
      .set({
        status: "Rejected",
        decided_by_user_id: decision.decidedByUserId,
        decided_at: new Date(),
        decision_note: decision.decisionNote,
        updated_at: new Date(),
      })
      .where("id", "=", request.id)
      .execute();

    return this.requireView(request.id);
  }

  /** Only the person who raised a request may withdraw it, and only while it waits. */
  public async cancel(requestId: string, actorUserId: string): Promise<StockRequestView> {
    const request = await this.requirePending(requestId);

    if (request.requested_by_user_id !== actorUserId) {
      throw new ApplicationFailureException(
        validationFailed({ request: ["Only the person who raised a request can withdraw it."] }),
      );
    }

    await this.database
      .withSchema(SCHEMA)
      .updateTable("stock_requests")
      .set({
        status: "Cancelled",
        decided_by_user_id: actorUserId,
        decided_at: new Date(),
        updated_at: new Date(),
      })
      .where("id", "=", requestId)
      .execute();

    return this.requireView(requestId);
  }

  private async reserveFor(
    jobId: string,
    itemId: string,
    quantity: Quantity,
    decision: Decision,
  ): Promise<string | null> {
    const result = await this.stock.reserve({
      actorUserId: decision.decidedByUserId,
      scopeActivityToActor: decision.scopeActivityToActor,
      jobId,
      itemId,
      quantity,
    });

    return result.reservationId;
  }

  private async requirePending(requestId: string): Promise<RequestRow> {
    const row = (await this.database
      .withSchema(SCHEMA)
      .selectFrom("stock_requests")
      .select(["id", "item_id", "job_id", "quantity", "status", "requested_by_user_id"])
      .where("id", "=", requestId)
      .executeTakeFirst()) as RequestRow | undefined;

    if (row === undefined) {
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "That request was not found." }),
      );
    }

    if (row.status !== "Pending") {
      throw new ApplicationFailureException(
        validationFailed({
          status: [`That request has already been ${row.status.toLowerCase()}.`],
        }),
      );
    }

    return row;
  }

  private async requireActiveItem(itemId: string): Promise<void> {
    const item = await this.database
      .withSchema(SCHEMA)
      .selectFrom("items")
      .select("id")
      .where("id", "=", itemId)
      .where("is_active", "=", true)
      .executeTakeFirst();

    if (item === undefined) {
      throw new ApplicationFailureException(
        validationFailed({ itemId: ["Choose an item that is still in use."] }),
      );
    }
  }

  private async requireOpenJob(jobId: string): Promise<void> {
    const job = await this.database
      .withSchema(SCHEMA)
      .selectFrom("jobs")
      .select("id")
      .where("id", "=", jobId)
      .where("status", "=", "Open")
      .executeTakeFirst();

    if (job === undefined) {
      throw new ApplicationFailureException(
        validationFailed({ jobId: ["Choose a job that is still open."] }),
      );
    }
  }

  private async requireView(requestId: string): Promise<StockRequestView> {
    const { rows } = await listStockRequests(this.database, {
      id: requestId,
      limit: 1,
      offset: 0,
    });
    const [request] = rows;

    if (request === undefined) {
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "That request could not be read back." }),
      );
    }

    return request;
  }

  /** REQ-0001, REQ-0002, … continuing from the highest existing reference. */
  private async nextReference(): Promise<string> {
    const row = await this.database
      .withSchema(SCHEMA)
      .selectFrom("stock_requests")
      .select((builder) => [
        builder.fn
          .max<number>(sql<number>`nullif(regexp_replace(reference, '\\D', '', 'g'), '')::bigint`)
          .as("highest"),
      ])
      .where("reference", "like", "REQ-%")
      .executeTakeFirst();

    return `REQ-${String(Number(row?.highest ?? 0) + 1).padStart(4, "0")}`;
  }
}
