import { Body, Controller, Get, Inject, Param, Post, Put, Req } from "@nestjs/common";
import type {
  CaptureUploadGrantResponse,
  CaptureImageMediaType,
  CommitCaptureEntryRequest,
  CommitCaptureEntryResponse,
  RecognitionSessionSummaryView,
  RecognitionSessionView,
  StockCaptureBatchView,
} from "@stockcontrol/contracts";
import {
  CAPTURE_MAX_PHOTOS,
  captureImageMediaTypes,
  validationFailed,
} from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";
import type { DeclaredImage } from "@stockcontrol/module-stock-capture";
import type { FastifyRequest } from "fastify";

import { API_TOKENS } from "../api.tokens";
import { canViewAllActivity, requireCapability } from "../auth/request-context";
import {
  bodyOf,
  optionalText,
  optionalUuid,
  readBoolean,
  readBoundedArray,
  requireText,
  requireUuid,
  requireUuidParameter,
  type Body as ParsedBody,
} from "../inventory/request-parsing";
import { uploadInvalid } from "./capture-failures";
import type { StockCaptureService } from "./stock-capture.service";

/**
 * The nine routes of specification section 10.
 *
 * Every handler starts with `requireCapability`, matching the rest of the
 * API — a route here is authenticated by the global guard and authorised on
 * top of that, never by anything the browser sent. Committing an entry that
 * creates a new item asks for `manageCatalogue` in addition to `manageStock`,
 * the same pairing the ordinary "new item" and "receive stock" routes ask
 * for separately — capture just asks for both in one request when the
 * command needs both.
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

  /**
   * Receives image bytes on the application's own origin, then the API writes
   * them to its private object store. Railway Buckets do not currently expose
   * a durable project-level CORS policy, so this keeps browser authentication,
   * origin enforcement, and the bucket credentials on their proper sides of
   * the boundary.
   */
  @Put("stock-capture/sessions/:sessionId/uploads/:imageId")
  public async uploadImage(
    @Req() request: FastifyRequest,
    @Param("sessionId") sessionId: string,
    @Param("imageId") imageId: string,
    @Body() bytes: unknown,
  ): Promise<{ readonly uploaded: true }> {
    const user = requireCapability(request, "manageStock");
    const mediaType = captureMediaTypeFrom(request.headers["content-type"]);

    if (!Buffer.isBuffer(bytes) || mediaType === undefined) {
      throw uploadInvalid("Upload a JPEG or WebP photograph.");
    }

    await this.capture.uploadImage({
      actorUserId: user.id,
      sessionId: requireUuidParameter(sessionId, "session"),
      imageId: requireUuidParameter(imageId, "image"),
      mediaType,
      bytes,
    });

    return { uploaded: true };
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

  @Post("stock-capture/batches/:batchId/entries")
  public async commitEntry(
    @Req() request: FastifyRequest,
    @Param("batchId") batchId: string,
    @Body() rawBody: unknown,
  ): Promise<CommitCaptureEntryResponse> {
    const user = requireCapability(request, "manageStock");
    const body = bodyOf(rawBody);
    const selection = readSelection(body);

    if (selection.kind === "NewItem") {
      requireCapability(request, "manageCatalogue");
    }

    return this.capture.commitEntry(
      {
        actorUserId: user.id,
        batchId: requireUuidParameter(batchId, "batch"),
        clientEntryId: requireUuid(body, "clientEntryId", "an entry id"),
        sessionId: requireUuid(body, "sessionId", "a session id"),
        selection,
        quantity: requireText(body, "quantity", "a quantity"),
        locationId: requireUuid(body, "locationId", "a location"),
        acknowledgedDuplicatePartNumber:
          readBoolean(body, "acknowledgedDuplicatePartNumber") ?? false,
      },
      { viewerUserId: user.id, scopeActivityToViewer: !canViewAllActivity(request) },
    );
  }
}

const selectionInvalid = (): ApplicationFailureException =>
  new ApplicationFailureException(
    validationFailed({ selection: ["Choose an item to receive stock against."] }),
  );

export const readSelection = (body: ParsedBody): CommitCaptureEntryRequest["selection"] => {
  const raw = body.selection;
  if (typeof raw !== "object" || raw === null) {
    throw selectionInvalid();
  }
  const record = raw as ParsedBody;
  const kind = record.kind;

  if (kind === "ExistingItem") {
    return {
      kind: "ExistingItem",
      itemId: requireUuid(record, "itemId", "an item"),
      candidateId: optionalUuid(record, "candidateId", "a candidate"),
    };
  }

  if (kind === "NewItem") {
    return {
      kind: "NewItem",
      candidateId: optionalUuid(record, "candidateId", "a candidate"),
      reference: optionalText(record, "reference"),
      name: requireText(record, "name", "an item name"),
      unit: requireText(record, "unit", "a unit, for example ea or m"),
      barcode: optionalText(record, "barcode"),
      partNumber: optionalText(record, "partNumber"),
    };
  }

  throw selectionInvalid();
};

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

const captureMediaTypeFrom = (
  value: string | string[] | undefined,
): CaptureImageMediaType | undefined => {
  if (typeof value !== "string") return undefined;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return isCaptureMediaType(mediaType) ? mediaType : undefined;
};

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
