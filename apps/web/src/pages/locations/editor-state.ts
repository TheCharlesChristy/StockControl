import type {
  HierarchyNodeView,
  MapGeometry,
  MapRegionInput,
  MapRegionView,
  MapSnapshot,
} from "@stockcontrol/contracts";

/**
 * The map editor's committed state. Everything here changes at most once per
 * gesture — in-flight drag geometry lives in `live-geometry-store` instead, so
 * moving a region does not re-render the page sixty times a second.
 */

export type EditorMode = "select" | "rectangle" | "polygon" | "pan";
export type RegionChanges = Partial<Omit<MapRegionView, "id" | "geometry">>;

export interface EditorState {
  readonly persisted: MapSnapshot | null;
  readonly draft: MapSnapshot | null;
  readonly selectedRegionId: string | null;
  readonly mode: EditorMode;
  readonly snapEnabled: boolean;
  readonly dirty: boolean;
}

export type EditorAction =
  | { readonly type: "load"; readonly map: MapSnapshot }
  | { readonly type: "saved"; readonly map: MapSnapshot }
  | { readonly type: "select"; readonly id: string | null }
  | { readonly type: "mode"; readonly mode: EditorMode }
  | { readonly type: "toggle-snap" }
  | { readonly type: "revert" }
  | { readonly type: "add-region"; readonly geometry: MapGeometry }
  | { readonly type: "patch-region"; readonly id: string; readonly changes: RegionChanges }
  | { readonly type: "commit-geometry"; readonly id: string; readonly geometry: MapGeometry }
  | { readonly type: "remove-region"; readonly id: string }
  | {
      readonly type: "reorder-region";
      readonly id: string;
      readonly direction: "raise" | "lower";
    };

export const initialEditor: EditorState = {
  persisted: null,
  draft: null,
  selectedRegionId: null,
  mode: "select",
  snapEnabled: true,
  dirty: false,
};

const newRegionStock: MapRegionView["stock"] = {
  status: "OutOfStock",
  colour: "#D32F2F",
  text: "Out of stock",
  icon: "remove-circle",
  itemCount: 0,
  quantity: "0",
};

/**
 * New regions get a canonical UUID up front rather than a `draft-` placeholder.
 * The server accepts a client-supplied region id (`createMapRegionId`), so a
 * region keeps its identity across the save and — unlike the placeholder — can
 * be referenced as another region's visual parent in the same payload.
 */
export const createRegionId = (): string => globalThis.crypto.randomUUID();

export const flattenHierarchy = (
  nodes: readonly HierarchyNodeView[],
): readonly HierarchyNodeView[] =>
  nodes.flatMap((node) => [node, ...flattenHierarchy(node.children)]);

/** Paint order. The inspector's Raise and Lower had no effect without this. */
export const sortedByZOrder = (regions: readonly MapRegionView[]): readonly MapRegionView[] =>
  [...regions].sort((left, right) => left.zOrder - right.zOrder);

export const toInputs = (map: MapSnapshot): readonly MapRegionInput[] =>
  map.regions.map((region) => ({
    id: region.id,
    displayName: region.displayName,
    hierarchyNodeId: region.hierarchyNodeId,
    parentRegionId: region.parentRegionId,
    geometry: region.geometry,
    zOrder: region.zOrder,
    searchAliases: region.searchAliases,
    status: region.status,
  }));

const descendantsOf = (regions: readonly MapRegionView[], id: string): ReadonlySet<string> => {
  const found = new Set<string>();
  let added = true;
  while (added) {
    added = false;
    for (const region of regions) {
      if (region.parentRegionId === null || found.has(region.id)) continue;
      if (region.parentRegionId === id || found.has(region.parentRegionId)) {
        found.add(region.id);
        added = true;
      }
    }
  }
  return found;
};

const withRegions = (state: EditorState, regions: readonly MapRegionView[]): EditorState =>
  state.draft === null ? state : { ...state, draft: { ...state.draft, regions }, dirty: true };

/**
 * The server rejects an active region under an archived parent, and an archived
 * region whose children are still active, so archiving cascades downwards and
 * restoring detaches from a still-archived parent.
 */
const applyStatus = (
  regions: readonly MapRegionView[],
  id: string,
  status: MapRegionView["status"],
): readonly MapRegionView[] => {
  if (status === "Archived") {
    const affected = descendantsOf(regions, id);
    return regions.map((region) =>
      region.id === id || affected.has(region.id) ? { ...region, status } : region,
    );
  }
  const archived = new Set(
    regions.filter((region) => region.status === "Archived").map((region) => region.id),
  );
  return regions.map((region) =>
    region.id === id
      ? {
          ...region,
          status,
          parentRegionId:
            region.parentRegionId !== null && archived.has(region.parentRegionId)
              ? null
              : region.parentRegionId,
        }
      : region,
  );
};

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "load":
      return {
        ...state,
        persisted: action.map,
        draft: action.map,
        dirty: false,
        selectedRegionId: null,
      };
    case "saved":
      return { ...state, persisted: action.map, draft: action.map, dirty: false };
    case "select":
      return state.selectedRegionId === action.id
        ? state
        : { ...state, selectedRegionId: action.id };
    case "mode":
      return state.mode === action.mode ? state : { ...state, mode: action.mode };
    case "toggle-snap":
      return { ...state, snapEnabled: !state.snapEnabled };
    case "revert":
      return { ...state, draft: state.persisted, dirty: false, selectedRegionId: null };
    case "add-region": {
      if (state.draft === null) return state;
      const id = createRegionId();
      const orders = state.draft.regions.map((region) => Math.round(region.zOrder));
      const region: MapRegionView = {
        id,
        displayName: "New region",
        hierarchyNodeId: state.draft.buildingId,
        parentRegionId: null,
        geometry: action.geometry,
        zOrder: orders.length === 0 ? 1 : Math.max(...orders) + 1,
        searchAliases: [],
        status: "Active",
        stock: newRegionStock,
      };
      return {
        ...withRegions(state, [...state.draft.regions, region]),
        selectedRegionId: id,
        mode: "select",
      };
    }
    case "patch-region": {
      if (state.draft === null) return state;
      const { status, ...rest } = action.changes;
      const staged =
        status === undefined
          ? state.draft.regions
          : applyStatus(state.draft.regions, action.id, status);
      return withRegions(
        state,
        staged.map((region) => (region.id === action.id ? { ...region, ...rest } : region)),
      );
    }
    case "commit-geometry":
      if (state.draft === null) return state;
      return withRegions(
        state,
        state.draft.regions.map((region) =>
          region.id === action.id ? { ...region, geometry: action.geometry } : region,
        ),
      );
    case "remove-region": {
      if (state.draft === null) return state;
      /* Children must lose the link or the server refuses the save as an orphan. */
      const regions = state.draft.regions
        .filter((region) => region.id !== action.id)
        .map((region) =>
          region.parentRegionId === action.id ? { ...region, parentRegionId: null } : region,
        );
      return {
        ...withRegions(state, regions),
        selectedRegionId: state.selectedRegionId === action.id ? null : state.selectedRegionId,
      };
    }
    case "reorder-region": {
      if (state.draft === null || state.draft.regions.length === 0) return state;
      const orders = state.draft.regions.map((region) => Math.round(region.zOrder));
      const zOrder =
        action.direction === "raise" ? Math.max(...orders) + 1 : Math.min(...orders) - 1;
      return withRegions(
        state,
        state.draft.regions.map((region) =>
          region.id === action.id ? { ...region, zOrder } : region,
        ),
      );
    }
    default:
      return state;
  }
}
