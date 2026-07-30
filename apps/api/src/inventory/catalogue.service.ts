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

    const reference = input.reference ?? (await this.nextItemReference());
    const id = randomUUID();

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
    } catch (error: unknown) {
      throw duplicateOrRethrow(error, {
        items_reference_key: { reference: ["That item reference is already in use."] },
        items_barcode_key: { barcode: ["That barcode already belongs to another item."] },
      });
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
