import { describe, expect, it } from "vitest";

import { CAPTURE_MAX_SOURCE_BYTES } from "@stockcontrol/contracts";

import {
  describeImageProblem,
  isCaptureImageMediaType,
  validateImageDeclarations,
  type DeclaredImage,
} from "../src/limits";

const digest = "a".repeat(64);

const image = (over: Partial<DeclaredImage> = {}): DeclaredImage => ({
  ordinal: 1,
  mediaType: "image/jpeg",
  byteLength: 500_000,
  sha256: digest,
  width: 1_600,
  height: 1_200,
  ...over,
});

describe("upload declarations", () => {
  it("accepts one to five normalised photographs", () => {
    const images = [1, 2, 3, 4, 5].map((ordinal) => image({ ordinal }));
    expect(validateImageDeclarations(images)).toEqual([]);
  });

  it("refuses an empty session and a sixth photograph", () => {
    expect(validateImageDeclarations([])).toContain("no_photos");
    expect(
      validateImageDeclarations([1, 2, 3, 4, 5, 6].map((ordinal) => image({ ordinal }))),
    ).toContain("too_many_photos");
  });

  it("refuses two photographs claiming the same position", () => {
    expect(validateImageDeclarations([image(), image()])).toContain("duplicate_ordinal");
  });

  it("refuses a media type the pipeline does not decode", () => {
    expect(validateImageDeclarations([image({ mediaType: "image/svg+xml" })])).toContain(
      "media_type_not_allowed",
    );
    expect(isCaptureImageMediaType("image/webp")).toBe(true);
    expect(isCaptureImageMediaType("application/pdf")).toBe(false);
  });

  it("refuses a photograph larger than the per-file limit", () => {
    expect(
      validateImageDeclarations([image({ byteLength: CAPTURE_MAX_SOURCE_BYTES + 1 })]),
    ).toContain("byte_length_out_of_range");
  });

  it("refuses a session whose photographs are too large together", () => {
    const images = [1, 2, 3].map((ordinal) =>
      image({ ordinal, byteLength: CAPTURE_MAX_SOURCE_BYTES }),
    );
    expect(validateImageDeclarations(images)).toContain("session_bytes_exceeded");
  });

  /* Anything above the long-edge cap means the browser did not normalise it. */
  it("refuses a photograph that was never resized", () => {
    expect(validateImageDeclarations([image({ width: 6_000, height: 4_000 })])).toContain(
      "dimensions_out_of_range",
    );
  });

  it("refuses a digest that is not a lowercase SHA-256", () => {
    expect(validateImageDeclarations([image({ sha256: "not-a-digest" })])).toContain(
      "digest_malformed",
    );
    expect(validateImageDeclarations([image({ sha256: "A".repeat(64) })])).toContain(
      "digest_malformed",
    );
  });

  it("reports every problem at once rather than one per round trip", () => {
    const problems = validateImageDeclarations([
      image({ mediaType: "image/gif", sha256: "short", width: 9_000 }),
    ]);
    expect(problems).toContain("media_type_not_allowed");
    expect(problems).toContain("digest_malformed");
    expect(problems).toContain("dimensions_out_of_range");
  });

  it("explains every problem in words a stockroom would use", () => {
    const problems = validateImageDeclarations([
      image({ ordinal: 99, mediaType: "image/gif", byteLength: 0, sha256: "x", width: 9_000 }),
      image({ ordinal: 99 }),
    ]);
    for (const problem of problems) {
      const message = describeImageProblem(problem);
      expect(message.endsWith(".")).toBe(true);
      expect(message).not.toMatch(/_|MIME|SHA/u);
    }
    expect(describeImageProblem("no_photos")).toBe("Take at least one photograph.");
    expect(describeImageProblem("session_bytes_exceeded")).toContain("too large together");
  });
});
