export type ImageMediaType = "image/png" | "image/jpeg";

export interface ImageUploadRequest {
  readonly originalFileName: string;
  readonly mediaType: ImageMediaType;
  readonly contentBase64: string;
}
