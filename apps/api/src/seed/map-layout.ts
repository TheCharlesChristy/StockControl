import type { MapGeometry } from "@stockcontrol/module-locations";

/**
 * Where the demo's stores sit on their maps. Nothing here states a hierarchy:
 * the aisles, racking and cage are simply drawn around the bays inside them,
 * and the application works out the nesting from these coordinates alone.
 */
export interface SeedMap {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface SeedPlacement {
  /** Matches a `seedLocations` code, or names a container drawn around them. */
  readonly code: string;
  readonly mapCode: string;
  readonly geometry: MapGeometry;
  readonly zOrder: number;
  readonly searchAliases?: readonly string[];
}

/** A container drawn on the map that exists only to group what is inside it. */
export interface SeedContainer {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

const rectangle = (x: number, y: number, width: number, height: number): MapGeometry => ({
  kind: "Rectangle",
  x,
  y,
  width,
  height,
});

export const seedMaps: readonly SeedMap[] = [
  { id: "00000000-0000-4000-8000-000000000010", code: "MAP-MAIN", name: "Main Store" },
  { id: "00000000-0000-4000-8000-000000000011", code: "MAP-BULK", name: "Bulk Store" },
];

export const seedContainers: readonly SeedContainer[] = [
  { id: "00000000-0000-4000-8000-000000000021", code: "AISLE-A", name: "Aisle A" },
  { id: "00000000-0000-4000-8000-000000000022", code: "AISLE-B", name: "Aisle B" },
  { id: "00000000-0000-4000-8000-000000000023", code: "AISLE-C", name: "Aisle C" },
  { id: "00000000-0000-4000-8000-000000000024", code: "RACKING", name: "Racking" },
  { id: "00000000-0000-4000-8000-000000000025", code: "CAGE", name: "Secure cage" },
  { id: "00000000-0000-4000-8000-000000000026", code: "WORKSHOP", name: "Workshop" },
];

export const seedPlacements: readonly SeedPlacement[] = [
  /* Main Store: three aisles, each drawn around its bays. */
  { code: "AISLE-A", mapCode: "MAP-MAIN", geometry: rectangle(0.05, 0.05, 0.42, 0.26), zOrder: 1 },
  { code: "MAIN-A1", mapCode: "MAP-MAIN", geometry: rectangle(0.07, 0.08, 0.12, 0.2), zOrder: 2 },
  { code: "MAIN-A2", mapCode: "MAP-MAIN", geometry: rectangle(0.21, 0.08, 0.12, 0.2), zOrder: 3 },
  { code: "MAIN-A3", mapCode: "MAP-MAIN", geometry: rectangle(0.35, 0.08, 0.1, 0.2), zOrder: 4 },
  { code: "AISLE-B", mapCode: "MAP-MAIN", geometry: rectangle(0.05, 0.35, 0.42, 0.26), zOrder: 5 },
  { code: "MAIN-B1", mapCode: "MAP-MAIN", geometry: rectangle(0.07, 0.38, 0.12, 0.2), zOrder: 6 },
  { code: "MAIN-B2", mapCode: "MAP-MAIN", geometry: rectangle(0.21, 0.38, 0.12, 0.2), zOrder: 7 },
  { code: "MAIN-B3", mapCode: "MAP-MAIN", geometry: rectangle(0.35, 0.38, 0.1, 0.2), zOrder: 8 },
  { code: "AISLE-C", mapCode: "MAP-MAIN", geometry: rectangle(0.05, 0.65, 0.42, 0.26), zOrder: 9 },
  { code: "MAIN-C1", mapCode: "MAP-MAIN", geometry: rectangle(0.07, 0.68, 0.12, 0.2), zOrder: 10 },
  { code: "MAIN-C2", mapCode: "MAP-MAIN", geometry: rectangle(0.21, 0.68, 0.12, 0.2), zOrder: 11 },
  {
    code: "GOODS-IN",
    mapCode: "MAP-MAIN",
    geometry: rectangle(0.55, 0.05, 0.4, 0.25),
    zOrder: 12,
    searchAliases: ["receiving", "goods inwards"],
  },
  {
    code: "SMALL-01",
    mapCode: "MAP-MAIN",
    geometry: rectangle(0.55, 0.35, 0.18, 0.15),
    zOrder: 13,
  },

  /* Bulk Store: racking, an angled cage, and the workshop. */
  { code: "RACKING", mapCode: "MAP-BULK", geometry: rectangle(0.05, 0.05, 0.5, 0.5), zOrder: 1 },
  { code: "BULK-01", mapCode: "MAP-BULK", geometry: rectangle(0.08, 0.08, 0.2, 0.2), zOrder: 2 },
  { code: "BULK-02", mapCode: "MAP-BULK", geometry: rectangle(0.31, 0.08, 0.2, 0.2), zOrder: 3 },
  { code: "BULK-03", mapCode: "MAP-BULK", geometry: rectangle(0.08, 0.31, 0.2, 0.2), zOrder: 4 },
  { code: "BULK-04", mapCode: "MAP-BULK", geometry: rectangle(0.31, 0.31, 0.2, 0.2), zOrder: 5 },
  {
    code: "CAGE",
    mapCode: "MAP-BULK",
    geometry: {
      kind: "Polygon",
      points: [
        { x: 0.62, y: 0.05 },
        { x: 0.94, y: 0.07 },
        { x: 0.92, y: 0.4 },
        { x: 0.64, y: 0.38 },
      ],
    },
    zOrder: 6,
    searchAliases: ["locked store"],
  },
  { code: "CAGE-01", mapCode: "MAP-BULK", geometry: rectangle(0.66, 0.09, 0.2, 0.12), zOrder: 7 },
  { code: "CAGE-02", mapCode: "MAP-BULK", geometry: rectangle(0.66, 0.23, 0.2, 0.12), zOrder: 8 },
  { code: "WORKSHOP", mapCode: "MAP-BULK", geometry: rectangle(0.05, 0.62, 0.6, 0.3), zOrder: 9 },
  { code: "WKSP-01", mapCode: "MAP-BULK", geometry: rectangle(0.08, 0.66, 0.25, 0.22), zOrder: 10 },
  { code: "WKSP-02", mapCode: "MAP-BULK", geometry: rectangle(0.36, 0.66, 0.25, 0.22), zOrder: 11 },
];
