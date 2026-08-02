import { describe, expect, it } from "vitest";

import { digestFor } from "../../src/media/image-validation";
import { matchesStoredPhoto } from "../../src/media/photos.service";

describe("stored photo integrity", () => {
  it("accepts bigint byte lengths returned as strings by PostgreSQL", () => {
    const bytes = Buffer.from("photo");

    expect(matchesStoredPhoto(bytes, String(bytes.length), digestFor(bytes))).toBe(true);
  });

  it("rejects a length or digest mismatch", () => {
    const bytes = Buffer.from("photo");

    expect(matchesStoredPhoto(bytes, bytes.length + 1, digestFor(bytes))).toBe(false);
    expect(matchesStoredPhoto(bytes, bytes.length, "0".repeat(64))).toBe(false);
  });
});
