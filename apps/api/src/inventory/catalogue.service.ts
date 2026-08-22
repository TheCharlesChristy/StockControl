import type {
  ImageUploadRequest,
  ItemDetailView,
  ItemListResponse,
  LocationView,
  TransactionListResponse,
} from "@stockcontrol/contracts";
import { resourceUnavailable, validationFailed } from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";
import type { StockControlDatabase } from "@stockcontrol/platform-database";
import type { Kysely } from "kysely";

import { createItemInTransaction, duplicateOrRethrow } from "./catalogue-writer";
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
import type { PhotosService } from "../media/photos.service";

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
  public constructor(
    private readonly database: Kysely<StockControlDatabase>,
    private readonly photos: PhotosService,
  ) {}

  public async uploadItemPhoto(
    itemId: string,
    actorUserId: string,
    input: ImageUploadRequest,
    viewer: ItemDetailOptions,
  ): Promise<ItemDetailView> {
    await this.photos.saveItemPhoto(itemId, actorUserId, input);
    return this.requireDetail(itemId, viewer);
  }

  public async deleteItemPhoto(
    itemId: string,
    photoId: string,
    viewer: ItemDetailOptions,
  ): Promise<ItemDetailView> {
    await this.photos.deleteItemPhoto(itemId, photoId);
    return this.requireDetail(itemId, viewer);
  }

  public async setItemPhotoCover(
    itemId: string,
    photoId: string,
    viewer: ItemDetailOptions,
  ): Promise<ItemDetailView> {
    await this.photos.setCover(itemId, photoId);
    return this.requireDetail(itemId, viewer);
  }

  public async listItems(query: ItemQuery): Promise<ItemListResponse> {
    const { rows, total } = await listItems(this.database, query);

    return { rows, total, limit: query.limit, offset: query.offset };
  }

  public async listTransactions(query: TransactionQuery): Promise<TransactionListResponse> {
    const { rows, total } = await listTransactions(this.database, query);

    return { rows, total, limit: query.limit, offset: query.offset };
  }

  public listLocations(query?: {
    readonly limit?: number;
    readonly offset?: number;
  }): Promise<readonly LocationView[]> {
    return listLocations(this.database, query);
  }

  public async createItem(input: NewItem, viewer: ItemDetailOptions): Promise<ItemDetailView> {
    const { id } = await this.database
      .transaction()
      .execute((tx) => createItemInTransaction(tx, input));

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

  private async requireDetail(itemId: string, viewer: ItemDetailOptions): Promise<ItemDetailView> {
    const item = await findItemDetail(this.database, itemId, viewer);
    if (item === undefined) {
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "That item was not found." }),
      );
    }
    return item;
  }
}
