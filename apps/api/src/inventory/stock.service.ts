import type { ItemDetailView, StockOperationResponse } from "@stockcontrol/contracts";
import { validationFailed } from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";
import type { StockControlDatabase } from "@stockcontrol/platform-database";
import type { Kysely } from "kysely";

import { findItemDetail, type ItemDetailOptions } from "../persistence/read-models";
import {
  applyEffect,
  lockItemSnapshot,
  lockReservation,
  type StockTransaction,
} from "../persistence/stock-store";
import { adjust, closeJob, collect, issue, release, reserve, transfer } from "../stock/operations";
import { parseQuantity, type Quantity } from "../stock/quantity";
import {
  commitDecision,
  notFound,
  receiveInTransaction,
  requireItem,
  requireJob,
  requireLocation,
  stockFailure,
  viewerFor,
  type ActorCommand,
  type ReceiveCommand,
} from "./stock-writer";

/**
 * Turns a validated command into a locked transaction, one engine decision and
 * one set of writes. The engine owns every rule; this class owns loading,
 * locking and persisting. The loading/locking/persisting primitives
 * themselves live in `stock-writer.ts`, so `StockCaptureService.commitEntry`
 * can run `receiveInTransaction` inside its own larger transaction.
 */

export function requireQuantity(value: string, field = "quantity"): Quantity {
  const quantity = parseQuantity(value);

  if (quantity === null) {
    throw new ApplicationFailureException(
      validationFailed({ [field]: ["Enter a quantity with at most three decimal places."] }),
    );
  }

  return quantity;
}

export type { ActorCommand, ReceiveCommand };

export interface IssueCommand extends ReceiveCommand {
  readonly jobId: string | null;
}

export interface TransferCommand extends ActorCommand {
  readonly itemId: string;
  readonly fromLocationId: string;
  readonly toLocationId: string;
  readonly quantity: Quantity;
}

export interface AdjustCommand extends ActorCommand {
  readonly itemId: string;
  readonly locationId: string;
  readonly countedQuantity: Quantity;
  readonly reason: string;
}

export interface ReserveCommand extends ActorCommand {
  readonly jobId: string;
  readonly itemId: string;
  readonly quantity: Quantity;
}

export interface CollectCommand extends ActorCommand {
  readonly reservationId: string;
  readonly sourceLocationId: string;
  readonly quantity: Quantity;
}

export interface ReleaseCommand extends ActorCommand {
  readonly reservationId: string;
  readonly reason: string;
}

export class StockService {
  public constructor(
    private readonly database: Kysely<StockControlDatabase>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async receive(command: ReceiveCommand): Promise<StockOperationResponse> {
    return this.database.transaction().execute((tx) => this.receiveInTransaction(tx, command));
  }

  public receiveInTransaction(
    tx: StockTransaction,
    command: ReceiveCommand,
  ): Promise<StockOperationResponse> {
    return receiveInTransaction(tx, command, this.now());
  }

  public async issue(command: IssueCommand): Promise<StockOperationResponse> {
    return this.database.transaction().execute((tx) => this.issueInTransaction(tx, command));
  }

  public async issueInTransaction(
    tx: StockTransaction,
    command: IssueCommand,
  ): Promise<StockOperationResponse> {
    const item = await requireItem(tx, command.itemId);
    const location = await requireLocation(tx, command.locationId);
    const job = command.jobId === null ? null : await requireJob(tx, command.jobId);
    const snapshot = await lockItemSnapshot(tx, item.id);

    return commitDecision(
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
      viewerFor(command),
      this.now(),
    );
  }

  public async transfer(command: TransferCommand): Promise<StockOperationResponse> {
    return this.database.transaction().execute((tx) => this.transferInTransaction(tx, command));
  }

  public async transferInTransaction(
    tx: StockTransaction,
    command: TransferCommand,
  ): Promise<StockOperationResponse> {
    const item = await requireItem(tx, command.itemId);
    const from = await requireLocation(tx, command.fromLocationId, "The source location");
    const to = await requireLocation(tx, command.toLocationId, "The destination location");
    const snapshot = await lockItemSnapshot(tx, item.id);

    return commitDecision(
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
      viewerFor(command),
      this.now(),
    );
  }

  public async adjust(command: AdjustCommand): Promise<StockOperationResponse> {
    return this.database.transaction().execute((tx) => this.adjustInTransaction(tx, command));
  }

  public async adjustInTransaction(
    tx: StockTransaction,
    command: AdjustCommand,
  ): Promise<StockOperationResponse> {
    const item = await requireItem(tx, command.itemId);
    const location = await requireLocation(tx, command.locationId);
    const snapshot = await lockItemSnapshot(tx, item.id);

    return commitDecision(
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
      viewerFor(command),
      this.now(),
    );
  }

  public async reserve(command: ReserveCommand): Promise<StockOperationResponse> {
    return this.database.transaction().execute((tx) => this.reserveInTransaction(tx, command));
  }

  public async reserveInTransaction(
    tx: StockTransaction,
    command: ReserveCommand,
  ): Promise<StockOperationResponse> {
    const item = await requireItem(tx, command.itemId);
    const job = await requireJob(tx, command.jobId);
    const snapshot = await lockItemSnapshot(tx, item.id);

    return commitDecision(
      tx,
      reserve({
        item,
        job,
        quantity: command.quantity,
        snapshot,
        actorUserId: command.actorUserId,
      }),
      item.id,
      viewerFor(command),
      this.now(),
    );
  }

  public async collect(command: CollectCommand): Promise<StockOperationResponse> {
    return this.database.transaction().execute((tx) => this.collectInTransaction(tx, command));
  }

  public async collectInTransaction(
    tx: StockTransaction,
    command: CollectCommand,
  ): Promise<StockOperationResponse> {
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

    return commitDecision(
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
      viewerFor(command),
      this.now(),
    );
  }

  public async release(command: ReleaseCommand): Promise<StockOperationResponse> {
    return this.database.transaction().execute((tx) => this.releaseInTransaction(tx, command));
  }

  public async releaseInTransaction(
    tx: StockTransaction,
    command: ReleaseCommand,
  ): Promise<StockOperationResponse> {
    const reservation = await lockReservation(tx, command.reservationId);

    if (reservation === undefined) {
      throw notFound("That reservation");
    }

    const item = await requireItem(tx, reservation.itemId);

    return commitDecision(
      tx,
      release({
        item,
        reservation,
        reason: command.reason,
        actorUserId: command.actorUserId,
      }),
      item.id,
      viewerFor(command),
      this.now(),
    );
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

  public async itemDetail(itemId: string, viewer: ItemDetailOptions): Promise<ItemDetailView> {
    const item = await findItemDetail(this.database, itemId, viewer);

    if (item === undefined) {
      throw notFound("That item");
    }

    return item;
  }
}
