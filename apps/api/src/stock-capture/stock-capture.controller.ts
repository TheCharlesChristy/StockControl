import { Body, Controller, Get, Inject, Param, Post, Req } from "@nestjs/common";
import type {
  CaptureUploadGrantResponse,
  CaptureImageMediaType,
  RecognitionSessionSummaryView,
  RecognitionSessionView,
  StockCaptureBatchView,
} from "@stockcontrol/contracts";
import { CAPTURE_MAX_PHOTOS, captureImageMediaTypes } from "@stockcontrol/contracts";
import type { DeclaredImage } from "@stockcontrol/module-stock-capture";
import type { FastifyRequest } from "fastify";

import { API_TOKENS } from "../api.tokens";
import { canViewAllActivity, requireCapability } from "../auth/request-context";
import {
  bodyOf,
  optionalUuid,
  readBoundedArray,
  requireUuid,
  requireUuidParameter,
  type Body as ParsedBody,
} from "../inventory/request-parsing";
import { uploadInvalid } from "./capture-failures";
import type { StockCaptureService } from "./stock-capture.service";

/**
 * The nine routes of specification section 10, minus the commit route: that
 * one needs the atomic-commit writers, which are not built yet, so it is
 * added alongside them rather than half-wired ahead of its own dependency.
 *
 * Every handler starts with `requireCapability`, matching the rest of the
 * API — a route here is authenticated by the global guard and authorised on
 * top of that, never by anything the browser sent.
 */
@Controller()
export class StockCaptureController {
  public constructor(
    @Inject(API_TOKENS.stockCaptureService) private readonly capture: StockCaptureService,
  ) {}

  @Post("stock-capture/batches")
  public async startBatch(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
  ): Promise<{ readonly batch: StockCaptureBatchView }> {
    const user = requireCapability(request, "manageStock");
    const body = bodyOf(rawBody);

    return {
      batch: await this.capture.startBatch({
        actorUserId: user.id,
        clientBatchId: requireUuid(body, "clientBatchId", "a batch id"),
        defaultLocationId: optionalUuid(body, "defaultLocationId", "a location"),
      }),
    };
  }

  @Get("stock-capture/batches/:batchId")
  public async getBatch(
    @Req() request: FastifyRequest,
    @Param("batchId") batchId: string,
  ): Promise<{ readonly batch: StockCaptureBatchView }> {
    const user = requireCapability(request, "manageStock");
    return {
      batch: await this.capture.getBatch(requireUuidParameter(batchId, "batch"), user.id),
    };
  }

  @Post("stock-capture/batches/:batchId/complete")
  public async completeBatch(
    @Req() request: FastifyRequest,
    @Param("batchId") batchId: string,
  ): Promise<{ readonly batch: StockCaptureBatchView }> {
    const user = requireCapability(request, "manageStock");
    return {
      batch: await this.capture.completeBatch(requireUuidParameter(batchId, "batch"), user.id),
    };
  }

  @Post("stock-capture/sessions")
  public async startSession(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
  ): Promise<{
    readonly session: RecognitionSessionSummaryView;
    readonly exactItemId: string | null;
  }> {
    const user = requireCapability(request, "manageStock");
    const body = bodyOf(rawBody);
    const photoCount = readPhotoCount(body);

    const result = await this.capture.startSession({
      actorUserId: user.id,
      clientSessionId: requireUuid(body, "clientSessionId", "a session id"),
      batchId: requireUuid(body, "batchId", "a batch id"),
      photoCount,
      localCodes: readBoundedArray(body, "localCodes", CAPTURE_MAX_PHOTOS * 4),
    });

    return {
      session: result.session,
      exactItemId: result.exactItemIsActive ? result.exactItemId : null,
    };
  }

  @Get("stock-capture/sessions/:sessionId")
  public async getSession(
    @Req() request: FastifyRequest,
    @Param("sessionId") sessionId: string,
  ): Promise<{ readonly session: RecognitionSessionView }> {
    const user = requireCapability(request, "manageStock");

    return {
      session: await this.capture.getSession(requireUuidParameter(sessionId, "session"), user.id, {
        viewerUserId: user.id,
        scopeActivityToViewer: !canViewAllActivity(request),
      }),
    };
  }

  @Post("stock-capture/sessions/:sessionId/uploads")
  public async requestUploads(
    @Req() request: FastifyRequest,
    @Param("sessionId") sessionId: string,
    @Body() rawBody: unknown,
  ): Promise<CaptureUploadGrantResponse> {
    const user = requireCapability(request, "manageStock");
    const body = bodyOf(rawBody);

    return this.capture.requestUploads({
      actorUserId: user.id,
      sessionId: requireUuidParameter(sessionId, "session"),
      images: readDeclaredImages(body),
    });
  }

  @Post("stock-capture/sessions/:sessionId/uploads/complete")
  public async completeUploads(
    @Req() request: FastifyRequest,
    @Param("sessionId") sessionId: string,
  ): Promise<{ readonly session: RecognitionSessionSummaryView }> {
    const user = requireCapability(request, "manageStock");

    return {
      session: await this.capture.completeUploads(
        requireUuidParameter(sessionId, "session"),
        user.id,
      ),
    };
  }

  @Post("stock-capture/sessions/:sessionId/cancel")
  public async cancelSession(
    @Req() request: FastifyRequest,
    @Param("sessionId") sessionId: string,
  ): Promise<{ readonly session: RecognitionSessionSummaryView }> {
    const user = requireCapability(request, "manageStock");

    return {
      session: await this.capture.cancelSession(
        requireUuidParameter(sessionId, "session"),
        user.id,
      ),
    };
  }
}

export const readPhotoCount = (body: ParsedBody): number => {
  const value = body.photoCount;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > CAPTURE_MAX_PHOTOS
  ) {
    throw uploadInvalid(`Send between 0 and ${String(CAPTURE_MAX_PHOTOS)} photographs.`);
  }
  return value;
};

const isCaptureMediaType = (value: unknown): value is CaptureImageMediaType =>
  (captureImageMediaTypes as readonly string[]).includes(value as string);

export const readDeclaredImages = (body: ParsedBody): readonly DeclaredImage[] => {
  const raw = readBoundedArray(body, "images", CAPTURE_MAX_PHOTOS);

  return raw.map((entry) => {
    if (typeof entry !== "object" || entry === null)
      throw uploadInvalid("Malformed image declaration.");
    const record = entry as Record<string, unknown>;
    const { ordinal, mediaType, byteLength, sha256, width, height } = record;

    if (
      typeof ordinal !== "number" ||
      !isCaptureMediaType(mediaType) ||
      typeof byteLength !== "number" ||
      typeof sha256 !== "string" ||
      typeof width !== "number" ||
      typeof height !== "number"
    ) {
      throw uploadInvalid("Malformed image declaration.");
    }

    return { ordinal, mediaType, byteLength, sha256, width, height };
  });
};
