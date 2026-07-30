declare const locationIdBrand: unique symbol;
declare const mapIdBrand: unique symbol;
declare const mapRegionIdBrand: unique symbol;
declare const locationCodeBrand: unique symbol;
declare const locationNameBrand: unique symbol;
declare const engineerIdBrand: unique symbol;
declare const jobIdBrand: unique symbol;
declare const documentIdBrand: unique symbol;
declare const reasonBrand: unique symbol;

export type LocationId = string & { readonly [locationIdBrand]: "LocationId" };
export type MapId = string & { readonly [mapIdBrand]: "MapId" };
export type MapRegionId = string & { readonly [mapRegionIdBrand]: "MapRegionId" };
export type LocationCode = string & { readonly [locationCodeBrand]: "LocationCode" };
export type LocationName = string & { readonly [locationNameBrand]: "LocationName" };
export type EngineerId = string & { readonly [engineerIdBrand]: "EngineerId" };
export type JobId = string & { readonly [jobIdBrand]: "JobId" };
export type DocumentId = string & { readonly [documentIdBrand]: "DocumentId" };
export type Reason = string & { readonly [reasonBrand]: "Reason" };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const OPAQUE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const LOCATION_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._/-]*$/u;
const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });

const internalId = (value: string, description: string): string => {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new RangeError(`${description} must be a canonical UUID.`);
  }
  return normalized;
};

const opaqueReference = (value: string, description: string): string => {
  if (
    value.length < 1 ||
    value.length > 128 ||
    value.trim() !== value ||
    !OPAQUE_REFERENCE_PATTERN.test(value)
  ) {
    throw new RangeError(`${description} must be a stable 1-128 character identifier.`);
  }
  return value;
};

export const createLocationId = (value: string): LocationId =>
  internalId(value, "Location ID") as LocationId;

export const createMapId = (value: string): MapId => internalId(value, "Map ID") as MapId;

export const createMapRegionId = (value: string): MapRegionId =>
  internalId(value, "Map region ID") as MapRegionId;

export const createEngineerId = (value: string): EngineerId =>
  opaqueReference(value, "Engineer ID") as EngineerId;

export const createJobId = (value: string): JobId => opaqueReference(value, "Job ID") as JobId;

export const createDocumentId = (value: string): DocumentId =>
  opaqueReference(value, "Document ID") as DocumentId;

export const createLocationCode = (value: string): LocationCode => {
  const normalized = value.trim().toUpperCase();
  if (normalized.length < 1 || normalized.length > 32 || !LOCATION_CODE_PATTERN.test(normalized)) {
    throw new RangeError(
      "Location code must contain 1-32 letters, numbers, dots, underscores, slashes, or hyphens.",
    );
  }
  return normalized as LocationCode;
};

export const createLocationName = (value: string): LocationName => {
  if (value.length > 256 || hasControlCharacter(value)) {
    throw new RangeError("Location name must contain 1-120 characters.");
  }
  const normalized = value.trim().replaceAll(/\s+/gu, " ");
  if (normalized.length < 1 || normalized.length > 120) {
    throw new RangeError("Location name must contain 1-120 characters.");
  }
  return normalized as LocationName;
};

export const createReason = (value: string): Reason => {
  if (value.length > 1_000 || hasControlCharacter(value)) {
    throw new RangeError("Reason must contain 1-500 characters.");
  }
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 500) {
    throw new RangeError("Reason must contain 1-500 characters.");
  }
  return normalized as Reason;
};
