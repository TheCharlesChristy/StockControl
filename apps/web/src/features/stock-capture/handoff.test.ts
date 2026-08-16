import { afterEach, describe, expect, it, vi } from "vitest";

import type { CapturedPhoto } from "../scan/photo-tray";
import { discardOfferedPhotos, offerPhotosToCapture, takeOfferedPhotos } from "./handoff";

const photo = (ordinal: number): CapturedPhoto => ({
  ordinal,
  file: new File(["x"], `photo-${String(ordinal)}.jpg`, { type: "image/jpeg" }),
  previewUrl: `blob:photo-${String(ordinal)}`,
  sourceType: "image/jpeg",
  localCodes: [],
});

describe("handing photographs to the capture page", () => {
  afterEach(() => {
    discardOfferedPhotos();
    vi.restoreAllMocks();
  });

  it("gives the photographs to the first reader", () => {
    const photos = [photo(1), photo(2)];
    offerPhotosToCapture(photos);

    expect(takeOfferedPhotos()).toEqual(photos);
  });

  /*
   * The page mounts, reads the offer, and may re-run its startup effect. A
   * second read must not queue the same photographs as a second item.
   */
  it("holds nothing once they have been taken", () => {
    offerPhotosToCapture([photo(1)]);
    takeOfferedPhotos();

    expect(takeOfferedPhotos()).toBeNull();
  });

  it("releases the previews of an offer nobody collected", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    offerPhotosToCapture([photo(1)]);

    offerPhotosToCapture([photo(2)]);

    expect(revoke).toHaveBeenCalledWith("blob:photo-1");
    expect(takeOfferedPhotos()?.map((entry) => entry.ordinal)).toEqual([2]);
  });
});
