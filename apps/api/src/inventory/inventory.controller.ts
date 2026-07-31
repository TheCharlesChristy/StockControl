import { Body, Controller, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type {
  ItemDetailView,
  ItemListResponse,
  LocationListResponse,
  LocationView,
  StockOperationResponse,
  TransactionListResponse,
} from "@stockcontrol/contracts";
import type { FastifyRequest } from "fastify";

import { API_TOKENS } from "../api.tokens";
import { requireCapability } from "../auth/request-context";
import type { CatalogueService } from "./catalogue.service";
import {
  bodyOf,
  optionalText,
  parsePaging,
  parseTimestamp,
  readOptionalId,
  requireText,
} from "./request-parsing";
import { requireQuantity, type StockService } from "./stock.service";

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
    requireCapability(request, "view");

    return this.catalogue.listItems({ ...parsePaging(limit, offset), search });
  }

  @Get("items/:id")
  public async itemDetail(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
  ): Promise<{ readonly item: ItemDetailView }> {
    requireCapability(request, "view");

    return { item: await this.stock.itemDetail(id) };
  }

  @Post("items")
  public async createItem(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
  ): Promise<{ readonly item: ItemDetailView }> {
    requireCapability(request, "manageCatalogue");
    const body = bodyOf(rawBody);

    return {
      item: await this.catalogue.createItem({
        reference: optionalText(body, "reference"),
        name: requireText(body, "name", "an item name"),
        unit: requireText(body, "unit", "a unit, for example ea or m"),
        barcode: optionalText(body, "barcode"),
        partNumber: optionalText(body, "partNumber"),
        lowStockThreshold: optionalText(body, "lowStockThreshold"),
      }),
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
    requireCapability(request, "view");

    return this.catalogue.listTransactions({
      ...parsePaging(limit, offset),
      itemId,
      jobId,
      actorUserId,
      from: parseTimestamp(from, "from"),
      to: parseTimestamp(to, "to"),
    });
  }
}
