import type { ImageUploadRequest } from "@stockcontrol/contracts";

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export function readImageFile(file: File): Promise<ImageUploadRequest> {
  if (file.type !== "image/png" && file.type !== "image/jpeg") {
    return Promise.reject(new Error("Choose a PNG or JPEG image."));
  }
  if (file.size < 1 || file.size > MAX_PHOTO_BYTES) {
    return Promise.reject(new Error("Images must be between 1 byte and 10 MiB."));
  }
  return new Promise<ImageUploadRequest>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", () => reject(new Error("The image could not be read.")));
    reader.addEventListener("load", () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const contentBase64 = value.split(",", 2)[1] ?? "";
      if (contentBase64.length === 0) {
        reject(new Error("The image could not be read."));
        return;
      }
      resolve({
        originalFileName: file.name,
        mediaType: file.type as "image/png" | "image/jpeg",
        contentBase64,
      });
    });
    reader.readAsDataURL(file);
  });
}
