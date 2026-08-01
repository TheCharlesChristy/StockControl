import type {
  MapGeometry,
  MapLocationInput,
  MapLocationView,
  MapView,
} from "@stockcontrol/contracts";
import { deriveContainment, PATH_SEPARATOR } from "@stockcontrol/module-locations";

/**
 * The map editor's committed state. Everything here changes at most once per
 * gesture — in-flight drag geometry lives in `live-geometry-store` instead, so
 * moving a location does not re-render the page sixty times a second.
 *
 * Nesting is never stored in the draft. It is re-derived from the shapes after
 * every committed change with the same function the server uses on save, so the
 * breadcrumb the user reads while dragging is the one that will be persisted.
 */

export type EditorMode = "select" | "rectangle" | "polygon" | "pan";
export type LocationChanges = Partial<
  Omit<MapLocationView, "id" | "geometry" | "derivedParentId" | "depth" | "path">
>;

export interface EditorState {
  readonly persisted: MapView | null;
  readonly draft: MapView | null;
  readonly selectedLocationId: string | null;
  readonly mode: EditorMode;
  readonly snapEnabled: boolean;
  readonly dirty: boolean;
}

export type EditorAction =
  | { readonly type: "load"; readonly map: MapView }
  | { readonly type: "saved"; readonly map: MapView }
  | { readonly type: "select"; readonly id: string | null }
  | { readonly type: "mode"; readonly mode: EditorMode }
  | { readonly type: "toggle-snap" }
  | { readonly type: "revert" }
  | { readonly type: "add-location"; readonly geometry: MapGeometry; readonly name?: string }
  | { readonly type: "patch-location"; readonly id: string; readonly changes: LocationChanges }
  | { readonly type: "commit-geometry"; readonly id: string; readonly geometry: MapGeometry }
  | { readonly type: "remove-location"; readonly id: string }
  | {
      readonly type: "reorder-location";
      readonly id: string;
      readonly direction: "raise" | "lower";
    };

export const initialEditor: EditorState = {
  persisted: null,
  draft: null,
  selectedLocationId: null,
  mode: "select",
  snapEnabled: true,
  dirty: false,
};

const emptyStock: MapLocationView["stock"] = {
  status: "OutOfStock",
  colour: "#D32F2F",
  text: "Out of stock",
  icon: "remove-circle",
  itemCount: 0,
  quantity: "0",
  items: [],
};

/**
 * A newly drawn location gets a canonical UUID up front. The server accepts a
 * client-supplied id, so the shape keeps its identity across the save and the
 * selection survives the round trip.
 */
export const createLocationId = (): string => globalThis.crypto.randomUUID();

/** Paint order. The inspector's Raise and Lower had no effect without this. */
export const sortedByZOrder = (locations: readonly MapLocationView[]): readonly MapLocationView[] =>
  [...locations].sort((left, right) => left.zOrder - right.zOrder);

/**
 * A shape drawn but not yet saved has no code, and sends none: the server
 * derives one from the name. Sending an empty string instead would be a code
 * the domain cannot parse.
 */
export const toInputs = (map: MapView): readonly MapLocationInput[] =>
  map.locations.map((location) => ({
    id: location.id,
    ...(location.code === "" ? {} : { code: location.code }),
    name: location.name,
    geometry: location.geometry,
    zOrder: location.zOrder,
    searchAliases: location.searchAliases,
    status: location.status,
  }));

/**
 * Recomputes every location's parent, depth and breadcrumb from the geometry.
 * Archived shapes stay on the canvas but take no part in containment, so a
 * location inside one simply re-derives to whatever is left around it.
 */
export const withDerivedNesting = (
  locations: readonly MapLocationView[],
): readonly MapLocationView[] => {
  const parents = deriveContainment(
    locations
      .filter((location) => location.status === "Active")
      .map((location) => ({
        id: location.id,
        geometry: location.geometry,
        zOrder: location.zOrder,
      })),
  );
  const byId = new Map(locations.map((location) => [location.id, location]));
  const trailOf = (id: string): readonly string[] => {
    const trail: string[] = [];
    const seen = new Set<string>();
    let cursor: string | null = id;
    while (cursor !== null && !seen.has(cursor)) {
      seen.add(cursor);
      const location = byId.get(cursor);
      if (location === undefined) break;
      trail.unshift(location.name);
      cursor = parents.get(cursor) ?? null;
    }
    return trail;
  };
  return locations.map((location) => {
    const trail = trailOf(location.id);
    return {
      ...location,
      derivedParentId: parents.get(location.id) ?? null,
      depth: Math.max(trail.length - 1, 0),
      path: trail.join(PATH_SEPARATOR),
    };
  });
};

const withLocations = (state: EditorState, locations: readonly MapLocationView[]): EditorState =>
  state.draft === null
    ? state
    : {
        ...state,
        draft: { ...state.draft, locations: withDerivedNesting(locations) },
        dirty: true,
      };

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "load":
      return {
        ...state,
        persisted: action.map,
        draft: action.map,
        dirty: false,
        selectedLocationId: null,
      };
    case "saved":
      return { ...state, persisted: action.map, draft: action.map, dirty: false };
    case "select":
      return state.selectedLocationId === action.id
        ? state
        : { ...state, selectedLocationId: action.id };
    case "mode":
      return state.mode === action.mode ? state : { ...state, mode: action.mode };
    case "toggle-snap":
      return { ...state, snapEnabled: !state.snapEnabled };
    case "revert":
      return { ...state, draft: state.persisted, dirty: false, selectedLocationId: null };
    case "add-location": {
      if (state.draft === null) return state;
      const id = createLocationId();
      const orders = state.draft.locations.map((location) => Math.round(location.zOrder));
      const location: MapLocationView = {
        id,
        code: "",
        name: action.name ?? "New location",
        geometry: action.geometry,
        zOrder: orders.length === 0 ? 1 : Math.max(...orders) + 1,
        searchAliases: [],
        status: "Active",
        derivedParentId: null,
        depth: 0,
        path: action.name ?? "New location",
        stock: emptyStock,
      };
      return {
        ...withLocations(state, [...state.draft.locations, location]),
        selectedLocationId: id,
        mode: "select",
      };
    }
    case "patch-location": {
      if (state.draft === null) return state;
      return withLocations(
        state,
        state.draft.locations.map((location) =>
          location.id === action.id ? { ...location, ...action.changes } : location,
        ),
      );
    }
    case "commit-geometry":
      if (state.draft === null) return state;
      return withLocations(
        state,
        state.draft.locations.map((location) =>
          location.id === action.id ? { ...location, geometry: action.geometry } : location,
        ),
      );
    case "remove-location": {
      if (state.draft === null) return state;
      return {
        ...withLocations(
          state,
          state.draft.locations.filter((location) => location.id !== action.id),
        ),
        selectedLocationId:
          state.selectedLocationId === action.id ? null : state.selectedLocationId,
      };
    }
    case "reorder-location": {
      if (state.draft === null || state.draft.locations.length === 0) return state;
      const orders = state.draft.locations.map((location) => Math.round(location.zOrder));
      const zOrder =
        action.direction === "raise" ? Math.max(...orders) + 1 : Math.min(...orders) - 1;
      return withLocations(
        state,
        state.draft.locations.map((location) =>
          location.id === action.id ? { ...location, zOrder } : location,
        ),
      );
    }
    default:
      return state;
  }
}
