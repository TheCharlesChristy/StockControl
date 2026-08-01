import { PATH_SEPARATOR } from "@stockcontrol/module-locations";

export interface PathRow {
  readonly id: string;
  readonly name: string;
  readonly derived_parent_id: string | null;
}

export interface LocationPath {
  readonly path: string;
  readonly depth: number;
}

/**
 * Reads the breadcrumb for every location off the stored `derived_parent_id`
 * chain. That column is written from the geometry each time a map is saved, so
 * this never re-does the containment work — it just walks what the last save
 * decided. A location that is not drawn anywhere is simply its own name.
 */
export const locationPaths = (rows: readonly PathRow[]): ReadonlyMap<string, LocationPath> => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const resolved = new Map<string, LocationPath>();

  const resolve = (id: string): LocationPath => {
    const cached = resolved.get(id);
    if (cached !== undefined) return cached;
    const row = byId.get(id);
    if (row === undefined) return { path: "", depth: 0 };
    const trail: string[] = [];
    const seen = new Set<string>();
    let cursor: PathRow | undefined = row;
    while (cursor !== undefined && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      trail.unshift(cursor.name);
      cursor = cursor.derived_parent_id === null ? undefined : byId.get(cursor.derived_parent_id);
    }
    const value = { path: trail.join(PATH_SEPARATOR), depth: trail.length - 1 };
    resolved.set(id, value);
    return value;
  };

  for (const row of rows) resolve(row.id);
  return resolved;
};
