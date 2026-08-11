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

const TARGET_QUALITY = 0.85;

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

const supportsWebp = (canvas: HTMLCanvasElement): boolean =>
  canvas.toDataURL("image/webp").startsWith("data:image/webp");

const defaultEncode: NormaliseDependencies["encode"] = (bitmap, width, height) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("This browser cannot draw an image for upload.");
  }
  context.drawImage(bitmap, 0, 0, width, height);

  const mediaType: CaptureImageMediaType = supportsWebp(canvas) ? "image/webp" : "image/jpeg";

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

/** One PUT to the presigned URL the API issued. No credentials, no retry:
 * a failed upload surfaces as a normal error the person can act on by
 * retaking or resubmitting. */
export const uploadToGrant = async (
  grant: { readonly url: string; readonly mediaType: CaptureImageMediaType },
  image: NormalisedImage,
  fetchImplementation: typeof fetch = fetch,
): Promise<void> => {
  const response = await fetchImplementation(grant.url, {
    method: "PUT",
    headers: { "content-type": grant.mediaType },
    body: image.file,
  });

  if (!response.ok) {
    throw new Error("That photograph could not be uploaded. Check your connection and try again.");
  }
};
