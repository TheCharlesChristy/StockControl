import { revokePreviews, type CapturedPhoto } from "../scan/photo-tray";

/*
 * How photographs cross from the scan sheet, which can be opened from any
 * screen, to the capture page that owns the recognition queue.
 *
 * Not router state: `File` handles survive a structured clone, so history
 * state would accept them, and would then keep image bytes alive in session
 * history across reloads and back-navigation — exactly what section 16 says
 * this feature must not do. A module-level slot is emptied by the first reader
 * and holds nothing afterwards.
 *
 * Nothing here is authority: the page still opens a batch, starts a session
 * and uploads through the ordinary routes, each of which the server authorises
 * on its own.
 */

let offered: readonly CapturedPhoto[] | null = null;

/** Replaces anything already waiting; an abandoned offer is not worth keeping
 *  and its previews would otherwise leak. */
export const offerPhotosToCapture = (photos: readonly CapturedPhoto[]): void => {
  discardOfferedPhotos();
  offered = photos;
};

export const takeOfferedPhotos = (): readonly CapturedPhoto[] | null => {
  const photos = offered;
  offered = null;
  return photos;
};

export const discardOfferedPhotos = (): void => {
  if (offered === null) return;
  revokePreviews(offered);
  offered = null;
};
