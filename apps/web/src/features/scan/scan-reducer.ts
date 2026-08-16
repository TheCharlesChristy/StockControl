import type { LocalBarcodeObservation } from "@stockcontrol/contracts";

import type { CapturedPhoto } from "./photo-tray";

/*
 * One scan, as a sequence rather than a form.
 *
 * The sheet is a camera. You point it, it reads what it sees, and the only
 * thing it ever says is "here is the item" — by leaving for the item's page —
 * or "I could not tell what that is". Everything else the surface can do
 * (typing a code, choosing an existing photograph) arrives at one of those two
 * answers as well, so there is one state machine and not three.
 *
 * A match is not a stage here. There is nothing to decide once an item is
 * known, so the sheet navigates and closes rather than holding a screen open
 * to be dismissed.
 *
 * Nothing in this state leaves the device. Photographs are taken and decoded
 * here; sending them is a separate, deliberate act the sheet handles.
 */

/** How the thing being looked up reached us. It decides what the failure says:
 *  a typed code that matched nothing is a typo, the same from a photograph is
 *  an item nobody has catalogued. */
export type ScanSource = "camera" | "typed" | "photo";

export type ScanStage =
  /** The camera is live and the shutter is armed. */
  | { readonly kind: "Framing" }
  /** A shot has been taken and is being read on this device. */
  | { readonly kind: "Reading" }
  /** A code came out of it, and the catalogue is being asked about it. */
  | { readonly kind: "Looking"; readonly code: string }
  /** The end of the road for automatic identification. `code` is null when
   *  nothing readable was in the photograph at all. */
  | {
      readonly kind: "Unidentified";
      readonly code: string | null;
      readonly source: ScanSource;
    };

export interface ScanState {
  readonly stage: ScanStage;
  /** Shots taken so far, kept for the recognition pipeline if the person asks
   *  for one. Never more than `CAPTURE_MAX_PHOTOS`. */
  readonly photos: readonly CapturedPhoto[];
  /** Why some chosen files were left out. Not an error — the rest were kept. */
  readonly notice: string | null;
}

export const initialScanState: ScanState = {
  stage: { kind: "Framing" },
  photos: [],
  notice: null,
};

export type ScanAction =
  | { readonly type: "FilesRejected"; readonly notice: string }
  | { readonly type: "ShotsTaken"; readonly photos: readonly CapturedPhoto[] }
  /**
   * What the device made of those shots, arriving after them. The picture
   * freezes the instant the shutter is pressed; waiting for the decoder before
   * showing it would leave a live camera running under a photograph that had
   * already been taken.
   */
  | {
      readonly type: "CodesRead";
      readonly codes: readonly {
        readonly ordinal: number;
        readonly localCodes: readonly LocalBarcodeObservation[];
      }[];
    }
  | { readonly type: "NoCodeFound" }
  | { readonly type: "LookupStarted"; readonly code: string }
  | { readonly type: "LookupFailed"; readonly code: string; readonly source: ScanSource }
  | { readonly type: "PhotoDiscarded"; readonly ordinal: number }
  /** Back to the camera. `keepPhotos` separates "another angle of the same
   *  thing" from "that shot was no good". */
  | { readonly type: "Reframed"; readonly keepPhotos: boolean }
  | { readonly type: "StartOver" };

export function scanReducer(state: ScanState, action: ScanAction): ScanState {
  switch (action.type) {
    case "FilesRejected":
      return { ...state, notice: action.notice };

    case "ShotsTaken":
      return {
        stage: { kind: "Reading" },
        photos: [...state.photos, ...action.photos],
        notice: null,
      };

    case "CodesRead": {
      const byOrdinal = new Map(action.codes.map((entry) => [entry.ordinal, entry.localCodes]));

      return {
        ...state,
        photos: state.photos.map((photo) => {
          const localCodes = byOrdinal.get(photo.ordinal);
          return localCodes === undefined ? photo : { ...photo, localCodes };
        }),
      };
    }

    case "NoCodeFound":
      /*
       * Only ever a statement about a shot being read. The live camera can
       * resolve a label while a photograph is still decoding, and that answer
       * outranks this one — by then the sheet has already navigated away.
       */
      return state.stage.kind === "Reading"
        ? { ...state, stage: { kind: "Unidentified", code: null, source: "photo" } }
        : state;

    case "LookupStarted":
      return { ...state, stage: { kind: "Looking", code: action.code } };

    case "LookupFailed":
      return {
        ...state,
        stage: { kind: "Unidentified", code: action.code, source: action.source },
      };

    case "PhotoDiscarded": {
      const photos = state.photos.filter((photo) => photo.ordinal !== action.ordinal);

      /* Nothing left to offer the pipeline is nothing left to decide about. */
      return photos.length === 0
        ? { ...state, photos, stage: { kind: "Framing" } }
        : { ...state, photos };
    }

    case "Reframed":
      return {
        stage: { kind: "Framing" },
        photos: action.keepPhotos ? state.photos : [],
        notice: null,
      };

    case "StartOver":
      /* Previews belong to whoever created them; the sheet revokes them before
       * dispatching this, because a reducer must not touch the outside world. */
      return initialScanState;

    default:
      return state;
  }
}

/**
 * Whether the live camera should act on what it reads. Only while framing: a
 * shot already taken has frozen the picture the person is looking at, and a
 * decode landing behind that would navigate out from under them.
 */
export const isListening = (state: ScanState): boolean => state.stage.kind === "Framing";
