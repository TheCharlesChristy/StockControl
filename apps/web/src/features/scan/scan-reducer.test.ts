import { describe, expect, it } from "vitest";

import type { CapturedPhoto } from "./photo-tray";
import { initialScanState, isListening, scanReducer, type ScanState } from "./scan-reducer";

const photo = (ordinal: number): CapturedPhoto => ({
  ordinal,
  file: new File(["x"], `photo-${String(ordinal)}.jpg`, { type: "image/jpeg" }),
  previewUrl: `blob:photo-${String(ordinal)}`,
  sourceType: "image/jpeg",
  localCodes: [],
});

const code = (ordinal: number, value: string): CapturedPhoto["localCodes"][number] => ({
  value,
  symbology: "EAN-13",
  imageOrdinal: ordinal,
  readerVersion: "test",
});

const afterShots = (...photos: readonly CapturedPhoto[]): ScanState =>
  scanReducer(initialScanState, { type: "ShotsTaken", photos });

describe("taking a shot", () => {
  /*
   * The picture must freeze the instant the shutter is pressed. Waiting for
   * the decoder would leave a live camera running under a photo already taken.
   */
  it("holds the shot and starts reading it before any code is known", () => {
    const state = afterShots(photo(1));

    expect(state.stage).toEqual({ kind: "Reading" });
    expect(state.photos).toHaveLength(1);
    expect(state.photos[0]?.localCodes).toEqual([]);
  });

  it("attaches what the device read to the shot it came from", () => {
    const state = scanReducer(afterShots(photo(1), photo(2)), {
      type: "CodesRead",
      codes: [{ ordinal: 2, localCodes: [code(2, "5012345678900")] }],
    });

    expect(state.photos[0]?.localCodes).toEqual([]);
    expect(state.photos[1]?.localCodes).toEqual([code(2, "5012345678900")]);
  });

  it("says so when the device found no code in the shot", () => {
    const state = scanReducer(afterShots(photo(1)), { type: "NoCodeFound" });

    expect(state.stage).toEqual({ kind: "Unidentified", code: null, source: "photo" });
  });

  /*
   * The live camera can resolve a label while a photo is still decoding. By
   * then the sheet has left for the item's page, and this must not reopen a
   * dead end behind it.
   */
  it("does not report a silent photo once something else has moved on", () => {
    const looking = scanReducer(afterShots(photo(1)), {
      type: "LookupStarted",
      code: "5012345678900",
    });

    expect(scanReducer(looking, { type: "NoCodeFound" })).toBe(looking);
  });
});

describe("when nothing could be identified", () => {
  it("names the code that matched nothing, and where it came from", () => {
    const state = scanReducer(initialScanState, {
      type: "LookupFailed",
      code: "NOPE",
      source: "typed",
    });

    expect(state.stage).toEqual({ kind: "Unidentified", code: "NOPE", source: "typed" });
  });

  /* Another angle is the one thing that reliably improves a recognition
   * result, so going back to the camera must not throw the first shot away. */
  it("keeps the shots when the person goes back for another angle", () => {
    const unidentified = scanReducer(afterShots(photo(1)), { type: "NoCodeFound" });
    const state = scanReducer(unidentified, { type: "Reframed", keepPhotos: true });

    expect(state.stage).toEqual({ kind: "Framing" });
    expect(state.photos).toHaveLength(1);
  });

  it("throws them away when the person starts again", () => {
    const unidentified = scanReducer(afterShots(photo(1)), { type: "NoCodeFound" });
    const state = scanReducer(unidentified, { type: "Reframed", keepPhotos: false });

    expect(state.stage).toEqual({ kind: "Framing" });
    expect(state.photos).toHaveLength(0);
  });

  it("returns to the camera once the last shot is discarded", () => {
    const unidentified = scanReducer(afterShots(photo(1)), { type: "NoCodeFound" });
    const state = scanReducer(unidentified, { type: "PhotoDiscarded", ordinal: 1 });

    expect(state.photos).toHaveLength(0);
    expect(state.stage).toEqual({ kind: "Framing" });
  });

  it("stays on the question while other shots remain", () => {
    const unidentified = scanReducer(afterShots(photo(1), photo(2)), { type: "NoCodeFound" });
    const state = scanReducer(unidentified, { type: "PhotoDiscarded", ordinal: 1 });

    expect(state.photos.map((entry) => entry.ordinal)).toEqual([2]);
    expect(state.stage.kind).toBe("Unidentified");
  });

  it("clears everything when the sheet closes", () => {
    const busy = scanReducer(afterShots(photo(1)), { type: "NoCodeFound" });

    expect(scanReducer(busy, { type: "StartOver" })).toEqual(initialScanState);
  });
});

describe("whether the camera keeps acting on what it reads", () => {
  it("listens while framing", () => {
    expect(isListening(initialScanState)).toBe(true);
    expect(
      isListening(scanReducer(afterShots(photo(1)), { type: "Reframed", keepPhotos: true })),
    ).toBe(true);
  });

  /* A shot already taken has frozen the picture the person is looking at, and
   * a decode landing behind it would navigate out from under them. */
  it("stops the moment a shot is taken, and stays stopped until it is resolved", () => {
    const reading = afterShots(photo(1));

    expect(isListening(reading)).toBe(false);
    expect(isListening(scanReducer(reading, { type: "NoCodeFound" }))).toBe(false);
    expect(
      isListening(scanReducer(reading, { type: "LookupStarted", code: "5012345678900" })),
    ).toBe(false);
  });
});
