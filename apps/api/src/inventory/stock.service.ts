import type { ItemDetailView, StockOperationResponse } from "@stockcontrol/contracts";
import { applicationFailure, resourceUnavailable, validationFailed } from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";
import type { StockControlDatabase } from "@stockcontrol/platform-database";
import type { Kysely } from "kysely";

import { findItemDetail } from "../persistence/read-models";
import {
  applyEffect,
  loadItemFacts,
  loadJobFacts,
  loadLocationFacts,
  lockItemSnapshot,
  lockReservation,
  type StockTransaction,
} from "../persistence/stock-store";
import type { StockError, StockErrorCode } from "../stock/errors";
import {
  adjust,
  closeJob,
  collect,
  issue,
  receive,
  release,
  reserve,
  transfer,
  type ItemFacts,
  type JobFacts,
  type LocationFacts,
  type StockDecision,
} from "../stock/operations";
import { parseQuantity, type Quantity } from "../stock/quantity";

/**
 * Turns a validated command into a locked transaction, one engine decision and
 * one set of writes. The engine owns every rule; this class owns loading,
 * locking and persisting.
 */

const snakeCase = (code: StockErrorCode): string =>
  code.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").toLowerCase();

/** Every stock refusal is a 422 whose stable code names the exact rule. */
export function stockFailure(error: StockError): ApplicationFailureException {
  return new ApplicationFailureException(
    applicationFailure("Validation", {
      code: `stock.${snakeCase(error.code)}`,
      detail: error.message,
    }),
  );
}

export function requireQuantity(value: string, field = "quantity"): Quantity {
  const quantity = parseQuantity(value);

  if (quantity === null) {
    throw new ApplicationFailureException(
      validationFailed({ [field]: ["Enter a quantity with at most three decimal places."] }),
    );
  }

  return quantity;
}

function notFound(what: string): ApplicationFailureException {
  return new ApplicationFailureException(resourceUnavailable({ detail: `${what} was not found.` }));
}

async function requireItem(tx: StockTransaction, itemId: string): Promise<ItemFacts> {
  const item = await loadItemFacts(tx, itemId);

  if (item === undefined) {
    throw notFound("That item");
  }

  return item;
}

async function requireLocation(
  tx: StockTransaction,
  locationId: string,
  what = "That location",
): Promise<LocationFacts> {
  const location = await loadLocationFacts(tx, locationId);

  if (location === undefined) {
    throw notFound(what);
  }

  return location;
}

async function requireJob(tx: StockTransaction, jobId: string): Promise<JobFacts> {
  const job = await loadJobFacts(tx, jobId);

  if (job === undefined) {
    throw notFound("That job");
  }

  return job;
}

export interface ReceiveCommand {
  readonly actorUserId: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly quantity: Quantity;
}

export interface IssueCommand extends ReceiveCommand {
  readonly jobId: string | null;
}

export interface TransferCommand {
  readonly actorUserId: string;
  readonly itemId: string;
  readonly fromLocationId: string;
  readonly toLocationId: string;
  readonly quantity: Quantity;
}

export interface AdjustCommand {
  readonly actorUserId: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly countedQuantity: Quantity;
  readonly reason: string;
}

export interface ReserveCommand {
  readonly actorUserId: string;
  readonly jobId: string;
  readonly itemId: string;
  readonly quantity: Quantity;
}

export interface CollectCommand {
  readonly actorUserId: string;
  readonly reservationId: string;
  readonly sourceLocationId: string;
  readonly quantity: Quantity;
}

export interface ReleaseCommand {
  readonly actorUserId: string;
  readonly reservationId: string;
  readonly reason: string;
}

