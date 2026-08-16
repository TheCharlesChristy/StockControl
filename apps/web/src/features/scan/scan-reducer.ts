import type { ItemDetailView } from "@stockcontrol/contracts";

import type { CapturedPhoto } from "./photo-tray";

/*
 * The scan sheet is one surface with three ways in — the live camera, a typed
 * or wanded code, and a photograph — and they all end in the same place: an
 * item, or an honest statement that nothing matched.
 *
 * Explicit outcomes rather than loading flags, for the reason the capture
 * reducer gives: "what is on screen" and "what the server said" cannot drift
 * apart when only one of them exists.
 *
 * Nothing in this state ever leaves the device. Photographs are decoded here;
 * sending them anywhere is a separate, deliberate act handled by the sheet.
 */

/** How the code that produced an outcome reached us. Worth keeping because it
 *  decides what the screen says next: a typed code that matched nothing is a
 *  typo, the same from a photograph is an unlabelled item. */
export type ScanSource = "camera" | "typed" | "photo";

export type ScanOutcome =
  | { readonly kind: "Nothing" }
  | { readonly kind: "Looking"; readonly code: string }
  | { readonly kind: "Found"; readonly item: ItemDetailView; readonly source: ScanSource }
  | {
      readonly kind: "NoMatch";
      readonly code: string;
      readonly source: ScanSource;
      readonly message: string;
    }
  /** Photographs were attached and this device found no code in any of them. */
  | { readonly kind: "NoCode" }
  | { readonly kind: "Received"; readonly item: ItemDetailView };

export interface ScanState {
  readonly outcome: ScanOutcome;
  readonly photos: readonly CapturedPhoto[];
  /** A local decode is running. The send and lookup actions wait for it so a
   *  code in the last photograph is never missed by a fraction of a second. */
  readonly decoding: boolean;
  /** Why some chosen files were left out. Not an error — the rest were kept. */
  readonly notice: string | null;
}

export const initialScanState: ScanState = {
  outcome: { kind: "Nothing" },
  photos: [],
  decoding: false,
  notice: null,
};

export type ScanAction =
  | { readonly type: "FilesRejected"; readonly notice: string }
  | { readonly type: "DecodeStarted" }
  | { readonly type: "PhotosAdded"; readonly photos: readonly CapturedPhoto[] }
  | { readonly type: "DecodeFinished" }
  | { readonly type: "NoCodeFound" }
  | { readonly type: "PhotoRemoved"; readonly ordinal: number }
  | { readonly type: "LookupStarted"; readonly code: string }
  | {
      readonly type: "ItemFound";
      readonly item: ItemDetailView;
      readonly source: ScanSource;
    }
  | {
      readonly type: "LookupFailed";
      readonly code: string;
      readonly source: ScanSource;
      readonly message: string;
    }
  | { readonly type: "StockReceived"; readonly item: ItemDetailView }
  | { readonly type: "StartOver" };

export function scanReducer(state: ScanState, action: ScanAction): ScanState {
  switch (action.type) {
    case "FilesRejected":
      return { ...state, notice: action.notice };

    case "DecodeStarted":
      return { ...state, decoding: true, notice: null };

    case "PhotosAdded":
      return { ...state, photos: [...state.photos, ...action.photos] };

    case "DecodeFinished":
      return { ...state, decoding: false };

    case "NoCodeFound":
      /* Only ever a statement about the photographs. A code already resolved
       * from the camera or the keyboard outranks a silent photograph. */
      return state.outcome.kind === "Nothing" ? { ...state, outcome: { kind: "NoCode" } } : state;

    case "PhotoRemoved": {
      const photos = state.photos.filter((photo) => photo.ordinal !== action.ordinal);

      return {
        ...state,
        photos,
        /* "No code in your photographs" is a lie once there are none left. */
        outcome:
          state.outcome.kind === "NoCode" && photos.length === 0
            ? { kind: "Nothing" }
            : state.outcome,
      };
    }

    case "LookupStarted":
      return { ...state, outcome: { kind: "Looking", code: action.code } };

    case "ItemFound":
      return { ...state, outcome: { kind: "Found", item: action.item, source: action.source } };

    case "LookupFailed":
      return {
        ...state,
        outcome: {
          kind: "NoMatch",
          code: action.code,
          source: action.source,
          message: action.message,
        },
      };

    case "StockReceived":
      return { ...state, outcome: { kind: "Received", item: action.item } };

    case "StartOver":
      /* Previews belong to whoever created them; the sheet revokes them before
       * dispatching this, because a reducer must not touch the outside world. */
      return initialScanState;

    default:
      return state;
  }
}

/**
 * Whether the live camera should still act on what it reads. Once an item is
 * on screen — found, or received into stock — a second decode of the same
 * label would throw away the screen the person is reading. A code that matched
 * nothing does not stop the camera: pointing it at the right label is the
 * obvious next thing to do.
 */
export const isListening = (state: ScanState): boolean =>
  state.outcome.kind === "Nothing" ||
  state.outcome.kind === "NoCode" ||
  state.outcome.kind === "NoMatch";
