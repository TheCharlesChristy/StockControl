export const hierarchyNodeKinds = [
  "Branch",
  "Building",
  "Area",
  "Aisle",
  "Shelf",
  "Bin",
  "CustomSection",
] as const;
export type HierarchyNodeKind = (typeof hierarchyNodeKinds)[number];
export const locationOperationalKinds = [
  "Container",
  "Storage",
  "Quarantine",
  "Repair",
  "Transit",
  "VirtualJobSite",
] as const;
export type LocationOperationalKind = (typeof locationOperationalKinds)[number];
export type LocationStatus = "Active" | "Archived";

export interface HierarchyNodeView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nodeKind: HierarchyNodeKind;
  readonly operationalKind: LocationOperationalKind;
  readonly parentId: string | null;
  readonly branchId: string;
  readonly buildingId: string | null;
  readonly status: LocationStatus;
  readonly generalFulfilmentEnabled: boolean;
  readonly children: readonly HierarchyNodeView[];
}

export interface HierarchyTreeResponse {
  readonly root: HierarchyNodeView;
  readonly buildings: readonly HierarchyNodeView[];
  readonly capabilities: readonly string[];
}

export interface CreateHierarchyNodeRequest {
  readonly code: string;
  readonly name: string;
  readonly nodeKind: Exclude<HierarchyNodeKind, "Branch">;
  readonly operationalKind: Exclude<LocationOperationalKind, "VirtualJobSite">;
  readonly parentId: string;
  readonly generalFulfilmentEnabled?: boolean;
}

export interface RenameLocationRequest {
  readonly name: string;
}
export interface MoveLocationRequest {
  readonly parentId: string;
}
export interface ArchiveLocationRequest {
  readonly reason?: string;
}

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

export type MapRegionStatus = "Active" | "Archived";
export type MapStatus = "Active" | "Archived";
export type MapStockStatus =
  "Available" | "LowStock" | "OutOfStock" | "Attention" | "Quarantined" | "Archived";

export interface MapStatusSummary {
  readonly status: MapStockStatus;
  readonly colour: string;
  readonly text: string;
  readonly icon: string;
  readonly itemCount: number;
  readonly quantity: string;
}

export interface MapRegionView {
  readonly id: string;
  readonly displayName: string;
  readonly hierarchyNodeId: string;
  readonly parentRegionId: string | null;
  readonly geometry: MapGeometry;
  readonly zOrder: number;
  readonly searchAliases: readonly string[];
  readonly status: MapRegionStatus;
  readonly stock: MapStatusSummary;
}

export interface MapSummaryView {
  readonly id: string;
  readonly buildingId: string;
  readonly buildingCode: string;
  readonly buildingName: string;
  readonly status: MapStatus;
  readonly revision: number;
  readonly background: FloorPlanMetadata;
  readonly regionCount: number;
}

export interface MapSnapshot {
  readonly id: string;
  readonly buildingId: string;
  readonly building: HierarchyNodeView;
  readonly status: MapStatus;
  readonly revision: number;
  readonly background: FloorPlanMetadata;
  readonly hierarchy: readonly HierarchyNodeView[];
  readonly regions: readonly MapRegionView[];
  readonly capabilities: readonly string[];
}

export interface MapRegionInput {
  readonly id?: string;
  readonly displayName: string;
  readonly hierarchyNodeId: string;
  readonly parentRegionId?: string | null;
  readonly geometry: MapGeometry;
  readonly zOrder: number;
  readonly searchAliases?: readonly string[];
  readonly status?: MapRegionStatus;
}

export interface SaveMapRequest {
  readonly expectedRevision: number;
  readonly background?: FloorPlanMetadata;
  readonly regions: readonly MapRegionInput[];
}

export interface UploadFloorPlanRequest {
  readonly expectedRevision: number;
  readonly regions: readonly MapRegionInput[];
  readonly originalFileName: string;
  readonly mediaType: "image/png" | "image/jpeg";
  readonly contentBase64: string;
}

export interface LocationSearchResult {
  readonly location: HierarchyNodeView;
  readonly regionId: string | null;
  readonly mapId: string | null;
  readonly matchedOn: "code" | "name" | "region" | "alias";
}

export interface OptimisticConcurrencyConflict {
  readonly expectedRevision: number;
  readonly actualRevision: number;
  readonly latestMapId: string;
}