export class StockService {
  public constructor(
    private readonly database: Kysely<StockControlDatabase>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async commit(
    tx: StockTransaction,
    decision: StockDecision,
    itemId: string,
  ): Promise<StockOperationResponse> {
    if (!decision.ok) {
      throw stockFailure(decision.error);
    }

    const applied = await applyEffect(tx, decision.effect, this.now());
    const item = await findItemDetail(tx, itemId);

    if (item === undefined) {
      throw notFound("That item");
    }

    return { item, transactionId: applied.transactionId };
  }

  public async receive(command: ReceiveCommand): Promise<StockOperationResponse> {
    return this.database.transaction().execute(async (tx) => {
      const item = await requireItem(tx, command.itemId);
      const location = await requireLocation(tx, command.locationId);
      await lockItemSnapshot(tx, item.id);

      return this.commit(
        tx,
        receive({
          item,
          location,
          quantity: command.quantity,
          actorUserId: command.actorUserId,
        }),
        item.id,
      );
    });
  }

  public async issue(command: IssueCommand): Promise<StockOperationResponse> {
    return this.database.transaction().execute(async (tx) => {
      const item = await requireItem(tx, command.itemId);
      const location = await requireLocation(tx, command.locationId);
      const job = command.jobId === null ? null : await requireJob(tx, command.jobId);
      const snapshot = await lockItemSnapshot(tx, item.id);

      return this.commit(
        tx,
        issue({
          item,
          location,
          quantity: command.quantity,
          snapshot,
          job,
          actorUserId: command.actorUserId,
        }),
        item.id,
      );
    });
  }

  public async transfer(command: TransferCommand): Promise<StockOperationResponse> {
    return this.database.transaction().execute(async (tx) => {
      const item = await requireItem(tx, command.itemId);
      const from = await requireLocation(tx, command.fromLocationId, "The source location");
      const to = await requireLocation(tx, command.toLocationId, "The destination location");
      const snapshot = await lockItemSnapshot(tx, item.id);

      return this.commit(
        tx,
        transfer({
          item,
          from,
          to,
          quantity: command.quantity,
          snapshot,
          actorUserId: command.actorUserId,
        }),
        item.id,
      );
    });
  }

  public async adjust(command: AdjustCommand): Promise<StockOperationResponse> {
    return this.database.transaction().execute(async (tx) => {
      const item = await requireItem(tx, command.itemId);
      const location = await requireLocation(tx, command.locationId);
      const snapshot = await lockItemSnapshot(tx, item.id);

      return this.commit(
        tx,
        adjust({
          item,
          location,
          countedQuantity: command.countedQuantity,
          snapshot,
          reason: command.reason,
          actorUserId: command.actorUserId,
        }),
        item.id,
      );
    });
  }

  public async reserve(command: ReserveCommand): Promise<StockOperationResponse> {
    return this.database.transaction().execute(async (tx) => {
      const item = await requireItem(tx, command.itemId);
      const job = await requireJob(tx, command.jobId);
      const snapshot = await lockItemSnapshot(tx, item.id);

      return this.commit(
        tx,
        reserve({
          item,
          job,
          quantity: command.quantity,
          snapshot,
          actorUserId: command.actorUserId,
        }),
        item.id,
      );
    });
  }

  public async collect(command: CollectCommand): Promise<StockOperationResponse> {
    return this.database.transaction().execute(async (tx) => {
      /*
       * The reservation lock comes first and is what makes two concurrent
       * collections safe: the second waits here, then re-reads the collected
       * quantity the first committed.
       */
      const reservation = await lockReservation(tx, command.reservationId);

      if (reservation === undefined) {
        throw notFound("That reservation");
      }

      const item = await requireItem(tx, reservation.itemId);
      const job = await requireJob(tx, reservation.jobId);
      const source = await requireLocation(tx, command.sourceLocationId, "The source location");
      const snapshot = await lockItemSnapshot(tx, item.id);

      return this.commit(
        tx,
        collect({
          item,
          job,
          reservation,
          source,
          quantity: command.quantity,
          snapshot,
          actorUserId: command.actorUserId,
        }),
        item.id,
      );
    });
  }

  public async release(command: ReleaseCommand): Promise<StockOperationResponse> {
    return this.database.transaction().execute(async (tx) => {
      const reservation = await lockReservation(tx, command.reservationId);

      if (reservation === undefined) {
        throw notFound("That reservation");
      }

      const item = await requireItem(tx, reservation.itemId);

      return this.commit(
        tx,
        release({
          item,
          reservation,
          reason: command.reason,
          actorUserId: command.actorUserId,
        }),
        item.id,
      );
    });
  }

  /** Closes a job, releasing every uncollected reservation on it. */
  public async closeJob(actorUserId: string, jobId: string): Promise<void> {
    await this.database.transaction().execute(async (tx) => {
      const job = await requireJob(tx, jobId);
      const open = await tx
        .withSchema("stockcontrol")
        .selectFrom("reservations")
        .select("id")
        .where("job_id", "=", jobId)
        .where("status", "=", "Open")
        .orderBy("id")
        .forUpdate()
        .execute();

      const openReservations = [];

      for (const { id } of open) {
        const reservation = await lockReservation(tx, id);

        if (reservation !== undefined) {
          openReservations.push({
            reservation,
            item: await requireItem(tx, reservation.itemId),
          });
        }
      }

      const decision = closeJob({ job, openReservations, actorUserId });

      if (!decision.ok) {
        throw stockFailure(decision.error);
      }

      const now = this.now();

      for (const effect of decision.releases) {
        await applyEffect(tx, effect, now);
      }

      await tx
        .withSchema("stockcontrol")
        .updateTable("jobs")
        .set({ status: "Closed", closed_at: now, updated_at: now })
        .where("id", "=", jobId)
        .execute();
    });
  }

  public async itemDetail(itemId: string): Promise<ItemDetailView> {
    const item = await findItemDetail(this.database, itemId);

    if (item === undefined) {
      throw notFound("That item");
    }

    return item;
  }
}
