/*
 * Taking the shot.
 *
 * The camera is already streaming into a `<video>` for the live decoder, so a
 * photograph is a frame drawn out of it rather than a second trip through the
 * operating system's camera app. That is what keeps the shutter inside
 * StockControl instead of handing the person to another screen and back.
 *
 * A frame is captured at the stream's own resolution and encoded a little
 * above the upload's own quality: this image is decoded twice — once here for
 * a barcode, once by the recognition pipeline — before anything downscales it.
 */

/** Injectable because jsdom has neither a video pipeline nor a canvas, and
 *  without a seam the shutter can only be tested by not testing it. */
export interface FrameGrabber {
  grab(video: HTMLVideoElement): Promise<File>;
}

export class FrameCaptureError extends Error {}

const SHOT_QUALITY = 0.92;

export const createFrameGrabber = (): FrameGrabber => ({
  grab: async (video: HTMLVideoElement): Promise<File> => {
    const width = video.videoWidth;
    const height = video.videoHeight;

    /* A stream that has not produced a frame yet reports zero, and drawing it
     * would silently yield a blank photograph rather than fail. */
    if (width === 0 || height === 0) {
      throw new FrameCaptureError("The camera is not ready yet. Try again in a moment.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");

    if (context === null) {
      throw new FrameCaptureError("This browser cannot take a photo.");
    }

    context.drawImage(video, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", SHOT_QUALITY);
    });

    if (blob === null) {
      throw new FrameCaptureError("That photo could not be taken. Try again.");
    }

    return new File([blob], "scan.jpg", { type: "image/jpeg" });
  },
});
