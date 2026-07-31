import { randomUUID } from "node:crypto";

import type { STOCKCONTROL_SCHEMA, StockControlDatabase } from "@stockcontrol/platform-database";
import { sql, type Kysely, type Transaction } from "kysely";

import type { ItemStockSnapshot, LocationBalance } from "../stock/availability";
import type {
  ItemFacts,
  JobFacts,
  LocationFacts,
  ReservationFacts,
  StockDecision,
  StockEffect,
} from "../stock/operations";
import { formatQuantity, quantityFromDatabase, ZERO, type Quantity } from "../stock/quantity";

const SCHEMA: typeof STOCKCONTROL_SCHEMA = "stockcontrol";

export type StockTransaction = Transaction<StockControlDatabase>;

export interface CommandContext {
  readonly tx: StockTransaction;
  readonly actorUserId: string;
}

export interface AppliedEffect {
  readonly transactionId: string;
  readonly reservationId: string | null;
}

/**
 * Reads the state a stock command needs and writes the effects the engine
 * decided on, inside one database transaction.
 *
 * Locks are always taken in the same order — the reservation first, then the
 * item's stock levels in id order — so concurrent commands queue behind each
 * other rather than deadlocking or deciding against a stale view. Item, job and
 * location facts are read without locking; they do not change during a command.
 */

export async function loadItemFacts(
  tx: StockTransaction,
  itemId: string,
): Promise<ItemFacts | undefined> {
  const row = await tx
    .withSchema(SCHEMA)
    .selectFrom("items")
    .select(["id", "reference", "is_active"])
    .where("id", "=", itemId)
    .executeTakeFirst();

  return row === undefined
    ? undefined
    : { id: row.id, reference: row.reference, isActive: row.is_active };
}

export async function loadLocationFacts(
  tx: StockTransaction,
  locationId: string,
): Promise<LocationFacts | undefined> {
  const row = await tx
    .withSchema(SCHEMA)
    .selectFrom("locations")
    .select(["id", "code", "kind", "is_active"])
    .where("id", "=", locationId)
    .executeTakeFirst();

  return row === undefined
    ? undefined
    : { id: row.id, code: row.code, kind: row.kind, isActive: row.is_active };
}

export async function loadJobFacts(
  tx: StockTransaction,
  jobId: string,
): Promise<JobFacts | undefined> {
  const row = await tx
    .withSchema(SCHEMA)
    .selectFrom("jobs")
    .innerJoin("locations", "locations.job_id", "jobs.id")
    .select([
      "jobs.id as id",
      "jobs.number as number",
      "jobs.status as status",
      "locations.id as job_site_location_id",
    ])
    .where("jobs.id", "=", jobId)
    .executeTakeFirst();

  return row === undefined
    ? undefined
    : {
        id: row.id,
        number: row.number,
        status: row.status,
        jobSiteLocationId: row.job_site_location_id,
      };
}

/** Locks the reservation row so two concurrent collections cannot over-issue. */
export async function lockReservation(
  tx: StockTransaction,
  reservationId: string,
): Promise<ReservationFacts | undefined> {
  const row = await tx
    .withSchema(SCHEMA)
    .selectFrom("reservations")
    .select(["id", "item_id", "job_id", "quantity_reserved", "quantity_collected", "status"])
    .where("id", "=", reservationId)
    .forUpdate()
    .executeTakeFirst();

  return row === undefined
    ? undefined
    : {
        id: row.id,
        itemId: row.item_id,
        jobId: row.job_id,
        quantityReserved: quantityFromDatabase(row.quantity_reserved),
        quantityCollected: quantityFromDatabase(row.quantity_collected),
        status: row.status,
      };
}

/**
 * Loads every balance for an item plus its open reserved quantity, locking the
 * stock-level rows so a concurrent command cannot decide against a stale view.
 */
