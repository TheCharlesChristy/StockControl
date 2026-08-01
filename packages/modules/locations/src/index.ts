export {
  deriveContainment,
  derivedTree,
  descendantIds,
  PATH_SEPARATOR,
  type ContainmentPlacement,
  type ContainmentTreeInput,
  type ContainmentTreeNode,
} from "./locations/containment.js";
export { LocationDomainError, type LocationDomainErrorCode } from "./locations/errors.js";
export {
  areaOf,
  boundsOf,
  copyGeometry,
  createPolygonGeometry,
  createRectangleGeometry,
  geometryContains,
  pointInPolygon,
  verticesOf,
  type GeometryBounds,
  type MapGeometry,
  type NormalizedPoint,
  type PolygonGeometry,
  type RectangleGeometry,
} from "./locations/geometry.js";
export {
  LocationMap,
  mapStockStatusPresentation,
  type AddMapLocation,
  type BlankMapBackground,
  type DerivedStockStatus,
  type FloorPlanMapBackground,
  type LocationMapSnapshot,
  type MapBackground,
  type MapLocation,
  type MapLocationStatus,
  type MapStatus,
  type MapStockStatusPresentation,
  type UpdateMapLocation,
} from "./locations/map.js";
export {
  retirementOutcome,
  type LocationRetirementFacts,
  type LocationRetirementOutcome,
} from "./locations/retirement.js";
export {
  createDocumentId,
  createLocationCode,
  createLocationId,
  createLocationName,
  createMapId,
  type DocumentId,
  type LocationCode,
  type LocationId,
  type LocationName,
  type MapId,
} from "./locations/value-objects.js";
