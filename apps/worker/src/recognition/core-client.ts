/*
 * HTTP client for recognition-core (specification section 9.1). The service
 * returns observations, never decisions, but it is still a network boundary:
 * its response is parsed defensively rather than trusted, the same way a
 * browser request body would be.
 */

export interface RecognitionCoreImageInput {
  readonly ordinal: number;
  readonly bytes: Buffer;
  readonly mediaType: string;
}

export type CoreStageOutcome = "Succeeded" | "NotApplicable" | "Unavailable" | "Failed";

export interface CoreBarcodeObservation {
  readonly value: string;
  readonly symbology: string;
}

export interface CoreOcrLine {
  readonly text: string;
  readonly score: number;
}

export interface CoreVariantAttribute {
  readonly label: string;
  readonly value: string;
}

export interface CoreParsedIdentifiers {
  readonly manufacturerTokens: readonly string[];
  readonly nameFragments: readonly string[];
  readonly partNumberCandidates: readonly string[];
  readonly barcodeLikeCandidates: readonly string[];
  readonly variantAttributes: readonly CoreVariantAttribute[];
  readonly labelledPackQuantity: string | null;
}

export interface CoreEmbedding {
  readonly modelRevision: string;
  readonly vector: readonly number[];
}

export interface CoreCategoryLabel {
  readonly label: string;
  readonly score: number;
}

/** A normalised (0-1) box, so it survives independent of pixel geometry. */
export interface CoreCropBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly label: string;
}

/** Cheap, untuned image-statistics heuristics — see recognition-core's
 * quality.py docstring — not a learned quality model. */
export interface CoreImageQuality {
  readonly blurScore: number;
  readonly foregroundAreaRatio: number;
}

export interface CorePhotoResult {
  readonly imageOrdinal: number;
  readonly barcodeOutcome: CoreStageOutcome;
  readonly barcodes: readonly CoreBarcodeObservation[];
  readonly ocrOutcome: CoreStageOutcome;
  readonly ocrLines: readonly CoreOcrLine[];
  readonly identifiers: CoreParsedIdentifiers;
  readonly embeddingOutcome: CoreStageOutcome;
  readonly embedding: CoreEmbedding | null;
  readonly categoryOutcome: CoreStageOutcome;
  readonly categories: readonly CoreCategoryLabel[];
  readonly quality: CoreImageQuality;
  readonly crops: readonly CoreCropBox[];
}

export interface AnalyseSessionResult {
  readonly requestId: string;
  readonly modelManifestVersion: string;
  readonly photoResults: readonly CorePhotoResult[];
}

export interface RenderExemplarResult {
  readonly bytes: Buffer;
  readonly mediaType: string;
  readonly width: number;
  readonly height: number;
}

export class RecognitionCoreUnavailableError extends Error {
  public readonly code = "recognition.core_unavailable";
  public constructor(detail: string) {
    super(detail);
    this.name = "RecognitionCoreUnavailableError";
  }
}

const STAGE_OUTCOMES: readonly CoreStageOutcome[] = [
  "Succeeded",
  "NotApplicable",
  "Unavailable",
  "Failed",
];
const isStageOutcome = (value: unknown): value is CoreStageOutcome =>
  typeof value === "string" && (STAGE_OUTCOMES as readonly string[]).includes(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readString = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];
  if (typeof value !== "string") {
    throw new RecognitionCoreUnavailableError(`recognition-core response is missing "${key}".`);
  }
  return value;
};

const readNumber = (record: Record<string, unknown>, key: string): number => {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RecognitionCoreUnavailableError(`recognition-core response is missing "${key}".`);
  }
  return value;
};

const parseBarcode = (value: unknown): CoreBarcodeObservation => {
  if (!isRecord(value)) throw new RecognitionCoreUnavailableError("Malformed barcode observation.");
  return { value: readString(value, "value"), symbology: readString(value, "symbology") };
};

const parseOcrLine = (value: unknown): CoreOcrLine => {
  if (!isRecord(value)) throw new RecognitionCoreUnavailableError("Malformed OCR line.");
  return { text: readString(value, "text"), score: readNumber(value, "score") };
};

const parseVariantAttribute = (value: unknown): CoreVariantAttribute => {
  if (!isRecord(value)) throw new RecognitionCoreUnavailableError("Malformed variant attribute.");
  return { label: readString(value, "label"), value: readString(value, "value") };
};

const readStringArray = (record: Record<string, unknown>, key: string): readonly string[] => {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new RecognitionCoreUnavailableError(`recognition-core response is missing "${key}".`);
  }
  return value;
};

const parseIdentifiers = (value: unknown): CoreParsedIdentifiers => {
  if (!isRecord(value)) throw new RecognitionCoreUnavailableError("Malformed parsed identifiers.");
  const labelledPackQuantity = value.labelledPackQuantity;
  return {
    manufacturerTokens: readStringArray(value, "manufacturerTokens"),
    nameFragments: readStringArray(value, "nameFragments"),
    partNumberCandidates: readStringArray(value, "partNumberCandidates"),
    barcodeLikeCandidates: readStringArray(value, "barcodeLikeCandidates"),
    variantAttributes: Array.isArray(value.variantAttributes)
      ? value.variantAttributes.map(parseVariantAttribute)
      : [],
    labelledPackQuantity: typeof labelledPackQuantity === "string" ? labelledPackQuantity : null,
  };
};

const parseEmbedding = (value: unknown): CoreEmbedding | null => {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new RecognitionCoreUnavailableError("Malformed embedding.");
  const vector = value.vector;
  if (!Array.isArray(vector) || !vector.every((entry) => typeof entry === "number")) {
    throw new RecognitionCoreUnavailableError("Malformed embedding vector.");
  }
  return { modelRevision: readString(value, "modelRevision"), vector };
};

