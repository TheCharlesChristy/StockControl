import { randomUUID } from "node:crypto";

import type { ImageUploadRequest, ItemPhotoView } from "@stockcontrol/contracts";
import { resourceUnavailable, validationFailed } from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";
import type { StockControlDatabase } from "@stockcontrol/platform-database";
import { sql, type Kysely, type Transaction } from "kysely";

import { decodeImage, digestFor, type DecodedImage } from "./image-validation";
import { S3PrivateObjectStorage, type PrivateObjectStorage } from "./media-storage";

const SCHEMA = "stockcontrol" as const;
const MAX_ITEM_PHOTOS = 10;

interface StoredPhoto {
  readonly id: string;
  readonly object_key: string;
  readonly original_file_name: string;
  readonly media_type: "image/png" | "image/jpeg";
  readonly byte_length: number;
  readonly sha256: string;
}

interface ItemPhotoRow extends StoredPhoto {
  readonly item_id: string;
  readonly display_order: number;
}

type Database = Kysely<StockControlDatabase> | Transaction<StockControlDatabase>;

export interface PhotoAsset {
  readonly bytes: Buffer;
  readonly mediaType: "image/png" | "image/jpeg";
  readonly fileName: string;
}

/**
 * PostgreSQL returns bigint columns as strings through node-postgres, so the
 * recorded byte count must be normalised before it is compared with a Buffer.
 */
export const matchesStoredPhoto = (
  bytes: Buffer,
  expectedByteLength: number | string,
  expectedSha256: string,
): boolean => {
  const byteLength = Number(expectedByteLength);
  return (
    Number.isSafeInteger(byteLength) &&
    bytes.length === byteLength &&
    digestFor(bytes) === expectedSha256
  );
};

export class PhotosService {
  private readonly maxBytes: number;

  public constructor(
    private readonly database: Kysely<StockControlDatabase>,
    private readonly storage: PrivateObjectStorage = new S3PrivateObjectStorage(),
  ) {
    const configured = Number(process.env.PHOTO_MAX_BYTES ?? "10485760");
    this.maxBytes = Number.isInteger(configured) && configured > 0 ? configured : 10 * 1024 * 1024;
  }

  public async profilePhotoUrl(userId: string): Promise<string | null> {
    const row = await this.database
      .withSchema(SCHEMA)
      .selectFrom("user_profile_photos")
      .select("id")
      .where("user_id", "=", userId)
      .executeTakeFirst();
    return row === undefined ? null : `/api/v1/users/${userId}/profile-photo?v=${row.id}`;
  }

  public async itemPhotos(itemId: string): Promise<readonly ItemPhotoView[]> {
    const rows = await this.database
      .withSchema(SCHEMA)
      .selectFrom("item_photos")
      .select(["id", "original_file_name", "display_order"])
      .where("item_id", "=", itemId)
      .orderBy("display_order")
      .orderBy("created_at")
      .execute();
    return rows.map((row) => ({
      id: row.id,
      url: `/api/v1/items/${itemId}/photos/${row.id}`,
      originalFileName: row.original_file_name,
      isCover: row.display_order === 0,
    }));
  }

  public async itemPhoto(itemId: string, photoId: string): Promise<PhotoAsset> {
    const row = await this.database
      .withSchema(SCHEMA)
      .selectFrom("item_photos")
      .select(["id", "object_key", "original_file_name", "media_type", "byte_length", "sha256"])
      .where("item_id", "=", itemId)
      .where("id", "=", photoId)
      .executeTakeFirst();
    return this.read(row);
  }

  public async profilePhoto(userId: string): Promise<PhotoAsset> {
    const row = await this.database
      .withSchema(SCHEMA)
      .selectFrom("user_profile_photos")
      .select(["id", "object_key", "original_file_name", "media_type", "byte_length", "sha256"])
      .where("user_id", "=", userId)
      .executeTakeFirst();
    return this.read(row);
  }

