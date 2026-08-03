import { describe, expect, it } from "vitest";

import type { ImageUploadRequest } from "@stockcontrol/contracts";

import { decodeImage, digestFor } from "../../src/media/image-validation";

function png(width = 1, height = 1): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function jpeg(width = 1, height = 1): Buffer {
  const bytes = Buffer.alloc(25);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = 0xc0;
  bytes.writeUInt16BE(17, 4);
  bytes[7] = (height >> 8) & 0xff;
  bytes[8] = height & 0xff;
  bytes[9] = (width >> 8) & 0xff;
  bytes[10] = width & 0xff;
  return bytes;
}

const upload = (
  bytes: Buffer,
  mediaType: "image/png" | "image/jpeg",
  fileName = "photo.png",
): ImageUploadRequest => ({
  originalFileName: fileName,
  mediaType,
  contentBase64: bytes.toString("base64"),
});

describe("image upload validation", () => {
  it("accepts PNG and reports dimensions", () => {
    expect(decodeImage(upload(png(320, 180), "image/png"), 1024)).toMatchObject({
      width: 320,
      height: 180,
    });
  });

  it("accepts JPEG and reports dimensions", () => {
    expect(decodeImage(upload(jpeg(640, 480), "image/jpeg", "photo.jpg"), 1024)).toMatchObject({
      width: 640,
      height: 480,
    });
  });

  it("rejects a declared type whose signature does not match", () => {
    expect(() => decodeImage(upload(png(), "image/jpeg", "photo.jpg"), 1024)).toThrow(
      "uploaded JPEG",
    );
  });

  it("rejects unsafe names, oversized bytes and excessive dimensions", () => {
    expect(() => decodeImage(upload(png(), "image/png", "../photo.png"), 1024)).toThrow(
      "safe image filename",
    );
    expect(() => decodeImage(upload(png(), "image/png"), 10)).toThrow("between 1 and 10 bytes");
    expect(() => decodeImage(upload(png(20_001, 1), "image/png"), 1024)).toThrow(
      "excessive dimensions",
    );
  });

  it("produces a stable SHA-256 digest for object integrity", () => {
    expect(digestFor(Buffer.from("photo"))).toBe(
      "55c64d0fcd6f9d5f7c828093857e3fdfda68478bb4e9bd24d481ef391c7804e8",
    );
  });
});
