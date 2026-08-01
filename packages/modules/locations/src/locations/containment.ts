import { areaOf, geometryContains, type MapGeometry } from "./geometry.js";

/**
 * The implicit hierarchy. Nothing here is stored by a user: a location's parent
 * is whichever drawn shape it sits inside, so the tree the application reasons
 * about is always the tree the user can see on the map.
 */
export interface ContainmentPlacement {
  readonly id: string;
  readonly geometry: MapGeometry;
  readonly zOrder: number;
}

export interface ContainmentTreeInput extends ContainmentPlacement {
  readonly name: string;
}

export interface ContainmentTreeNode {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly depth: number;
  /** Ancestors then self, joined for display: `Main Store › Aisle 3 › Shelf B`. */
  readonly path: string;
  readonly childIds: readonly string[];
}

export const PATH_SEPARATOR = " › ";

/**
 * Shapes ranked smallest first, so a parent always ranks after its children and
 * the containment relation cannot close a loop. Equal areas are separated by
 * z-order — the shape drawn on top is the one that reads as being inside — and
 * finally by id so the result never depends on input order.
 */
const byContainmentRank = (left: ContainmentPlacement, right: ContainmentPlacement): number =>
  areaOf(left.geometry) - areaOf(right.geometry) ||
  right.zOrder - left.zOrder ||
  (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

/**
 * Maps each shape to the smallest shape that wholly contains it, or to null when
 * nothing does. Shapes that merely overlap are left as siblings.
 */
export const deriveContainment = (
  placements: readonly ContainmentPlacement[],
): ReadonlyMap<string, string | null> => {
  const ranked = [...placements].sort(byContainmentRank);
  const parents = new Map<string, string | null>();
  for (let index = 0; index < ranked.length; index += 1) {
    const child = ranked[index]!;
    let parentId: string | null = null;
    for (let candidate = index + 1; candidate < ranked.length; candidate += 1) {
      const outer = ranked[candidate]!;
      if (geometryContains(outer.geometry, child.geometry)) {
        parentId = outer.id;
        break;
      }
    }
    parents.set(child.id, parentId);
  }
  return parents;
};

/**
 * The derived tree in display order: roots first, each followed by its
 * descendants, siblings sorted by name.
 */
export const derivedTree = (
  placements: readonly ContainmentTreeInput[],
): readonly ContainmentTreeNode[] => {
  const parents = deriveContainment(placements);
  const byId = new Map(placements.map((placement) => [placement.id, placement]));
  const children = new Map<string | null, ContainmentTreeInput[]>();
  for (const placement of placements) {
    const parentId = parents.get(placement.id) ?? null;
    const siblings = children.get(parentId) ?? [];
    siblings.push(placement);
    children.set(parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort(
      (left, right) =>
        left.name.localeCompare(right.name, "en-GB") ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
  }
  const nodes: ContainmentTreeNode[] = [];
  const visit = (parentId: string | null, depth: number, prefix: readonly string[]): void => {
    for (const placement of children.get(parentId) ?? []) {
      const trail = [...prefix, placement.name];
      nodes.push({
        id: placement.id,
        name: placement.name,
        parentId,
        depth,
        path: trail.join(PATH_SEPARATOR),
        childIds: (children.get(placement.id) ?? []).map((child) => child.id),
      });
      visit(placement.id, depth + 1, trail);
    }
  };
  visit(null, 0, []);
  /* Anything unreachable would mean a cycle, which the ranking rules out. */
  if (nodes.length !== byId.size) {
    throw new Error("Derived containment did not cover every placement.");
  }
  return nodes;
};

/** Every id contained by `rootId`, directly or at any depth, including itself. */
export const descendantIds = (
  parents: ReadonlyMap<string, string | null>,
  rootId: string,
): ReadonlySet<string> => {
  const children = new Map<string, string[]>();
  for (const [id, parentId] of parents) {
    if (parentId === null) continue;
    const siblings = children.get(parentId) ?? [];
    siblings.push(id);
    children.set(parentId, siblings);
  }
  const found = new Set<string>([rootId]);
  const pending = [rootId];
  while (pending.length > 0) {
    for (const child of children.get(pending.pop()!) ?? []) {
      if (found.has(child)) continue;
      found.add(child);
      pending.push(child);
    }
  }
  return found;
};