const parseCategory = (value: unknown): CoreCategoryLabel => {
  if (!isRecord(value)) throw new RecognitionCoreUnavailableError("Malformed category label.");
  return { label: readString(value, "label"), score: readNumber(value, "score") };
};

const parseQuality = (value: unknown): CoreImageQuality => {
  if (!isRecord(value)) throw new RecognitionCoreUnavailableError("Malformed image quality.");
  return {
    blurScore: readNumber(value, "blurScore"),
    foregroundAreaRatio: readNumber(value, "foregroundAreaRatio"),
  };
};

const parseCropBox = (value: unknown): CoreCropBox => {
  if (!isRecord(value)) throw new RecognitionCoreUnavailableError("Malformed crop box.");
  return {
    x: readNumber(value, "x"),
    y: readNumber(value, "y"),
    width: readNumber(value, "width"),
    height: readNumber(value, "height"),
    label: readString(value, "label"),
  };
};

const parsePhotoResult = (value: unknown): CorePhotoResult => {
  if (!isRecord(value)) throw new RecognitionCoreUnavailableError("Malformed photo result.");

  const barcodeOutcome = value.barcodeOutcome;
  const ocrOutcome = value.ocrOutcome;
  const embeddingOutcome = value.embeddingOutcome;
  const categoryOutcome = value.categoryOutcome;
  if (
    !isStageOutcome(barcodeOutcome) ||
    !isStageOutcome(ocrOutcome) ||
    !isStageOutcome(embeddingOutcome) ||
    !isStageOutcome(categoryOutcome)
  ) {
    throw new RecognitionCoreUnavailableError("Malformed stage outcome in photo result.");
  }

  return {
    imageOrdinal: readNumber(value, "imageOrdinal"),
    barcodeOutcome,
    barcodes: Array.isArray(value.barcodes) ? value.barcodes.map(parseBarcode) : [],
    ocrOutcome,
    ocrLines: Array.isArray(value.ocrLines) ? value.ocrLines.map(parseOcrLine) : [],
    identifiers: parseIdentifiers(value.identifiers),
    embeddingOutcome,
    embedding: parseEmbedding(value.embedding),
    categoryOutcome,
    categories: Array.isArray(value.categories) ? value.categories.map(parseCategory) : [],
    quality: parseQuality(value.quality),
    crops: Array.isArray(value.crops) ? value.crops.map(parseCropBox) : [],
  };
};

export const parseAnalyseSessionResponse = (value: unknown): AnalyseSessionResult => {
  if (!isRecord(value))
    throw new RecognitionCoreUnavailableError("Malformed analyse-session response.");
  const photoResults = value.photoResults;
  if (!Array.isArray(photoResults)) {
    throw new RecognitionCoreUnavailableError("recognition-core response is missing photoResults.");
  }
  return {
    requestId: readString(value, "requestId"),
    modelManifestVersion: readString(value, "modelManifestVersion"),
    photoResults: photoResults.map(parsePhotoResult),
  };
};

export interface RecognitionCoreClientOptions {
  readonly baseUrl: string;
  readonly timeoutMilliseconds: number;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Fan-out per image happens in the caller: this client sends every photo in
 * one multipart request, matching recognition-core's `/v1/analyse-session`
 * contract (spec 9.1), which already bounds the request to five images.
 */
export class RecognitionCoreClient {
  public constructor(
    private readonly options: RecognitionCoreClientOptions,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  public async analyseSession(
    requestId: string,
    images: readonly RecognitionCoreImageInput[],
  ): Promise<AnalyseSessionResult> {
    const form = new FormData();
    form.set("request_id", requestId);
    for (const image of images) {
      form.append(
        "images",
        new Blob([new Uint8Array(image.bytes)], { type: image.mediaType }),
        `${String(image.ordinal)}`,
      );
    }

    const response = await this.send("/v1/analyse-session", form);
    const json: unknown = await response.json().catch(() => {
      throw new RecognitionCoreUnavailableError("recognition-core returned a non-JSON response.");
    });
    return parseAnalyseSessionResponse(json);
  }

  public async renderExemplar(
    image: RecognitionCoreImageInput,
    crop: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    },
  ): Promise<RenderExemplarResult> {
    const form = new FormData();
    form.set("x", String(crop.x));
    form.set("y", String(crop.y));
    form.set("width", String(crop.width));
    form.set("height", String(crop.height));
    form.set("image", new Blob([new Uint8Array(image.bytes)], { type: image.mediaType }), "image");

    const response = await this.send("/v1/render-exemplar", form);
    const widthHeader = response.headers.get("x-recognition-width");
    const heightHeader = response.headers.get("x-recognition-height");
    const width = widthHeader === null ? NaN : Number(widthHeader);
    const height = heightHeader === null ? NaN : Number(heightHeader);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      throw new RecognitionCoreUnavailableError(
        "recognition-core response is missing crop dimensions.",
      );
    }

    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      mediaType: response.headers.get("content-type") ?? "application/octet-stream",
      width,
      height,
    };
  }

  private async send(path: string, body: FormData): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.options.timeoutMilliseconds);

    try {
      const response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
        method: "POST",
        body,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new RecognitionCoreUnavailableError(
          `recognition-core responded with status ${String(response.status)}.`,
        );
      }
      return response;
    } catch (error: unknown) {
      if (error instanceof RecognitionCoreUnavailableError) throw error;
      throw new RecognitionCoreUnavailableError(
        error instanceof Error ? error.name : "recognition-core request failed.",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
