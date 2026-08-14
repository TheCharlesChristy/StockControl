import { CAPTURE_MAX_PHOTOS } from "@stockcontrol/contracts";
import { describe, expect, it } from "vitest";

import { nextOrdinals } from "./CapturePhotos";

describe("nextOrdinals", () => {
  it("numbers the first photographs from one", () => {
    expect(nextOrdinals([], 3)).toEqual([1, 2, 3]);
  });

  it("continues after the ones already taken", () => {
    expect(nextOrdinals([1, 2], 2)).toEqual([3, 4]);
  });

  /*
   * The bug this covers: ordinals used to be minted as `max + 1`, so a
   * retaken photograph left its number behind and the next one climbed past
   * it. The server refuses an ordinal above CAPTURE_MAX_PHOTOS
   * (`ordinal_out_of_range`), so on a phone — where retaking a photograph is
   * the normal thing to do, not an edge case — five retakes were enough to
   * make every upload be refused with a single photograph on screen.
   */
  it("reuses the number a removed photograph gave up", () => {
    expect(nextOrdinals([2, 3], 1)).toEqual([1]);
  });

  it("never goes past the limit the server enforces", () => {
    const ordinals = nextOrdinals([], CAPTURE_MAX_PHOTOS + 3);

    expect(ordinals).toHaveLength(CAPTURE_MAX_PHOTOS);
    expect(Math.max(...ordinals)).toBeLessThanOrEqual(CAPTURE_MAX_PHOTOS);
  });

  it("offers nothing when every number is spoken for", () => {
    const full = Array.from({ length: CAPTURE_MAX_PHOTOS }, (_unused, index) => index + 1);

    expect(nextOrdinals(full, 1)).toEqual([]);
  });

  it("fills the gaps a scattered set leaves, in order", () => {
    expect(nextOrdinals([2, 5], 3)).toEqual([1, 3, 4]);
  });
});
