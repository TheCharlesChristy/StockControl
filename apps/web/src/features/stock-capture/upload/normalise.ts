import {
  CAPTURE_MAX_LONG_EDGE,
  CAPTURE_MAX_SOURCE_BYTES,
  CAPTURE_MAX_SOURCE_PIXELS,
  type CaptureImageMediaType,
} from "@stockcontrol/contracts";

/*
 * A photo never leaves the device as the browser captured it. Re-encoding
 * through a canvas is what strips EXIF (orientation gets baked into the pixels
 * instead, GPS and everything else is simply not canvas state to begin with),
 * and it is also where the long-edge bound and the upload's own byte budget
 * get enforced — the server re-checks all of this on the bytes that actually
 * arrive, but a five-photo, ten-megapixel-each session is not something
 * anyone should have to wait to upload before being told no.
 */

export interface NormalisedImage {
  readonly file: File;
  readonly mediaType: CaptureImageMediaType;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

export class SourceImageRejectedError extends Error {}

/** A failed PUT. `retryable` separates a connection that dropped or a server
 *  that was briefly unwell from a refusal that will refuse again. */
export class CaptureUploadError extends Error {
  public constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "CaptureUploadError";
  }
}

const TARGET_QUALITY = 0.85;
const UPLOAD_ATTEMPTS = 3;
const UPLOAD_RETRY_DELAY_MS = 500;

/** The pieces of the browser's image pipeline this module depends on,
 * injectable so the orchestration logic can be tested without a real
 * decoder or canvas. */
export interface NormaliseDependencies {
  readonly decode: (source: Blob) => Promise<ImageBitmap>;
  readonly encode: (
    bitmap: ImageBitmap,
    width: number,
    height: number,
  ) => Promise<{ readonly blob: Blob; readonly mediaType: CaptureImageMediaType }>;
  readonly digest: (bytes: ArrayBuffer) => Promise<ArrayBuffer>;
}

const toHex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/*
 * Asked of a one-pixel canvas, once. `toDataURL` genuinely encodes whatever it
 * is given, so asking the full-size canvas — as this used to — spent a whole
 * WebP encode and a base64 of the result on every photograph purely to learn
 * something about the browser that cannot change between photographs.
 */
let webpSupported: boolean | null = null;

const supportsWebp = (): boolean => {
  if (webpSupported === null) {
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    webpSupported = probe.toDataURL("image/webp").startsWith("data:image/webp");
  }

  return webpSupported;
};

const defaultEncode: NormaliseDependencies["encode"] = (bitmap, width, height) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("This browser cannot draw an image for upload.");
  }
  context.drawImage(bitmap, 0, 0, width, height);

  const mediaType: CaptureImageMediaType = supportsWebp() ? "image/webp" : "image/jpeg";

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) {
          reject(new Error("This browser could not encode the photograph."));
          return;
        }
        resolve({ blob, mediaType });
      },
      mediaType,
      TARGET_QUALITY,
    );
  });
};

export const defaultNormaliseDependencies: NormaliseDependencies = {
  decode: (source) => createImageBitmap(source, { imageOrientation: "from-image" }),
  encode: defaultEncode,
  digest: (bytes) => crypto.subtle.digest("SHA-256", bytes),
};

const clampedDimensions = (width: number, height: number): { width: number; height: number } => {
  const longEdge = Math.max(width, height);
  if (longEdge <= CAPTURE_MAX_LONG_EDGE) return { width, height };
  const scale = CAPTURE_MAX_LONG_EDGE / longEdge;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
};

/**
 * Decodes, strips EXIF/location by re-encoding, bounds the long edge, and
 * digests the result — the exact bytes the presigned PUT will send. Refuses
 * a source that is implausibly large before spending time decoding it.
 */
export const normaliseImage = async (
  source: File,
  dependencies: NormaliseDependencies = defaultNormaliseDependencies,
): Promise<NormalisedImage> => {
  if (source.size > CAPTURE_MAX_SOURCE_BYTES) {
    throw new SourceImageRejectedError(
      "That photograph is too large. Try a lower-resolution shot.",
    );
  }

  const bitmap = await dependencies.decode(source);

  if (bitmap.width * bitmap.height > CAPTURE_MAX_SOURCE_PIXELS) {
    throw new SourceImageRejectedError(
      "That photograph is too large. Try a lower-resolution shot.",
    );
  }

  const { width, height } = clampedDimensions(bitmap.width, bitmap.height);
  const { blob, mediaType } = await dependencies.encode(bitmap, width, height);

  if (blob.size > CAPTURE_MAX_SOURCE_BYTES) {
    throw new SourceImageRejectedError(
      "That photograph is too large. Try a lower-resolution shot.",
    );
  }

  const bytes = await blob.arrayBuffer();
  const sha256 = toHex(await dependencies.digest(bytes));
  const extension = mediaType === "image/webp" ? "webp" : "jpg";

  return {
    file: new File([blob], `capture.${extension}`, { type: mediaType }),
    mediaType,
    byteLength: blob.size,
    width,
    height,
    sha256,
  };
};

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const putOnce = async (
  grant: { readonly url: string; readonly mediaType: CaptureImageMediaType },
  image: NormalisedImage,
  fetchImplementation: typeof fetch,
): Promise<void> => {
  let response: Response;

  try {
    response = await fetchImplementation(grant.url, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": grant.mediaType },
      body: image.file,
    });
  } catch {
    /* fetch only rejects when the request never completed — worth another go. */
    throw new CaptureUploadError(
      "That photograph could not be sent. Check your connection and try again.",
      true,
    );
  }

  if (!response.ok) {
    throw new CaptureUploadError(
      response.status >= 500
        ? "StockControl could not store that photograph. Try again in a moment."
        : "That photograph was not accepted. Take it again.",
      response.status >= 500,
    );
  }
};

/**
 * One PUT to the same-origin API route the server issued. The API applies the
 * ordinary session and origin checks, then writes to the private bucket; the
 * browser never needs object-storage CORS or bucket credentials.
 *
 * Retried, because the alternative is losing four good photographs to one
 * dropped packet on a stockroom's wifi. Only failures that could plausibly
 * succeed next time are retried; a refusal is reported straight away.
 */
export const uploadToGrant = async (
  grant: { readonly url: string; readonly mediaType: CaptureImageMediaType },
  image: NormalisedImage,
  fetchImplementation: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = delay,
): Promise<void> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await putOnce(grant, image, fetchImplementation);
      return;
    } catch (caught) {
      const retryable = caught instanceof CaptureUploadError && caught.retryable;
      if (!retryable || attempt >= UPLOAD_ATTEMPTS) throw caught;
      await wait(UPLOAD_RETRY_DELAY_MS * attempt);
    }
  }
};