  public async saveProfilePhoto(userId: string, input: ImageUploadRequest): Promise<void> {
    const decoded = this.decode(input);
    const id = randomUUID();
    const objectKey = `user-photos/${id}`;
    const next = {
      id,
      user_id: userId,
      object_key: objectKey,
      original_file_name: input.originalFileName,
      media_type: input.mediaType,
      byte_length: decoded.bytes.length,
      sha256: digestFor(decoded.bytes),
    } as const;
    const existing = await this.database
      .withSchema(SCHEMA)
      .selectFrom("user_profile_photos")
      .select(["object_key"])
      .where("user_id", "=", userId)
      .executeTakeFirst();

    await this.putVerifiedObject(objectKey, decoded.bytes, input.mediaType);
    try {
      await this.database.transaction().execute(async (tx) => {
        await tx
          .withSchema(SCHEMA)
          .deleteFrom("user_profile_photos")
          .where("user_id", "=", userId)
          .execute();
        await tx.withSchema(SCHEMA).insertInto("user_profile_photos").values(next).execute();
      });
    } catch (error) {
      await this.storage.deleteObject(objectKey).catch(() => undefined);
      throw error;
    }
    if (existing !== undefined)
      await this.storage.deleteObject(existing.object_key).catch(() => undefined);
  }

  public async deleteProfilePhoto(userId: string): Promise<void> {
    const existing = await this.database
      .withSchema(SCHEMA)
      .selectFrom("user_profile_photos")
      .select("object_key")
      .where("user_id", "=", userId)
      .executeTakeFirst();
    if (existing === undefined) return;
    await this.database
      .withSchema(SCHEMA)
      .deleteFrom("user_profile_photos")
      .where("user_id", "=", userId)
      .execute();
    await this.storage.deleteObject(existing.object_key).catch(() => undefined);
  }

