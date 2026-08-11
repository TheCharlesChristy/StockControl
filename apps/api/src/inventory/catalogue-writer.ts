import { randomUUID } from "node:crypto";

import { validationFailed } from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";
import type { STOCKCONTROL_SCHEMA, StockControlDatabase } from "@stockcontrol/platform-database";
import { sql, type Transaction } from "kysely";

import { parseQuantity } from "../stock/quantity";

const SCHEMA: typeof STOCKCONTROL_SCHEMA = "stockcontrol";

/**
 * A distinct second key in the namespace the other `pg_advisory_xact_lock`
 * call sites in this codebase already share (role-bootstrap.ts,
 * initial-admin.ts, admin-password-reset.ts) — picked once, arbitrary, never
 * reused for anything else.
 */
const ITEM_REFERENCE_LOCK_KEY = 1_847_206_391;

export type CatalogueTransaction = Transaction<StockControlDatabase>;

export interface CreateItemInput {
  readonly reference: string | null;
  readonly name: string;
  readonly unit: string;
  readonly barcode: string | null;
  readonly partNumber: string | null;
  readonly lowStockThreshold: string | null;
}

export interface CreatedItem {
  readonly id: string;
}

interface PostgresError {
  readonly constraint?: string;
  readonly code?: string;
}

export function duplicateOrRethrow(
  error: unknown,
  byConstraint: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>,
): unknown {
  const candidate = error as PostgresError;

  if (candidate.code === "23505" && candidate.constraint !== undefined) {
    const fields = byConstraint[candidate.constraint];

    if (fields !== undefined) {
      return new ApplicationFailureException(validationFailed(fields));
    }
  }

  return error;
}

/** ITM-0001, ITM-0002, … continuing from the highest existing reference. */
async function nextItemReference(tx: CatalogueTransaction): Promise<string> {
  const row = await tx
    .withSchema(SCHEMA)
    .selectFrom("items")
    .select((builder) => [
      builder.fn
        .max<number>(sql<number>`nullif(regexp_replace(reference, '\\D', '', 'g'), '')::bigint`)
        .as("highest"),
    ])
    .where("reference", "like", "ITM-%")
    .executeTakeFirst();

  return `ITM-${String(Number(row?.highest ?? 0) + 1).padStart(4, "0")}`;
}

/**
 * The transaction body behind `CatalogueService.createItem`, extracted so
 * `StockCaptureService.commitEntry` can run it inside its own larger
 * transaction instead of opening a second one.
 *
 * A generated reference is computed behind a transaction-scoped advisory
 * lock rather than the retry-on-unique-violation loop `createItem` used to
 * run on its own: the first unique violation inside a transaction this size
 * would abort the whole thing, and there is no savepoint here to retry
 * from. A caller-supplied reference still relies on the unique constraint
 * and the ordinary validation error — nothing is being computed for it, so
 * there is nothing the lock would protect.
 */
export async function createItemInTransaction(
  tx: CatalogueTransaction,
  input: CreateItemInput,
): Promise<CreatedItem> {
  if (input.lowStockThreshold !== null && parseQuantity(input.lowStockThreshold) === null) {
    throw new ApplicationFailureException(
      validationFailed({ lowStockThreshold: ["Enter a quantity or leave it blank."] }),
    );
  }

  const id = randomUUID();
  let reference = input.reference;

  if (reference === null) {
    await sql`select pg_advisory_xact_lock(1398034255, ${ITEM_REFERENCE_LOCK_KEY})`.execute(tx);
    reference = await nextItemReference(tx);
  }

  try {
    await tx
      .withSchema(SCHEMA)
      .insertInto("items")
      .values({
        id,
        reference,
        name: input.name,
        unit: input.unit,
        barcode: input.barcode,
        part_number: input.partNumber,
        low_stock_threshold: input.lowStockThreshold,
        is_active: true,
      })
      .execute();
  } catch (error: unknown) {
    throw duplicateOrRethrow(error, {
      items_reference_key: { reference: ["That item reference is already in use."] },
      items_barcode_key: { barcode: ["That barcode already belongs to another item."] },
    });
  }

  return { id };
}
