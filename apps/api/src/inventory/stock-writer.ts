import type { StockOperationResponse } from "@stockcontrol/contracts";
import { applicationFailure, resourceUnavailable } from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";

import { findItemDetail, type ItemDetailOptions } from "../persistence/read-models";
import {
  applyEffect,
  loadItemFacts,
  loadJobFacts,
  loadLocationFacts,
  lockItemSnapshot,
  type StockTransaction,
} from "../persistence/stock-store";
import type { StockError, StockErrorCode } from "../stock/errors";
import {
  receive,
  type ItemFacts,
  type JobFacts,
  type LocationFacts,
  type StockDecision,
} from "../stock/operations";
import type { Quantity } from "../stock/quantity";

/**
 * The command-execution primitives every stock write shares: loading the
 * facts a decision needs, locking, and turning a decision into persisted
 * effects. `StockService` builds its command methods on these; so does
 * `StockCaptureService.commitEntry`, which needs `receiveInTransaction` to
 * run inside its own larger transaction rather than opening a second one.
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

export function notFound(what: string): ApplicationFailureException {
  return new ApplicationFailureException(resourceUnavailable({ detail: `${what} was not found.` }));
}

export async function requireItem(tx: StockTransaction, itemId: string): Promise<ItemFacts> {
  const item = await loadItemFacts(tx, itemId);

  if (item === undefined) {
    throw notFound("That item");
  }

  return item;
}

export async function requireLocation(
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

export async function requireJob(tx: StockTransaction, jobId: string): Promise<JobFacts> {
  const job = await loadJobFacts(tx, jobId);

  if (job === undefined) {
    throw notFound("That job");
  }

  return job;
}

/**
 * Every command names who is running it. `scopeActivityToActor` decides whose
 * transactions come back on the item afterwards: an Engineer is shown their own
 * record and nobody else's, exactly as on the item screen itself.
 */
export interface ActorCommand {
  readonly actorUserId: string;
  readonly scopeActivityToActor: boolean;
}

export interface ReceiveCommand extends ActorCommand {
  readonly itemId: string;
  readonly locationId: string;
  readonly quantity: Quantity;
}

/** How an item should be read back for the person who just acted on it. */
export function viewerFor(command: ActorCommand): ItemDetailOptions {
  return {
    viewerUserId: command.actorUserId,
    scopeActivityToViewer: command.scopeActivityToActor,
  };
}

export async function commitDecision(
  tx: StockTransaction,
  decision: StockDecision,
  itemId: string,
  viewer: ItemDetailOptions,
  occurredAt: Date,
): Promise<StockOperationResponse> {
  if (!decision.ok) {
    throw stockFailure(decision.error);
  }

  const applied = await applyEffect(tx, decision.effect, occurredAt);
  const item = await findItemDetail(tx, itemId, viewer);

  if (item === undefined) {
    throw notFound("That item");
  }

  return {
    item,
    transactionId: applied.transactionId,
    reservationId: applied.reservationId,
  };
}

/** The transaction body behind `StockService.receive`. */
export async function receiveInTransaction(
  tx: StockTransaction,
  command: ReceiveCommand,
  occurredAt: Date,
): Promise<StockOperationResponse> {
  const item = await requireItem(tx, command.itemId);
  const location = await requireLocation(tx, command.locationId);
  await lockItemSnapshot(tx, item.id);

  return commitDecision(
    tx,
    receive({
      item,
      location,
      quantity: command.quantity,
      actorUserId: command.actorUserId,
    }),
    item.id,
    viewerFor(command),
    occurredAt,
  );
}