  public async saveItemPhoto(
    itemId: string,
    actorUserId: string,
    input: ImageUploadRequest,
  ): Promise<void> {
    const item = await this.database
      .withSchema(SCHEMA)
      .selectFrom("items")
      .select("id")
      .where("id", "=", itemId)
      .executeTakeFirst();
    if (item === undefined)
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "That item was not found." }),
      );
    const decoded = this.decode(input);
    const countRow = await this.database
      .withSchema(SCHEMA)
      .selectFrom("item_photos")
      .select((builder) => builder.fn.countAll<string>().as("total"))
      .where("item_id", "=", itemId)
      .executeTakeFirst();
    const count = Number(countRow?.total ?? 0);
    if (count >= MAX_ITEM_PHOTOS)
      throw new ApplicationFailureException(
        validationFailed({
          photos: [`An item can have at most ${String(MAX_ITEM_PHOTOS)} photos.`],
        }),
      );
    const id = randomUUID();
    const objectKey = `item-photos/${id}`;
    const next = {
      id,
      item_id: itemId,
      object_key: objectKey,
      original_file_name: input.originalFileName,
      media_type: input.mediaType,
      byte_length: decoded.bytes.length,
      sha256: digestFor(decoded.bytes),
      display_order: count,
      created_by_user_id: actorUserId,
    } as const;
    await this.putVerifiedObject(objectKey, decoded.bytes, input.mediaType);
    try {
      await this.database.withSchema(SCHEMA).insertInto("item_photos").values(next).execute();
    } catch (error) {
      await this.storage.deleteObject(objectKey).catch(() => undefined);
      throw error;
    }
  }

  public async deleteItemPhoto(itemId: string, photoId: string): Promise<void> {
    const row = await this.photoRow(itemId, photoId);
    await this.database.transaction().execute(async (tx) => {
      await tx.withSchema(SCHEMA).deleteFrom("item_photos").where("id", "=", photoId).execute();
      await this.normaliseOrders(tx, itemId);
    });
    await this.storage.deleteObject(row.object_key).catch(() => undefined);
  }

  public async setCover(itemId: string, photoId: string): Promise<void> {
    const row = await this.photoRow(itemId, photoId);
    if (row.display_order === 0) return;
    await this.database.transaction().execute(async (tx) => {
      await tx
        .withSchema(SCHEMA)
        .updateTable("item_photos")
        .set({ display_order: sql`display_order + 100` })
        .where("item_id", "=", itemId)
        .execute();
      await tx
        .withSchema(SCHEMA)
        .updateTable("item_photos")
        .set({ display_order: 0 })
        .where("item_id", "=", itemId)
        .where("id", "=", photoId)
        .execute();
      const rows = await tx
        .withSchema(SCHEMA)
        .selectFrom("item_photos")
        .select(["id", "display_order"])
        .where("item_id", "=", itemId)
        .where("id", "!=", photoId)
        .execute();
      for (const other of rows) {
        const originalOrder = other.display_order - 100;
        await tx
          .withSchema(SCHEMA)
          .updateTable("item_photos")
          .set({
            display_order: originalOrder < row.display_order ? originalOrder + 1 : originalOrder,
          })
          .where("id", "=", other.id)
          .execute();
      }
      await this.normaliseOrders(tx, itemId);
    });
  }

  private decode(input: ImageUploadRequest): DecodedImage {
    try {
      return decodeImage(input, this.maxBytes);
    } catch (error) {
      throw new ApplicationFailureException(
        validationFailed({
          file: [error instanceof Error ? error.message : "The image is invalid."],
        }),
      );
    }
  }

  private async putVerifiedObject(
    key: string,
    bytes: Buffer,
    mediaType: "image/png" | "image/jpeg",
  ): Promise<void> {
    await this.storage.putObject({ key, bytes, mediaType });
    try {
      const stored = await this.storage.getObject(key);
      if (stored.bytes.length !== bytes.length || digestFor(stored.bytes) !== digestFor(bytes)) {
        throw new Error("The stored image failed its integrity check.");
      }
    } catch (error) {
      await this.storage.deleteObject(key).catch(() => undefined);
      throw new ApplicationFailureException(
        resourceUnavailable({
          detail:
            error instanceof Error ? error.message : "The stored image could not be verified.",
        }),
      );
    }
  }

  private async photoRow(itemId: string, photoId: string): Promise<ItemPhotoRow> {
    const row = await this.database
      .withSchema(SCHEMA)
      .selectFrom("item_photos")
      .select([
        "id",
        "item_id",
        "object_key",
        "original_file_name",
        "media_type",
        "byte_length",
        "sha256",
        "display_order",
      ])
      .where("item_id", "=", itemId)
      .where("id", "=", photoId)
      .executeTakeFirst();
    if (row === undefined)
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "That photo was not found." }),
      );
    return row;
  }

  private async normaliseOrders(database: Database, itemId: string): Promise<void> {
    const rows = await database
      .withSchema(SCHEMA)
      .selectFrom("item_photos")
      .select("id")
      .where("item_id", "=", itemId)
      .orderBy("display_order")
      .orderBy("created_at")
      .execute();
    for (const [index, row] of rows.entries()) {
      await database
        .withSchema(SCHEMA)
        .updateTable("item_photos")
        .set({ display_order: index + 100 })
        .where("id", "=", row.id)
        .execute();
    }
    for (const [index, row] of rows.entries()) {
      await database
        .withSchema(SCHEMA)
        .updateTable("item_photos")
        .set({ display_order: index })
        .where("id", "=", row.id)
        .execute();
    }
  }

  private async read(row: StoredPhoto | undefined): Promise<PhotoAsset> {
    if (row === undefined)
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "That photo was not found." }),
      );
    const object = await this.storage.getObject(row.object_key);
    if (!matchesStoredPhoto(object.bytes, row.byte_length, row.sha256))
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "That photo failed its integrity check." }),
      );
    return { bytes: object.bytes, mediaType: row.media_type, fileName: row.original_file_name };
  }
}
