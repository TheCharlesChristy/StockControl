import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type {
  ItemDetailView,
  ItemListResponse,
  LocationListResponse,
  LocationView,
  StockOperationResponse,
  TransactionListResponse,
} from "@stockcontrol/contracts";
import { resourceUnavailable, validationFailed } from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";
import type { FastifyRequest } from "fastify";

import { API_TOKENS } from "../api.tokens";
import { canViewAllActivity, currentUser, requireCapability } from "../auth/request-context";
import type { ItemDetailOptions } from "../persistence/read-models";
import type { CatalogueService } from "./catalogue.service";
import {
  bodyOf,
  optionalText,
  parsePaging,
  parseTimestamp,
  readBoolean,
  readOptionalId,
  requireText,
} from "./request-parsing";
import { requireQuantity, type StockService } from "./stock.service";

/**
 * Who is looking, and whether they may see anyone else's activity. Requirements
 * section 9.2 gives an Engineer their own record only, so the narrowing happens
 * here rather than being left to the browser.
 */
function viewerOf(request: FastifyRequest): ItemDetailOptions {
  return {
    viewerUserId: currentUser(request).id,
    scopeActivityToViewer: !canViewAllActivity(request),
  };
}

@Controller()
export class InventoryController {
  public constructor(
    @Inject(API_TOKENS.stockService) private readonly stock: StockService,
    @Inject(API_TOKENS.catalogueService) private readonly catalogue: CatalogueService,
  ) {}

  @Get("items")
  public async listItems(
    @Req() request: FastifyRequest,
    @Query("search") search?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ): Promise<ItemListResponse> {
    const user = requireCapability(request, "view");

    return this.catalogue.listItems({
      ...parsePaging(limit, offset),
      search,
      viewerUserId: user.id,
    });
  }

