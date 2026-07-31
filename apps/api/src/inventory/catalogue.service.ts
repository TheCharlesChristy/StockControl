import { randomUUID } from "node:crypto";

import type {
  ItemDetailView,
  ItemListResponse,
  LocationView,
  TransactionListResponse,
} from "@stockcontrol/contracts";
import { resourceUnavailable, validationFailed } from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";
import type { StockControlDatabase } from "@stockcontrol/platform-database";
import { sql, type Kysely } from "kysely";

import {
  findItemDetail,
  listItems,
  listLocations,
  listTransactions,
  type ItemQuery,
  type TransactionQuery,
} from "../persistence/read-models";
import { parseQuantity } from "../stock/quantity";

const SCHEMA = "stockcontrol" as const;

/** Enough to outlast a demo audience all creating an item at once. */
const GENERATED_REFERENCE_ATTEMPTS = 5;

export interface NewItem {
  readonly reference: string | null;
  readonly name: string;
  readonly unit: string;
  readonly barcode: string | null;
  readonly partNumber: string | null;
  readonly lowStockThreshold: string | null;
}

export interface NewLocation {
  readonly code: string;
  readonly name: string;
}

export class CatalogueService {
  public constructor(private readonly database: Kysely<StockControlDatabase>) {}

  public async listItems(query: ItemQuery): Promise<ItemListResponse> {
    const { rows, total } = await listItems(this.database, query);

    return { rows, total, limit: query.limit, offset: query.offset };
  }

  public async listTransactions(query: TransactionQuery): Promise<TransactionListResponse> {
    const { rows, total } = await listTransactions(this.database, query);

    return { rows, total, limit: query.limit, offset: query.offset };
  }

  public listLocations(): Promise<readonly LocationView[]> {
    return listLocations(this.database);
  }

  public async createItem(input: NewItem): Promise<ItemDetailView> {
    if (input.lowStockThreshold !== null && parseQuantity(input.lowStockThreshold) === null) {
      throw new ApplicationFailureException(
        validationFailed({ lowStockThreshold: ["Enter a quantity or leave it blank."] }),
      );
    }

    const id = randomUUID();

    /*
     * A generated reference is the highest existing one plus one, so two people
     * pressing "New item" at the same moment compute the same string and one of
     * them loses the unique index. Recomputing and retrying makes that
     * invisible. A reference the caller typed is theirs to correct, so it is
     * attempted once and the duplicate is reported.
     */
    const attempts = input.reference === null ? GENERATED_REFERENCE_ATTEMPTS : 1;

    for (let attempt = 1; ; attempt += 1) {
      const reference = input.reference ?? (await this.nextItemReference());

      try {
        await this.database
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

        break;
      } catch (error: unknown) {
        if (attempt < attempts && isConstraintViolation(error, "items_reference_key")) {
          continue;
        }

        throw duplicateOrRethrow(error, {
          items_reference_key: { reference: ["That item reference is already in use."] },
          items_barcode_key: { barcode: ["That barcode already belongs to another item."] },
        });
      }
    }

    const item = await findItemDetail(this.database, id);

    if (item === undefined) {
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "The new item could not be read back." }),
      );
    }

    return item;
  }

  public async createLocation(input: NewLocation): Promise<LocationView> {
    const { code, name } = input;
    const id = randomUUID();

    try {
      await this.database
        .withSchema(SCHEMA)
        .insertInto("locations")
        .values({ id, code, name, kind: "Store", job_id: null, is_active: true })
        .execute();
    } catch (error: unknown) {
      throw duplicateOrRethrow(error, {
        locations_code_key: { code: ["That location code is already in use."] },
      });
    }

    return { id, code, name, kind: "Store", jobId: null, isActive: true };
  }

  /** ITM-0001, ITM-0002, … continuing from the highest existing reference. */
  private async nextItemReference(): Promise<string> {
    const row = await this.database
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
}

interface PostgresError {
  readonly constraint?: string;
  readonly code?: string;
}

function isConstraintViolation(error: unknown, constraint: string): boolean {
  const candidate = error as PostgresError;

  return candidate.code === "23505" && candidate.constraint === constraint;
}

function duplicateOrRethrow(
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
