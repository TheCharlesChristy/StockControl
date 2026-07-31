import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { validationFailed, type UploadFloorPlanRequest } from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";

import { API_TOKENS } from "../api.tokens";
import { requireCapability } from "../auth/request-context";
import { bodyOf, requireText } from "../inventory/request-parsing";
import type { LocationsService } from "./locations.service";

@Controller()
export class LocationsController {
  public constructor(
    @Inject(API_TOKENS.locationsService) private readonly locations: LocationsService,
  ) {}

  @Get("locations/tree")
  public tree(@Req() request: FastifyRequest): ReturnType<LocationsService["tree"]> {
    requireCapability(request, "view");
    return this.locations.tree();
  }

  @Get("locations/search")
  public search(
    @Req() request: FastifyRequest,
    @Query("query") query?: string,
  ): ReturnType<LocationsService["search"]> {
    requireCapability(request, "view");
    return this.locations.search(query ?? "");
  }

  @Get("maps")
  public maps(@Req() request: FastifyRequest): ReturnType<LocationsService["maps"]> {
    requireCapability(request, "view");
    return this.locations.maps();
  }

  @Get("maps/:buildingId")
  public map(
    @Req() request: FastifyRequest,
    @Param("buildingId") buildingId: string,
  ): ReturnType<LocationsService["mapForBuilding"]> {
    requireCapability(request, "view");
    return this.locations.mapForBuilding(buildingId);
  }

  @Get("floor-plans/:documentId")
  public async floorPlan(
    @Req() request: FastifyRequest,
    @Param("documentId") documentId: string,
    @Res() reply: FastifyReply,
  ): Promise<FastifyReply> {
    requireCapability(request, "view");
    const asset = await this.locations.floorPlan(documentId);
    return reply
      .type(asset.mediaType)
      .header("content-disposition", `inline; filename="${asset.fileName.replaceAll('"', "")}"`)
      .header("cache-control", "private, max-age=60")
      .send(asset.bytes);
  }

  @Post("locations/hierarchy")
  public createHierarchy(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
  ): ReturnType<LocationsService["createHierarchy"]> {
    requireCapability(request, "manageLocations");
    const body = bodyOf(rawBody);
    return this.locations.createHierarchy({
      code: requireText(body, "code", "a location code"),
      name: requireText(body, "name", "a location name"),
      nodeKind: requireText(body, "nodeKind", "a node kind") as never,
      operationalKind: requireText(body, "operationalKind", "an operational kind") as never,
      parentId: requireText(body, "parentId", "a parent location"),
    });
  }

  @Patch("locations/:locationId")
  public rename(
    @Req() request: FastifyRequest,
    @Param("locationId") locationId: string,
    @Body() rawBody: unknown,
  ): ReturnType<LocationsService["rename"]> {
    requireCapability(request, "manageLocations");
    return this.locations.rename(
      locationId,
      requireText(bodyOf(rawBody), "name", "a location name"),
    );
  }

  @Post("locations/:locationId/move")
  public move(
    @Req() request: FastifyRequest,
    @Param("locationId") locationId: string,
    @Body() rawBody: unknown,
  ): ReturnType<LocationsService["move"]> {
    requireCapability(request, "manageLocations");
    return this.locations.move(
      locationId,
      requireText(bodyOf(rawBody), "parentId", "a parent location"),
    );
  }

  @Post("locations/:locationId/archive")
  public archive(
    @Req() request: FastifyRequest,
    @Param("locationId") locationId: string,
  ): ReturnType<LocationsService["archive"]> {
    requireCapability(request, "manageLocations");
    return this.locations.archive(locationId);
  }

  @Delete("locations/:locationId")
  public async remove(
    @Req() request: FastifyRequest,
    @Param("locationId") locationId: string,
  ): Promise<{ readonly deleted: true }> {
    requireCapability(request, "manageLocations");
    await this.locations.remove(locationId);
    return { deleted: true };
  }

  @Post("maps/:buildingId")
  public createMap(
    @Req() request: FastifyRequest,
    @Param("buildingId") buildingId: string,
    @Body() rawBody: unknown,
  ): ReturnType<LocationsService["createMap"]> {
    const user = requireCapability(request, "manageLocations");
    const body = bodyOf(rawBody);
    return this.locations.createMap(
      buildingId,
      {
        kind: body.kind === "FloorPlan" ? "FloorPlan" : "Blank",
        ...(typeof body.documentId === "string" ? { documentId: body.documentId } : {}),
        ...(typeof body.originalFileName === "string"
          ? { originalFileName: body.originalFileName }
          : {}),
        ...(body.mediaType === "image/png" || body.mediaType === "image/jpeg"
          ? { mediaType: body.mediaType }
          : {}),
      } as never,
      user.id,
    );
  }

  @Put("maps/:mapId")
  public saveMap(
    @Req() request: FastifyRequest,
    @Param("mapId") mapId: string,
    @Body() rawBody: unknown,
  ): ReturnType<LocationsService["saveMap"]> {
    const user = requireCapability(request, "manageLocations");
    const body = bodyOf(rawBody);
    const regions = Array.isArray(body.regions) ? (body.regions as never) : [];
    const revision =
      typeof body.expectedRevision === "number" && Number.isInteger(body.expectedRevision)
        ? body.expectedRevision
        : -1;
    return this.locations.saveMap(mapId, { expectedRevision: revision, regions }, user.id);
  }

  @Post("maps/:mapId/background")
  public background(
    @Req() request: FastifyRequest,
    @Param("mapId") mapId: string,
    @Body() rawBody: unknown,
  ): ReturnType<LocationsService["saveMap"]> {
    const user = requireCapability(request, "manageLocations");
    const body = bodyOf(rawBody);
    const mediaType =
      body.mediaType === "image/png" || body.mediaType === "image/jpeg"
        ? body.mediaType
        : undefined;
    if (mediaType === undefined)
      throw new ApplicationFailureException(
        validationFailed({ mediaType: ["Use image/png or image/jpeg."] }),
      );
    const upload: UploadFloorPlanRequest = {
      expectedRevision:
        typeof body.expectedRevision === "number" && Number.isInteger(body.expectedRevision)
          ? body.expectedRevision
          : -1,
      regions: Array.isArray(body.regions) ? (body.regions as never) : [],
      originalFileName: requireText(body, "originalFileName", "a floor-plan filename"),
      mediaType,
      contentBase64: requireText(body, "contentBase64", "floor-plan bytes"),
    };
    return this.locations.uploadBackground(mapId, upload, user.id);
  }

  @Post("maps/:mapId/archive")
  public archiveMap(
    @Req() request: FastifyRequest,
    @Param("mapId") mapId: string,
  ): ReturnType<LocationsService["archiveMap"]> {
    const user = requireCapability(request, "manageLocations");
    return this.locations.archiveMap(mapId, user.id);
  }
}
