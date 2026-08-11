import {
  CAPTURE_MAX_LONG_EDGE,
  CAPTURE_MAX_PHOTOS,
  CAPTURE_MAX_SESSION_BYTES,
  CAPTURE_MAX_SOURCE_BYTES,
  CAPTURE_MAX_SOURCE_PIXELS,
  captureImageMediaTypes,
  type CaptureImageMediaType,
} from "@stockcontrol/contracts";

/*
 * Upload limits, checked in the browser for a useful message and again on the
 * server because the browser is not trusted. The declarations validated here
 * are claims about bytes that have not been seen yet — the worker re-verifies
 * every one of them against the object it actually downloads.
 */

export interface DeclaredImage {
  readonly ordinal: number;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
}

export type ImageDeclarationProblem =
  | "too_many_photos"
  | "no_photos"
  | "duplicate_ordinal"
  | "ordinal_out_of_range"
  | "media_type_not_allowed"
  | "byte_length_out_of_range"
  | "session_bytes_exceeded"
  | "dimensions_out_of_range"
  | "digest_malformed";

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export const isCaptureImageMediaType = (value: string): value is CaptureImageMediaType =>
  (captureImageMediaTypes as readonly string[]).includes(value);

/**
 * Returns every problem rather than the first, so a person retaking five
 * photographs is told about all of them at once instead of one per round trip.
 */
export const validateImageDeclarations = (
  images: readonly DeclaredImage[],
): readonly ImageDeclarationProblem[] => {
  const problems = new Set<ImageDeclarationProblem>();

  if (images.length === 0) problems.add("no_photos");
  if (images.length > CAPTURE_MAX_PHOTOS) problems.add("too_many_photos");

  const seenOrdinals = new Set<number>();
  let totalBytes = 0;

  for (const image of images) {
    if (
      !Number.isInteger(image.ordinal) ||
      image.ordinal < 1 ||
      image.ordinal > CAPTURE_MAX_PHOTOS
    ) {
      problems.add("ordinal_out_of_range");
    } else if (seenOrdinals.has(image.ordinal)) {
      problems.add("duplicate_ordinal");
    } else {
      seenOrdinals.add(image.ordinal);
    }

    if (!isCaptureImageMediaType(image.mediaType)) problems.add("media_type_not_allowed");

    if (
      !Number.isInteger(image.byteLength) ||
      image.byteLength < 1 ||
      image.byteLength > CAPTURE_MAX_SOURCE_BYTES
    ) {
      problems.add("byte_length_out_of_range");
    } else {
      totalBytes += image.byteLength;
    }

    if (!SHA256_PATTERN.test(image.sha256)) problems.add("digest_malformed");

    const validDimensions =
      Number.isInteger(image.width) &&
      Number.isInteger(image.height) &&
      image.width >= 1 &&
      image.height >= 1 &&
      Math.max(image.width, image.height) <= CAPTURE_MAX_LONG_EDGE &&
      image.width * image.height <= CAPTURE_MAX_SOURCE_PIXELS;
    if (!validDimensions) problems.add("dimensions_out_of_range");
  }

  if (totalBytes > CAPTURE_MAX_SESSION_BYTES) problems.add("session_bytes_exceeded");

  return [...problems];
};

/** Plain English for a stockroom, not a validator's vocabulary. */
export const describeImageProblem = (problem: ImageDeclarationProblem): string => {
  switch (problem) {
    case "too_many_photos":
      return `Take up to ${String(CAPTURE_MAX_PHOTOS)} photographs of one item.`;
    case "no_photos":
      return "Take at least one photograph.";
    case "duplicate_ordinal":
      return "Two photographs were sent in the same position.";
    case "ordinal_out_of_range":
      return "A photograph was sent in a position that does not exist.";
    case "media_type_not_allowed":
      return "Photographs must be JPEG or WebP.";
    case "byte_length_out_of_range":
      return "One photograph is empty or larger than the limit.";
    case "session_bytes_exceeded":
      return "Those photographs are too large together. Retake one or use fewer.";
    case "dimensions_out_of_range":
      return "One photograph is the wrong size after resizing.";
    case "digest_malformed":
      return "A photograph could not be checked. Retake it.";
  }
};
