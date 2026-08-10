import { describe, expect, it } from "vitest";

import { ApplicationFailureException } from "@stockcontrol/platform";

import type { Body } from "../../src/inventory/request-parsing";
import {
  readDeclaredImages,
  readPhotoCount,
  readSelection,
} from "../../src/stock-capture/stock-capture.controller";

const bodyOf = (value: Record<string, unknown>): Body => value;

describe("reading a declared photo count", () => {
  it("accepts every count between zero and the maximum", () => {
    for (const photoCount of [0, 1, 5]) {
      expect(readPhotoCount(bodyOf({ photoCount }))).toBe(photoCount);
    }
  });

  it.each([-1, 6, 1.5, "3", null, undefined])("refuses %j", (photoCount) => {
    expect(() => readPhotoCount(bodyOf({ photoCount }))).toThrow(ApplicationFailureException);
  });
});

const validImage = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  ordinal: 1,
  mediaType: "image/jpeg",
  byteLength: 500_000,
  sha256: "a".repeat(64),
  width: 1_600,
  height: 1_200,
  ...over,
});

describe("reading declared image uploads", () => {
  it("reads a well-formed declaration through", () => {
    expect(readDeclaredImages(bodyOf({ images: [validImage()] }))).toEqual([
      {
        ordinal: 1,
        mediaType: "image/jpeg",
        byteLength: 500_000,
        sha256: "a".repeat(64),
        width: 1_600,
        height: 1_200,
      },
    ]);
  });

  it("accepts webp as well as jpeg", () => {
    expect(
      readDeclaredImages(bodyOf({ images: [validImage({ mediaType: "image/webp" })] }))[0]
        ?.mediaType,
    ).toBe("image/webp");
  });

  it("returns nothing when no images were declared", () => {
    expect(readDeclaredImages(bodyOf({}))).toEqual([]);
  });

  it("refuses a media type the pipeline cannot decode", () => {
    expect(() =>
      readDeclaredImages(bodyOf({ images: [validImage({ mediaType: "image/gif" })] })),
    ).toThrow(ApplicationFailureException);
  });

  it("refuses a declaration missing a required field", () => {
    for (const field of ["ordinal", "byteLength", "sha256", "width", "height"]) {
      expect(() =>
        readDeclaredImages(bodyOf({ images: [validImage({ [field]: undefined })] })),
      ).toThrow(ApplicationFailureException);
    }
  });

  it("refuses an entry that is not an object", () => {
    expect(() => readDeclaredImages(bodyOf({ images: ["not an image"] }))).toThrow(
      ApplicationFailureException,
    );
  });
});

const uuid = "11111111-1111-4111-8111-111111111111";
const otherUuid = "22222222-2222-4222-8222-222222222222";

describe("reading a commit selection", () => {
  it("reads an ExistingItem selection, with or without a candidate", () => {
    expect(
      readSelection(
        bodyOf({ selection: { kind: "ExistingItem", itemId: uuid, candidateId: null } }),
      ),
    ).toEqual({ kind: "ExistingItem", itemId: uuid, candidateId: null });

    expect(
      readSelection(
        bodyOf({ selection: { kind: "ExistingItem", itemId: uuid, candidateId: otherUuid } }),
      ),
    ).toEqual({ kind: "ExistingItem", itemId: uuid, candidateId: otherUuid });
  });

  it("reads a NewItem selection, defaulting absent optional fields to null", () => {
    expect(
      readSelection(bodyOf({ selection: { kind: "NewItem", name: "Widget", unit: "ea" } })),
    ).toEqual({
      kind: "NewItem",
      candidateId: null,
      reference: null,
      name: "Widget",
      unit: "ea",
      barcode: null,
      partNumber: null,
    });
  });

  it("reads every NewItem field when supplied", () => {
    expect(
      readSelection(
        bodyOf({
          selection: {
            kind: "NewItem",
            candidateId: otherUuid,
            reference: "ITM-9999",
            name: "Widget",
            unit: "ea",
            barcode: "5012345678900",
            partNumber: "RS-1234A",
          },
        }),
      ),
    ).toEqual({
      kind: "NewItem",
      candidateId: otherUuid,
      reference: "ITM-9999",
      name: "Widget",
      unit: "ea",
      barcode: "5012345678900",
      partNumber: "RS-1234A",
    });
  });

  it("refuses a NewItem selection missing a required field", () => {
    expect(() => readSelection(bodyOf({ selection: { kind: "NewItem", unit: "ea" } }))).toThrow(
      ApplicationFailureException,
    );
    expect(() => readSelection(bodyOf({ selection: { kind: "NewItem", name: "Widget" } }))).toThrow(
      ApplicationFailureException,
    );
  });

  it("refuses an ExistingItem selection missing its item id", () => {
    expect(() =>
      readSelection(bodyOf({ selection: { kind: "ExistingItem", candidateId: null } })),
    ).toThrow(ApplicationFailureException);
  });

  it.each([undefined, null, "ExistingItem", 42, { kind: "Unknown" }])(
    "refuses a malformed selection %j",
    (selection) => {
      expect(() => readSelection(bodyOf({ selection }))).toThrow(ApplicationFailureException);
    },
  );
});
