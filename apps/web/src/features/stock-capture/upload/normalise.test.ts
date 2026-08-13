import { describe, expect, it, vi } from "vitest";

import { CAPTURE_MAX_SOURCE_BYTES } from "@stockcontrol/contracts";

import {
  normaliseImage,
  SourceImageRejectedError,
  uploadToGrant,
  type NormaliseDependencies,
} from "./normalise";

const fakeBitmap = (width: number, height: number): ImageBitmap => ({
  width,
  height,
  close: () => undefined,
});

const fakeDependencies = (
  over: Partial<NormaliseDependencies> = {},
  bitmap: ImageBitmap = fakeBitmap(3_000, 2_000),
  encodedBytes = new Uint8Array([1, 2, 3, 4]),
): NormaliseDependencies => ({
  decode: vi.fn().mockResolvedValue(bitmap),
  encode: vi
    .fn()
    .mockResolvedValue({ blob: new Blob([encodedBytes]), mediaType: "image/webp" as const }),
  digest: vi.fn().mockResolvedValue(new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer),
  ...over,
});

const sourceFile = (byteLength = 1_000): File =>
  new File([new Uint8Array(byteLength)], "source.jpg", { type: "image/jpeg" });

describe("normaliseImage", () => {
  it("refuses a source file larger than the declared byte limit before decoding", async () => {
    const dependencies = fakeDependencies();
    await expect(
      normaliseImage(sourceFile(CAPTURE_MAX_SOURCE_BYTES + 1), dependencies),
    ).rejects.toBeInstanceOf(SourceImageRejectedError);
    expect(dependencies.decode).not.toHaveBeenCalled();
  });

  it("refuses a decoded image with too many pixels", async () => {
    const dependencies = fakeDependencies({}, fakeBitmap(10_000, 10_000));
    await expect(normaliseImage(sourceFile(), dependencies)).rejects.toBeInstanceOf(
      SourceImageRejectedError,
    );
  });

  it("clamps the long edge to the declared bound, preserving aspect ratio", async () => {
    const dependencies = fakeDependencies({}, fakeBitmap(4_096, 2_048));
    await normaliseImage(sourceFile(), dependencies);

    expect(dependencies.encode).toHaveBeenCalledWith(expect.anything(), 2_048, 1_024);
  });

  it("leaves dimensions unchanged when already within the bound", async () => {
    const dependencies = fakeDependencies({}, fakeBitmap(800, 600));
    await normaliseImage(sourceFile(), dependencies);

    expect(dependencies.encode).toHaveBeenCalledWith(expect.anything(), 800, 600);
  });

  it("returns the encoded file, its declared media type and a hex digest", async () => {
    const dependencies = fakeDependencies();
    const result = await normaliseImage(sourceFile(), dependencies);

    expect(result.mediaType).toBe("image/webp");
    expect(result.width).toBe(2_048);
    expect(result.height).toBeGreaterThan(0);
    expect(result.sha256).toBe("deadbeef");
    expect(result.file.type).toBe("image/webp");
    expect(result.file.name.endsWith(".webp")).toBe(true);
  });

  it("refuses an encoded result that grew past the byte limit", async () => {
    const dependencies = fakeDependencies({
      encode: vi.fn().mockResolvedValue({
        blob: new Blob([new Uint8Array(CAPTURE_MAX_SOURCE_BYTES + 1)]),
        mediaType: "image/webp",
      }),
    });

    await expect(normaliseImage(sourceFile(), dependencies)).rejects.toBeInstanceOf(
      SourceImageRejectedError,
    );
  });

  it("names a jpeg output with a .jpg extension", async () => {
    const dependencies = fakeDependencies({
      encode: vi
        .fn()
        .mockResolvedValue({ blob: new Blob([new Uint8Array([1])]), mediaType: "image/jpeg" }),
    });
    const result = await normaliseImage(sourceFile(), dependencies);
    expect(result.file.name.endsWith(".jpg")).toBe(true);
  });
});

describe("uploadToGrant", () => {
  it("PUTs the encoded file through the authenticated same-origin route", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const dependencies = fakeDependencies();
    const image = await normaliseImage(sourceFile(), dependencies);

    await uploadToGrant(
      { url: "/api/v1/stock-capture/sessions/session-1/uploads/image-1", mediaType: "image/webp" },
      image,
      fetchImplementation,
    );

    expect(fetchImplementation).toHaveBeenCalledWith(
      "/api/v1/stock-capture/sessions/session-1/uploads/image-1",
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "image/webp" },
      }),
    );
  });

  it("throws a plain-English error on a failed upload", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    const dependencies = fakeDependencies();
    const image = await normaliseImage(sourceFile(), dependencies);

    await expect(
      uploadToGrant(
        {
          url: "/api/v1/stock-capture/sessions/session-1/uploads/image-1",
          mediaType: "image/webp",
        },
        image,
        fetchImplementation,
      ),
    ).rejects.toThrow("could not store that photograph");
  });

  /*
   * A stockroom's wifi drops packets. Failing the whole session on the first
   * one threw away every photograph already taken and sent.
   */
  it("retries a dropped connection and succeeds on a later attempt", async () => {
    let attempts = 0;
    const fetchImplementation = vi.fn().mockImplementation(() => {
      attempts += 1;
      return attempts < 3
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve(new Response(null, { status: 200 }));
    });
    const image = await normaliseImage(sourceFile(), fakeDependencies());

    await uploadToGrant(
      { url: "/api/v1/stock-capture/sessions/session-1/uploads/image-1", mediaType: "image/webp" },
      image,
      fetchImplementation,
      () => Promise.resolve(),
    );

    expect(attempts).toBe(3);
  });

  it("gives up rather than retrying a refusal that will refuse again", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(null, { status: 415 }));
    const image = await normaliseImage(sourceFile(), fakeDependencies());

    await expect(
      uploadToGrant(
        {
          url: "/api/v1/stock-capture/sessions/session-1/uploads/image-1",
          mediaType: "image/webp",
        },
        image,
        fetchImplementation as unknown as typeof fetch,
        () => Promise.resolve(),
      ),
    ).rejects.toThrow("was not accepted");
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("stops retrying a server failure after a bounded number of attempts", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    const image = await normaliseImage(sourceFile(), fakeDependencies());

    await expect(
      uploadToGrant(
        {
          url: "/api/v1/stock-capture/sessions/session-1/uploads/image-1",
          mediaType: "image/webp",
        },
        image,
        fetchImplementation as unknown as typeof fetch,
        () => Promise.resolve(),
      ),
    ).rejects.toThrow("could not store that photograph");
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
  });
});