  /**
   * Resolves whatever a camera or a keyboard-wedge scanner read — an item
   * reference, a supplier barcode or a part number — to the item it belongs to.
   */
  @Get("items/lookup")
  public async lookupItem(
    @Req() request: FastifyRequest,
    @Query("code") code?: string,
  ): Promise<{ readonly item: ItemDetailView }> {
    requireCapability(request, "view");

    const match = code === undefined ? undefined : await this.catalogue.findByCode(code);

    if (match === undefined) {
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "No item matches that code." }),
      );
    }

    return { item: await this.stock.itemDetail(match.id, viewerOf(request)) };
  }

  @Get("items/:id")
  public async itemDetail(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
  ): Promise<{ readonly item: ItemDetailView }> {
    requireCapability(request, "view");

    return { item: await this.stock.itemDetail(id, viewerOf(request)) };
  }

  @Post("items")
  public async createItem(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
  ): Promise<{ readonly item: ItemDetailView }> {
    requireCapability(request, "manageCatalogue");
    const body = bodyOf(rawBody);

    return {
      item: await this.catalogue.createItem(
        {
          reference: optionalText(body, "reference"),
          name: requireText(body, "name", "an item name"),
          unit: requireText(body, "unit", "a unit, for example ea or m"),
          barcode: optionalText(body, "barcode"),
          partNumber: optionalText(body, "partNumber"),
          lowStockThreshold: optionalText(body, "lowStockThreshold"),
        },
        viewerOf(request),
      ),
    };
  }

  @Patch("items/:id")
  public async updateItem(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
    @Body() rawBody: unknown,
  ): Promise<{ readonly item: ItemDetailView }> {
    requireCapability(request, "manageCatalogue");
    const body = bodyOf(rawBody);
    const name = optionalText(body, "name");

    if ("name" in body && name === null) {
      throw new ApplicationFailureException(validationFailed({ name: ["Enter an item name."] }));
    }

    return {
      item: await this.catalogue.updateItem(
        id,
        {
          ...("name" in body && name !== null ? { name } : {}),
          ...("unit" in body ? { unit: requireText(body, "unit", "a unit") } : {}),
          ...("barcode" in body ? { barcode: optionalText(body, "barcode") } : {}),
          ...("partNumber" in body ? { partNumber: optionalText(body, "partNumber") } : {}),
          ...("lowStockThreshold" in body
            ? { lowStockThreshold: optionalText(body, "lowStockThreshold") }
            : {}),
          ...("isActive" in body ? { isActive: readBoolean(body, "isActive") } : {}),
        },
        viewerOf(request),
      ),
    };
  }

  @Get("locations")
  public async listLocations(@Req() request: FastifyRequest): Promise<LocationListResponse> {
    requireCapability(request, "view");

    return { locations: await this.catalogue.listLocations() };
  }

  @Post("locations")
  public async createLocation(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
  ): Promise<{ readonly location: LocationView }> {
    requireCapability(request, "manageCatalogue");
    const body = bodyOf(rawBody);

    return {
      location: await this.catalogue.createLocation({
        code: requireText(body, "code", "a location code").toUpperCase(),
        name: requireText(body, "name", "a location name"),
      }),
    };
  }

  @Post("stock/receive")
  public async receive(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
  ): Promise<StockOperationResponse> {
    const user = requireCapability(request, "manageStock");
    const body = bodyOf(rawBody);

    return this.stock.receive({
      actorUserId: user.id,
      scopeActivityToActor: !canViewAllActivity(request),
      itemId: requireText(body, "itemId", "an item"),
      locationId: requireText(body, "locationId", "a location"),
      quantity: requireQuantity(requireText(body, "quantity", "a quantity")),
    });
  }

  @Post("stock/issue")
  public async issue(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
  ): Promise<StockOperationResponse> {
    const user = requireCapability(request, "issue");
    const body = bodyOf(rawBody);

    return this.stock.issue({
      actorUserId: user.id,
      scopeActivityToActor: !canViewAllActivity(request),
      itemId: requireText(body, "itemId", "an item"),
      locationId: requireText(body, "locationId", "a location"),
      quantity: requireQuantity(requireText(body, "quantity", "a quantity")),
      jobId: readOptionalId(body, "jobId"),
    });
  }

  @Post("stock/transfer")
  public async transfer(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
  ): Promise<StockOperationResponse> {
    const user = requireCapability(request, "manageStock");
    const body = bodyOf(rawBody);

    return this.stock.transfer({
      actorUserId: user.id,
      scopeActivityToActor: !canViewAllActivity(request),
      itemId: requireText(body, "itemId", "an item"),
      fromLocationId: requireText(body, "fromLocationId", "a source location"),
      toLocationId: requireText(body, "toLocationId", "a destination location"),
      quantity: requireQuantity(requireText(body, "quantity", "a quantity")),
    });
  }

  @Post("stock/adjust")
  public async adjust(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
  ): Promise<StockOperationResponse> {
    const user = requireCapability(request, "manageStock");
    const body = bodyOf(rawBody);

    return this.stock.adjust({
      actorUserId: user.id,
      scopeActivityToActor: !canViewAllActivity(request),
      itemId: requireText(body, "itemId", "an item"),
      locationId: requireText(body, "locationId", "a location"),
      countedQuantity: requireQuantity(
        requireText(body, "countedQuantity", "the counted quantity"),
        "countedQuantity",
      ),
      reason: requireText(body, "reason", "a reason for this adjustment"),
    });
  }

  @Get("transactions")
  public async listTransactions(
    @Req() request: FastifyRequest,
    @Query("itemId") itemId?: string,
    @Query("jobId") jobId?: string,
    @Query("actorUserId") actorUserId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ): Promise<TransactionListResponse> {
    const user = requireCapability(request, "view");

    /*
     * Without `viewAllActivity` the log is the caller's own record, whatever
     * they asked for. Overriding rather than refusing keeps the screen usable:
     * an Engineer following a link still lands on something meaningful.
     */
    const scopedActor = canViewAllActivity(request) ? actorUserId : user.id;

    return this.catalogue.listTransactions({
      ...parsePaging(limit, offset),
      itemId,
      jobId,
      actorUserId: scopedActor,
      from: parseTimestamp(from, "from"),
      to: parseTimestamp(to, "to"),
    });
  }
}
