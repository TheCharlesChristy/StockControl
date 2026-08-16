import type { ItemDetailView } from "@stockcontrol/contracts";
import { describe, expect, it } from "vitest";

import type { CapturedPhoto } from "./photo-tray";
import { initialScanState, isListening, scanReducer, type ScanState } from "./scan-reducer";

const item = { id: "item-1", reference: "ITM-0001", name: "Widget" } as ItemDetailView;

const photo = (ordinal: number, code: string | null = null): CapturedPhoto => ({
  ordinal,
  file: new File(["x"], `photo-${String(ordinal)}.jpg`, { type: "image/jpeg" }),
  previewUrl: `blob:photo-${String(ordinal)}`,
  sourceType: "image/jpeg",
  localCodes:
    code === null
      ? []
      : [{ value: code, symbology: "EAN-13", imageOrdinal: ordinal, readerVersion: "test" }],
});

const withPhotos = (...photos: readonly CapturedPhoto[]): ScanState =>
  scanReducer(initialScanState, { type: "PhotosAdded", photos });

describe("the scan sheet's state", () => {
  it("keeps photographs while a lookup runs, so removing one is still possible", () => {
    const added = withPhotos(photo(1), photo(2));
    const looking = scanReducer(added, { type: "LookupStarted", code: "5012345678900" });

    expect(looking.photos).toHaveLength(2);
    expect(looking.outcome).toEqual({ kind: "Looking", code: "5012345678900" });
  });

  it("reports that no code was found in the photographs", () => {
    const state = scanReducer(withPhotos(photo(1)), { type: "NoCodeFound" });

    expect(state.outcome).toEqual({ kind: "NoCode" });
  });

  /*
   * The camera and the photographs race: a decode that finishes after somebody
   * has already scanned the label would otherwise replace the item on screen
   * with "no code found in your photographs".
   */
  it("does not let a silent photograph overwrite an item already found", () => {
    const found = scanReducer(withPhotos(photo(1)), {
      type: "ItemFound",
      item,
      source: "camera",
    });

    expect(scanReducer(found, { type: "NoCodeFound" }).outcome).toEqual({
      kind: "Found",
      item,
      source: "camera",
    });
  });

  it("stops saying no code was found once the last photograph is removed", () => {
    const state = scanReducer(scanReducer(withPhotos(photo(1)), { type: "NoCodeFound" }), {
      type: "PhotoRemoved",
      ordinal: 1,
    });

    expect(state.photos).toHaveLength(0);
    expect(state.outcome).toEqual({ kind: "Nothing" });
  });

  it("keeps the remaining photographs when one is removed", () => {
    const state = scanReducer(withPhotos(photo(1), photo(2)), {
      type: "PhotoRemoved",
      ordinal: 1,
    });

    expect(state.photos.map((entry) => entry.ordinal)).toEqual([2]);
  });

  it("clears everything when the person starts over", () => {
    const busy = scanReducer(withPhotos(photo(1, "5012345678900")), {
      type: "ItemFound",
      item,
      source: "photo",
    });

    expect(scanReducer(busy, { type: "StartOver" })).toEqual(initialScanState);
  });

  it("explains a code that matched nothing, and remembers where it came from", () => {
    const state = scanReducer(initialScanState, {
      type: "LookupFailed",
      code: "NOPE",
      source: "typed",
      message: "Nothing in the catalogue matches “NOPE”.",
    });

    expect(state.outcome).toEqual({
      kind: "NoMatch",
      code: "NOPE",
      source: "typed",
      message: "Nothing in the catalogue matches “NOPE”.",
    });
  });
});

describe("whether the camera keeps acting on what it reads", () => {
  it("keeps listening while nothing has been found", () => {
    expect(isListening(initialScanState)).toBe(true);
  });

  it("keeps listening after a code matched nothing, so the right label still works", () => {
    const state = scanReducer(initialScanState, {
      type: "LookupFailed",
      code: "NOPE",
      source: "typed",
      message: "Nothing matches.",
    });

    expect(isListening(state)).toBe(true);
  });

  it("keeps listening when the photographs held no code", () => {
    expect(isListening(scanReducer(withPhotos(photo(1)), { type: "NoCodeFound" }))).toBe(true);
  });

  it("stops once an item is on screen", () => {
    const found = scanReducer(initialScanState, { type: "ItemFound", item, source: "camera" });

    expect(isListening(found)).toBe(false);
    expect(isListening(scanReducer(found, { type: "StockReceived", item }))).toBe(false);
  });
});
