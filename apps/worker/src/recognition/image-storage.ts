import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/*
 * Access to the same private bucket the API presigns uploads into. Most
 * traffic is read-only — the browser already put the capture bytes there
 * directly — but the worker owns two writes of its own: deleting a session's
 * objects once they are no longer needed (the capture janitor, specification
 * section 15) and writing the small EXIF-free crops an accepted item's
 * exemplars are built from. It never receives credentials wider than this
 * bucket needs.
 *
 * Configuration mirrors apps/api/src/media/media-storage.ts deliberately:
 * both processes must point at the same physical bucket, so the environment
 * variable names have to match rather than invent a worker-specific set.
 */

export interface DownloadedObject {
  readonly bytes: Buffer;
  readonly mediaType: string;
}

export interface ImageStorage {
  getObject(key: string): Promise<DownloadedObject>;
  putObject(key: string, bytes: Buffer, mediaType: string): Promise<void>;
  /** S3-semantics idempotent: deleting a key that is already gone still succeeds. */
  deleteObject(key: string): Promise<void>;
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
  // Absent entirely is a valid runtime state — this stage reports
  // Unavailable rather than the worker refusing to start (recognition-core
  // takes the same stance on its own missing model weights).
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
    bucket: requiredConfiguredValue(environment, "FLOOR_PLAN_S3_BUCKET"),
    region: requiredConfiguredValue(environment, "FLOOR_PLAN_S3_REGION"),
    accessKey: requiredConfiguredValue(environment, "FLOOR_PLAN_S3_ACCESS_KEY"),
    secretKey: requiredConfiguredValue(environment, "FLOOR_PLAN_S3_SECRET_KEY"),
    urlStyle: urlStyle ?? "path",
  };
};

export class S3ImageStorage implements ImageStorage {
  private readonly bucket: string | undefined;
  private readonly client: S3Client | undefined;

  public constructor(environment: NodeJS.ProcessEnv = process.env) {
    const configuration = configurationFrom(environment);
    if (configuration === undefined) return;

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

  public async getObject(key: string): Promise<DownloadedObject> {
    if (this.bucket === undefined || this.client === undefined) {
      throw new Error("Private image storage is not configured.");
    }
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (response.Body === undefined) {
      throw new Error("Private image storage returned an object without content.");
    }
    return {
      bytes: Buffer.from(await response.Body.transformToByteArray()),
      mediaType: response.ContentType ?? "application/octet-stream",
    };
  }

  public async putObject(key: string, bytes: Buffer, mediaType: string): Promise<void> {
    if (this.bucket === undefined || this.client === undefined) {
      throw new Error("Private image storage is not configured.");
    }
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: mediaType }),
    );
  }

  public async deleteObject(key: string): Promise<void> {
    if (this.bucket === undefined || this.client === undefined) {
      throw new Error("Private image storage is not configured.");
    }
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
