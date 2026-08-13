import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { CaptureImageMediaType, ImageMediaType } from "@stockcontrol/contracts";

type StoredImageMediaType = ImageMediaType | CaptureImageMediaType;

/**
 * A short-lived grant to write exactly one object.
 *
 * The browser uploads capture photographs straight to the bucket rather than
 * through the API. That keeps image bytes out of the API process — and off
 * Railway's billable service egress — but it means the grant itself is the
 * only control. So it names one server-generated key, pins the content type,
 * and expires in minutes: whoever holds it can write that one object, once,
 * for a short while, and nothing else.
 */
export interface PresignedUploadGrant {
  readonly url: string;
  readonly expiresAt: Date;
}

export interface PrivateObjectStorage {
  putObject(input: {
    readonly key: string;
    readonly bytes: Buffer;
    readonly mediaType: StoredImageMediaType;
  }): Promise<void>;
  getObject(key: string): Promise<{ readonly bytes: Buffer; readonly mediaType: string }>;
  deleteObject(key: string): Promise<void>;
}

export interface PresigningObjectStorage extends PrivateObjectStorage {
  createPresignedUpload(input: {
    readonly key: string;
    readonly mediaType: string;
    readonly expiresInSeconds: number;
  }): Promise<PresignedUploadGrant>;
}

interface S3Configuration {
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly urlStyle: "path" | "virtual";
}

const CONFIGURATION_VARIABLES = [
  "FLOOR_PLAN_S3_ENDPOINT",
  "FLOOR_PLAN_S3_BUCKET",
  "FLOOR_PLAN_S3_REGION",
  "FLOOR_PLAN_S3_ACCESS_KEY",
  "FLOOR_PLAN_S3_SECRET_KEY",
] as const;

const configuredValue = (environment: NodeJS.ProcessEnv, name: string): string | undefined => {
  const value = environment[name]?.trim();
  return value === "" ? undefined : value;
};

const requiredConfiguredValue = (environment: NodeJS.ProcessEnv, name: string): string => {
  const value = configuredValue(environment, name);
  if (value === undefined) {
    throw new Error(`Private image storage configuration is incomplete. Set ${name}.`);
  }
  return value;
};

const configurationFrom = (environment: NodeJS.ProcessEnv): S3Configuration | undefined => {
  const values = CONFIGURATION_VARIABLES.map(
    (name) => [name, configuredValue(environment, name)] as const,
  );
  const urlStyle = configuredValue(environment, "FLOOR_PLAN_S3_URL_STYLE");
  const hasConfiguration =
    values.some(([, value]) => value !== undefined) || urlStyle !== undefined;
  if (!hasConfiguration) return undefined;

  const missing = values.filter(([, value]) => value === undefined).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `Private image storage configuration is incomplete. Set ${missing.join(", ")}.`,
    );
  }
  if (urlStyle !== undefined && urlStyle !== "path" && urlStyle !== "virtual") {
    throw new Error('FLOOR_PLAN_S3_URL_STYLE must be either "path" or "virtual".');
  }

  const endpoint = requiredConfiguredValue(environment, "FLOOR_PLAN_S3_ENDPOINT");
  const bucket = requiredConfiguredValue(environment, "FLOOR_PLAN_S3_BUCKET");
  const region = requiredConfiguredValue(environment, "FLOOR_PLAN_S3_REGION");
  const accessKey = requiredConfiguredValue(environment, "FLOOR_PLAN_S3_ACCESS_KEY");
  const secretKey = requiredConfiguredValue(environment, "FLOOR_PLAN_S3_SECRET_KEY");
  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    throw new Error("FLOOR_PLAN_S3_ENDPOINT must be a valid HTTP or HTTPS URL.");
  }
  if (parsedEndpoint.protocol !== "http:" && parsedEndpoint.protocol !== "https:") {
    throw new Error("FLOOR_PLAN_S3_ENDPOINT must be a valid HTTP or HTTPS URL.");
  }

  return {
    endpoint: parsedEndpoint.toString(),
    bucket,
    region,
    accessKey,
    secretKey,
    // Path style preserves compatibility with the existing local MinIO setup.
    urlStyle: urlStyle ?? "path",
  };
};

/** S3-compatible private storage shared by floor plans and application photos. */
export class S3PrivateObjectStorage implements PresigningObjectStorage {
  private readonly bucket: string | undefined;
  private readonly client: S3Client | undefined;

  public constructor(environment: NodeJS.ProcessEnv = process.env) {
    const configuration = configurationFrom(environment);
    if (configuration === undefined) {
      if (environment.NODE_ENV === "production") {
        throw new Error("Private image storage must be configured in production.");
      }
      return;
    }

    this.bucket = configuration.bucket;
    this.client = new S3Client({
      endpoint: configuration.endpoint,
      region: configuration.region,
      credentials: {
        accessKeyId: configuration.accessKey,
        secretAccessKey: configuration.secretKey,
      },
      forcePathStyle: configuration.urlStyle === "path",
    });
  }

  public async putObject(input: {
    readonly key: string;
    readonly bytes: Buffer;
    readonly mediaType: StoredImageMediaType;
  }): Promise<void> {
    const { bucket, client } = this.configuredStorage();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: input.key,
        Body: input.bytes,
        ContentType: input.mediaType,
      }),
    );
  }

  public async getObject(
    key: string,
  ): Promise<{ readonly bytes: Buffer; readonly mediaType: string }> {
    const { bucket, client } = this.configuredStorage();
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (response.Body === undefined) {
      throw new Error("Private image storage returned an object without content.");
    }
    return {
      bytes: Buffer.from(await response.Body.transformToByteArray()),
      mediaType: response.ContentType ?? "application/octet-stream",
    };
  }

  public async deleteObject(key: string): Promise<void> {
    const { bucket, client } = this.configuredStorage();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  /**
   * The content type is signed into the grant, so a browser that uploads
   * something other than what it declared is refused by the bucket rather
   * than by us later. That is a cheap first gate, not the check that matters:
   * the worker still verifies magic bytes, dimensions and digest on the bytes
   * that actually arrived, because a declared type is only ever a claim.
   */
  public async createPresignedUpload(input: {
    readonly key: string;
    readonly mediaType: string;
    readonly expiresInSeconds: number;
  }): Promise<PresignedUploadGrant> {
    const { bucket, client } = this.configuredStorage();
    const url = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: bucket, Key: input.key, ContentType: input.mediaType }),
      { expiresIn: input.expiresInSeconds },
    );

    return {
      url,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1_000),
    };
  }

  private configuredStorage(): { readonly bucket: string; readonly client: S3Client } {
    if (this.bucket === undefined || this.client === undefined) {
      throw new Error("Private image storage is not configured.");
    }
    return { bucket: this.bucket, client: this.client };
  }
}
