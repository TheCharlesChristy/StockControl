import type { MapGeometry } from "@stockcontrol/contracts";

import type { Point, RectangleGeometry } from "./geometry";

/**
 * Holds the geometry of whatever is being dragged, resized or drawn right now.
 *
 * This is the reason the editor stays smooth. Pointer moves publish here rather
 * than dispatching to the reducer, and only the one shape that is moving
 * subscribes to a non-null value — every other region reads a stable `null`, so
 * React bails out of re-rendering it. The committed geometry reaches the reducer
 * once, when the gesture ends.
 */

export type DrawPreview =
  | { readonly kind: "rectangle"; readonly geometry: RectangleGeometry }
  | {
      readonly kind: "polygon";
      readonly points: readonly Point[];
      readonly cursor: Point | null;
      readonly closeable: boolean;
    };

export interface LiveGeometryStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getRegionGeometry: (regionId: string) => MapGeometry | null;
  readonly getPreview: () => DrawPreview | null;
  readonly setRegionGeometry: (regionId: string, geometry: MapGeometry) => void;
  readonly setPreview: (preview: DrawPreview | null) => void;
  readonly clearRegion: () => void;
  readonly clear: () => void;
}

export function createLiveGeometryStore(): LiveGeometryStore {
  const listeners = new Set<() => void>();
  let activeRegionId: string | null = null;
  let activeGeometry: MapGeometry | null = null;
  let preview: DrawPreview | null = null;

  const emit = (): void => {
    for (const listener of listeners) listener();
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
    getRegionGeometry: (regionId) => (regionId === activeRegionId ? activeGeometry : null),
    getPreview: () => preview,
    setRegionGeometry: (regionId, geometry) => {
      activeRegionId = regionId;
      activeGeometry = geometry;
      emit();
    },
    setPreview: (next) => {
      preview = next;
      emit();
    },
    clearRegion: () => {
      if (activeRegionId === null && activeGeometry === null) return;
      activeRegionId = null;
      activeGeometry = null;
      emit();
    },
    clear: () => {
      if (activeRegionId === null && activeGeometry === null && preview === null) return;
      activeRegionId = null;
      activeGeometry = null;
      preview = null;
      emit();
    },
  };
}
