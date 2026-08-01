export type LocationStatus = "Active" | "Archived";
export type MapStatus = "Active" | "Archived";

export interface MapGeometryRectangle {
  readonly kind: "Rectangle";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export interface MapGeometryPolygon {
  readonly kind: "Polygon";
  readonly points: readonly { readonly x: number; readonly y: number }[];
}
export type MapGeometry = MapGeometryRectangle | MapGeometryPolygon;

export interface FloorPlanMetadata {
  readonly kind: "Blank" | "FloorPlan";
  readonly documentId?: string;
  readonly downloadPath?: string;
  readonly originalFileName?: string;
  readonly mediaType?: "image/png" | "image/jpeg";
  readonly pixelWidth?: number;
  readonly pixelHeight?: number;
}

export type MapStockStatus =
  "Available" | "LowStock" | "OutOfStock" | "Attention" | "Quarantined" | "Archived";

export interface MapStockItem {
  readonly name: string;
  readonly quantity: string;
}

export interface MapStatusSummary {
  readonly status: MapStockStatus;
  readonly colour: string;
  readonly text: string;
  readonly icon: string;
  readonly itemCount: number;
  readonly quantity: string;
  readonly items: readonly MapStockItem[];
}

/**
 * A location as the map holds it. `derivedParentId`, `depth` and `path` are
 * computed from the geometry by the server and are never sent back up: nesting
 * is changed by moving the shape, not by editing a field.
 */
export interface MapLocationView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly geometry: MapGeometry;
  readonly zOrder: number;
  readonly searchAliases: readonly string[];
  readonly status: LocationStatus;
  readonly derivedParentId: string | null;
  readonly depth: number;
  readonly path: string;
  readonly stock: MapStatusSummary;
}

export interface MapSummaryView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: MapStatus;
  readonly revision: number;
  readonly background: FloorPlanMetadata;
  readonly locationCount: number;
}

export interface MapView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: MapStatus;
  readonly revision: number;
  readonly background: FloorPlanMetadata;
  readonly locations: readonly MapLocationView[];
  readonly capabilities: readonly string[];
}

/** A location on its way to the server. No id means it was just drawn. */
export interface MapLocationInput {
  readonly id?: string;
  readonly code?: string;
  readonly name: string;
  readonly geometry: MapGeometry;
  readonly zOrder: number;
  readonly searchAliases?: readonly string[];
  readonly status?: LocationStatus;
}

export interface SaveMapRequest {
  readonly expectedRevision: number;
  readonly background?: FloorPlanMetadata;
  readonly locations: readonly MapLocationInput[];
}

export interface CreateMapRequest {
  readonly code: string;
  readonly name: string;
}

export interface UploadFloorPlanRequest {
  readonly expectedRevision: number;
  readonly locations: readonly MapLocationInput[];
  readonly originalFileName: string;
  readonly mediaType: "image/png" | "image/jpeg";
  readonly contentBase64: string;
}

export interface LocationSearchResult {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly path: string;
  readonly status: LocationStatus;
  readonly mapId: string | null;
  readonly matchedOn: "code" | "name" | "alias";
}

export interface OptimisticConcurrencyConflict {
  readonly expectedRevision: number;
  readonly actualRevision: number;
  readonly latestMapId: string;
}
