import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
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

const locationsOf = (body: Readonly<Record<string, unknown>>): never =>
  (Array.isArray(body.locations) ? body.locations : []) as never;

const revisionOf = (body: Readonly<Record<string, unknown>>): number =>
  typeof body.expectedRevision === "number" && Number.isInteger(body.expectedRevision)
    ? body.expectedRevision
    : -1;

@Controller()
export class LocationsController {
  public constructor(
    @Inject(API_TOKENS.locationsService) private readonly locations: LocationsService,
  ) {}

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

  @Get("maps/:mapId")
  public map(
    @Req() request: FastifyRequest,
    @Param("mapId") mapId: string,
  ): ReturnType<LocationsService["map"]> {
    requireCapability(request, "view");
    return this.locations.map(mapId);
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

  @Post("maps")
  public createMap(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
  ): ReturnType<LocationsService["createMap"]> {
    const user = requireCapability(request, "manageLocations");
    const body = bodyOf(rawBody);
    return this.locations.createMap(
      {
        code: requireText(body, "code", "a map code"),
        name: requireText(body, "name", "a map name"),
      },
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
    return this.locations.saveMap(
      mapId,
      { expectedRevision: revisionOf(body), locations: locationsOf(body) },
      user.id,
    );
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
      expectedRevision: revisionOf(body),
      locations: locationsOf(body),
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

  @Post("locations/:locationId/archive")
  public async archive(
    @Req() request: FastifyRequest,
    @Param("locationId") locationId: string,
  ): Promise<{ readonly archived: true }> {
    requireCapability(request, "manageLocations");
    await this.locations.archive(locationId);
    return { archived: true };
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
}