export async function lockItemSnapshot(
  tx: StockTransaction,
  itemId: string,
): Promise<ItemStockSnapshot> {
  await tx
    .withSchema(SCHEMA)
    .selectFrom("stock_levels")
    .select("id")
    .where("item_id", "=", itemId)
    .orderBy("id")
    .forUpdate()
    .execute();

  const rows = await tx
    .withSchema(SCHEMA)
    .selectFrom("stock_levels")
    .innerJoin("locations", "locations.id", "stock_levels.location_id")
    .select([
      "stock_levels.location_id as location_id",
      "stock_levels.quantity as quantity",
      "locations.code as code",
      "locations.name as name",
      "locations.kind as kind",
    ])
    .where("stock_levels.item_id", "=", itemId)
    .orderBy("locations.code")
    .execute();

  const reservedRow = await tx
    .withSchema(SCHEMA)
    .selectFrom("reservations")
    .select((builder) => [
      builder.fn
        .sum<string | null>(sql<string>`quantity_reserved - quantity_collected`)
        .as("outstanding"),
    ])
    .where("item_id", "=", itemId)
    .where("status", "=", "Open")
    .executeTakeFirst();

  const balances: LocationBalance[] = rows.map((row) => ({
    locationId: row.location_id,
    locationCode: row.code,
    kind: row.kind,
    quantity: quantityFromDatabase(row.quantity),
  }));

  return {
    itemId,
    balances,
    /* SUM returns NULL when the item has no open reservation at all. */
    openReservedQuantity:
      reservedRow === undefined || reservedRow.outstanding === null
        ? ZERO
        : quantityFromDatabase(reservedRow.outstanding),
  };
}

/** Writes the level changes, reservation change and transaction of one effect. */
export async function applyEffect(
  tx: StockTransaction,
  effect: StockEffect,
  occurredAt: Date,
): Promise<AppliedEffect> {
  for (const change of effect.levelChanges) {
    const delta = formatQuantity(change.delta);

    /*
     * Update first, insert only if there is no row yet.
     *
     * A single upsert would be neater but is wrong here: PostgreSQL evaluates
     * the non-negative CHECK against the proposed insert row before it resolves
     * the conflict, so an upsert carrying a decrease always trips the
     * constraint even when the resulting balance is perfectly valid.
     */
    const updated = await tx
      .withSchema(SCHEMA)
      .updateTable("stock_levels")
      .set({
        quantity: sql`quantity + ${delta}::numeric`,
        updated_at: sql`now()`,
      })
      .where("item_id", "=", effect.transaction.itemId)
      .where("location_id", "=", change.locationId)
      .executeTakeFirst();

    if (Number(updated.numUpdatedRows) === 0) {
      /*
       * No balance yet, so this is an increase — the engine refuses to take
       * stock from a location holding nothing. The conflict clause covers two
       * concurrent first receipts into the same location, where there is no
       * row to have locked.
       */
      await tx
        .withSchema(SCHEMA)
        .insertInto("stock_levels")
        .values({
          id: randomUUID(),
          item_id: effect.transaction.itemId,
          location_id: change.locationId,
          quantity: delta,
        })
        .onConflict((conflict) =>
          conflict.columns(["item_id", "location_id"]).doUpdateSet({
            quantity: sql`stock_levels.quantity + excluded.quantity`,
            updated_at: sql`now()`,
          }),
        )
        .execute();
    }
  }

  let reservationId = effect.transaction.reservationId;

  if (effect.newReservation !== undefined) {
    reservationId = randomUUID();
    await tx
      .withSchema(SCHEMA)
      .insertInto("reservations")
      .values({
        id: reservationId,
        job_id: effect.newReservation.jobId,
        item_id: effect.newReservation.itemId,
        quantity_reserved: formatQuantity(effect.newReservation.quantityReserved),
        quantity_collected: formatQuantity(ZERO),
        status: "Open",
        created_by_user_id: effect.newReservation.createdByUserId,
      })
      .execute();
  }

  if (effect.reservationUpdate !== undefined) {
    await tx
      .withSchema(SCHEMA)
      .updateTable("reservations")
      .set({
        quantity_collected: formatQuantity(effect.reservationUpdate.quantityCollected),
        status: effect.reservationUpdate.status,
        updated_at: sql`now()`,
      })
      .where("id", "=", effect.reservationUpdate.reservationId)
      .execute();
  }

  const transactionId = randomUUID();

  await tx
    .withSchema(SCHEMA)
    .insertInto("transactions")
    .values({
      id: transactionId,
      kind: effect.transaction.kind,
      item_id: effect.transaction.itemId,
      quantity: formatQuantity(effect.transaction.quantity),
      from_location_id: effect.transaction.fromLocationId,
      to_location_id: effect.transaction.toLocationId,
      job_id: effect.transaction.jobId,
      reservation_id: reservationId,
      reason: effect.transaction.reason,
      actor_user_id: effect.transaction.actorUserId,
      occurred_at: occurredAt,
    })
    .execute();

  return { transactionId, reservationId: reservationId ?? null };
}

export function quantityOrNull(value: string | null): Quantity | null {
  return value === null ? null : quantityFromDatabase(value);
}

export type { StockDecision };

export async function runInTransaction<Result>(
  database: Kysely<StockControlDatabase>,
  work: (tx: StockTransaction) => Promise<Result>,
): Promise<Result> {
  return database.transaction().execute(work);
}
