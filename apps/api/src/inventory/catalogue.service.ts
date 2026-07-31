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
  findItemByCode,
  findItemDetail,
  listItems,
  listLocations,
  listTransactions,
  type ItemDetailOptions,
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

/** Only the fields that were supplied are changed. */
export interface ItemEdit {
  readonly name?: string | undefined;
  readonly unit?: string | undefined;
  readonly barcode?: string | null | undefined;
  readonly partNumber?: string | null | undefined;
  readonly lowStockThreshold?: string | null | undefined;
  readonly isActive?: boolean | undefined;
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

  public async createItem(input: NewItem, viewer: ItemDetailOptions): Promise<ItemDetailView> {
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

    const item = await findItemDetail(this.database, id, viewer);

    if (item === undefined) {
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "The new item could not be read back." }),
      );
    }

    return item;
  }

  /**
   * Editing an item never touches its reference or its history. Archiving is
   * `isActive: false`: the item stops being usable in stock operations but its
   * balances and transactions stay exactly where they are.
   */
  public async updateItem(
    itemId: string,
    edit: ItemEdit,
    viewer: ItemDetailOptions,
  ): Promise<ItemDetailView> {
    if (
      edit.lowStockThreshold !== undefined &&
      edit.lowStockThreshold !== null &&
      parseQuantity(edit.lowStockThreshold) === null
    ) {
      throw new ApplicationFailureException(
        validationFailed({ lowStockThreshold: ["Enter a quantity or leave it blank."] }),
      );
    }

    const changes = {
      ...(edit.name === undefined ? {} : { name: edit.name }),
      ...(edit.unit === undefined ? {} : { unit: edit.unit }),
      ...(edit.barcode === undefined ? {} : { barcode: edit.barcode }),
      ...(edit.partNumber === undefined ? {} : { part_number: edit.partNumber }),
      ...(edit.lowStockThreshold === undefined
        ? {}
        : { low_stock_threshold: edit.lowStockThreshold }),
      ...(edit.isActive === undefined ? {} : { is_active: edit.isActive }),
    };

    if (Object.keys(changes).length > 0) {
      try {
        await this.database
          .withSchema(SCHEMA)
          .updateTable("items")
          .set({ ...changes, updated_at: new Date() })
          .where("id", "=", itemId)
          .execute();
      } catch (error: unknown) {
        throw duplicateOrRethrow(error, {
          items_barcode_key: { barcode: ["That barcode already belongs to another item."] },
        });
      }
    }

    const item = await findItemDetail(this.database, itemId, viewer);

    if (item === undefined) {
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "That item was not found." }),
      );
    }

    return item;
  }

  /** Resolves a scanned or typed code to an item id. */
  public findByCode(code: string): Promise<{ readonly id: string } | undefined> {
    return findItemByCode(this.database, code);
  }

  public async createLocation(input: NewLocation): Promise<LocationView> {
    const { code, name } = input;
    const id = randomUUID();

    try {
      await this.database
        .withSchema(SCHEMA)
        .insertInto("locations")
        .values({
          id,
          code,
          name,
          kind: "Store",
          job_id: null,
          is_active: true,
          node_kind: "CustomSection",
          operational_kind: "Storage",
          parent_id: "00000000-0000-4000-8000-000000000002",
          building_id: "00000000-0000-4000-8000-000000000002",
          general_fulfilment_enabled: true,
          archived_at: null,
        })
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
