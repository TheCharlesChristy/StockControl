import { S3PrivateObjectStorage, type PrivateObjectStorage } from "../media/media-storage";

/** Compatibility name retained for the locations module's existing boundary. */
export type FloorPlanObjectStorage = PrivateObjectStorage;

export class S3PrivateFloorPlanStorage
  extends S3PrivateObjectStorage
  implements FloorPlanObjectStorage {}
