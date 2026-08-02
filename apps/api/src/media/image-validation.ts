import { createHash } from "node:crypto";

import type { ImageMediaType, ImageUploadRequest } from "@stockcontrol/contracts";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_START = Buffer.from([0xff, 0xd8]);
const MAX_DIMENSION = 20_000;
const MAX_PIXELS = 100_000_000;

export interface DecodedImage {
  readonly bytes: Buffer;
  readonly width: number;
  readonly height: number;
}

const decodeBase64 = (value: string, maxBytes: number): Buffer => {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value))
    throw new Error("Image bytes must be valid base64.");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 1 || bytes.length > maxBytes)
    throw new Error(`Image bytes must be between 1 and ${String(maxBytes)} bytes.`);
  return bytes;
};

const validateDimensions = (
  width: number,
  height: number,
): { readonly width: number; readonly height: number } => {
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION ||
    width * height > MAX_PIXELS
  )
    throw new Error("The uploaded image has invalid or excessive dimensions.");
  return { width, height };
};

const pngDimensions = (bytes: Buffer): { readonly width: number; readonly height: number } => {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE))
    throw new Error("The uploaded PNG is invalid.");
  if (bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error("The uploaded PNG is invalid.");
  return validateDimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
};

const jpegDimensions = (bytes: Buffer): { readonly width: number; readonly height: number } => {
  if (bytes.length < 4 || !bytes.subarray(0, 2).equals(JPEG_START))
    throw new Error("The uploaded JPEG is invalid.");
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error("The uploaded JPEG is invalid.");
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 1 >= bytes.length) break;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length)
      throw new Error("The uploaded JPEG is invalid.");
    const isFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isFrame && segmentLength >= 7)
      return validateDimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
    offset += segmentLength;
  }
  throw new Error("The uploaded JPEG has no valid dimensions.");
};

export const decodeImage = (input: ImageUploadRequest, maxBytes: number): DecodedImage => {
  if (
    input.originalFileName.trim() !== input.originalFileName ||
    input.originalFileName.length < 1 ||
    input.originalFileName.length > 240 ||
    [...input.originalFileName].some((character) => {
      const code = character.charCodeAt(0);
      return character === "/" || character === "\\" || code <= 0x1f || code === 0x7f;
    })
  )
    throw new Error("A safe image filename is required.");
  const bytes = decodeBase64(input.contentBase64, maxBytes);
  const dimensions = input.mediaType === "image/png" ? pngDimensions(bytes) : jpegDimensions(bytes);
  return { bytes, ...dimensions };
};

export const digestFor = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

export const isImageMediaType = (value: unknown): value is ImageMediaType =>
  value === "image/png" || value === "image/jpeg";
