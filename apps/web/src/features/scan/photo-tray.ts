import { CAPTURE_MAX_PHOTOS, type LocalBarcodeObservation } from "@stockcontrol/contracts";

/*
 * A photograph somebody has attached to the scan sheet, before any decision
 * has been taken about what to do with it. It lives in the browser and nowhere
 * else: `file` is never persisted, and the bytes only leave the device if the
 * person explicitly asks for the photographs to be identified.
 */
export interface CapturedPhoto {
  readonly ordinal: number;
  readonly file: File;
  readonly previewUrl: string;
  /** What the camera or picker produced. The media type that is actually
   *  uploaded is decided by `normaliseImage`, which re-encodes every file. */
  readonly sourceType: string;
  /** Codes decoded here, on this device. Present or absent, nothing has been
   *  sent anywhere to produce them. */
  readonly localCodes: readonly LocalBarcodeObservation[];
}

/*
 * What a camera roll may offer is not the same list as what may be uploaded:
 * everything here is re-encoded to JPEG or WebP by `normaliseImage` before it
 * leaves the device, so the source format only has to be something the
 * browser can decode, and is never a `CaptureImageMediaType`.
 *
 * A phone is not obliged to tell the truth about a photograph it just took.
 * Android camera intents routinely hand back an empty `type`, and an iPhone
 * offering a library image from Files reports `image/heic`, which Safari can
 * decode perfectly well — an exact-match list rejected both, so the photograph
 * vanished with a message blaming its format. Anything the browser claims is
 * an image, or declines to describe at all, is handed to the decoder, and the
 * server checks magic bytes on what actually arrives regardless.
 */
export const isAcceptedSource = (type: string): boolean => type === "" || type.startsWith("image/");

/**
 * The lowest ordinals still free, which is not the same as counting up from
 * the highest in use. Retaking a photograph frees its number, and minting
 * `max + 1` instead walked ordinals past `CAPTURE_MAX_PHOTOS` — a limit the
 * server enforces, so five retakes were enough to make every upload be
 * refused as `ordinal_out_of_range` with one photograph on screen.
 */
export const nextOrdinals = (taken: readonly number[], count: number): readonly number[] => {
  const used = new Set(taken);
  const free: number[] = [];

  for (let ordinal = 1; ordinal <= CAPTURE_MAX_PHOTOS && free.length < count; ordinal += 1) {
    if (!used.has(ordinal)) free.push(ordinal);
  }

  return free;
};

export const revokePreviews = (photos: readonly CapturedPhoto[]): void => {
  for (const photo of photos) URL.revokeObjectURL(photo.previewUrl);
};

/** The first code any of these photographs gave up, which is what a lookup
 *  should be run against. */
export const firstLocalCode = (
  photos: readonly CapturedPhoto[],
): LocalBarcodeObservation | undefined => photos.flatMap((photo) => photo.localCodes)[0];
