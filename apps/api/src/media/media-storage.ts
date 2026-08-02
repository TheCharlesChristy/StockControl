import { createHash, createHmac } from "node:crypto";

import type { ImageMediaType } from "@stockcontrol/contracts";

export interface PrivateObjectStorage {
  putObject(input: {
    readonly key: string;
    readonly bytes: Buffer;
    readonly mediaType: ImageMediaType;
  }): Promise<void>;
  getObject(key: string): Promise<{ readonly bytes: Buffer; readonly mediaType: string }>;
  deleteObject(key: string): Promise<void>;
}

interface S3Configuration {
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly accessKey: string;
  readonly secretKey: string;
}

const sha256 = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");
const hmac = (key: Buffer | string, value: string): Buffer =>
  createHmac("sha256", key).update(value).digest();

const encodedPath = (key: string): string =>
  key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const configurationFrom = (environment: NodeJS.ProcessEnv): S3Configuration | undefined => {
  const endpoint = environment.FLOOR_PLAN_S3_ENDPOINT?.trim();
  const bucket = environment.FLOOR_PLAN_S3_BUCKET?.trim();
  const region = environment.FLOOR_PLAN_S3_REGION?.trim() || "us-east-1";
  const accessKey = environment.FLOOR_PLAN_S3_ACCESS_KEY?.trim();
  const secretKey = environment.FLOOR_PLAN_S3_SECRET_KEY?.trim();
  if (!endpoint || !bucket || !accessKey || !secretKey) return undefined;
  return { endpoint, bucket, region, accessKey, secretKey };
};

/** S3-compatible private storage shared by floor plans and application photos. */
export class S3PrivateObjectStorage implements PrivateObjectStorage {
  private readonly configuration: S3Configuration | undefined;

  public constructor(environment: NodeJS.ProcessEnv = process.env) {
    this.configuration = configurationFrom(environment);
  }

  public async putObject(input: {
    readonly key: string;
    readonly bytes: Buffer;
    readonly mediaType: ImageMediaType;
  }): Promise<void> {
    await this.request("PUT", input.key, input.bytes, input.mediaType);
  }

  public async getObject(
    key: string,
  ): Promise<{ readonly bytes: Buffer; readonly mediaType: string }> {
    const response = await this.request("GET", key);
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      mediaType: response.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  public async deleteObject(key: string): Promise<void> {
    await this.request("DELETE", key);
  }

  private async request(
    method: "DELETE" | "GET" | "PUT",
    key: string,
    body?: Buffer,
    mediaType?: string,
  ): Promise<Response> {
    const configuration = this.configuration;
    if (configuration === undefined) throw new Error("Private image storage is not configured.");

    const endpoint = new URL(configuration.endpoint);
    const basePath = endpoint.pathname.replace(/\/$/u, "");
    endpoint.pathname = `${basePath}/${encodeURIComponent(configuration.bucket)}/${encodedPath(key)}`;
    endpoint.search = "";

    const payloadHash = sha256(body ?? Buffer.alloc(0));
    const amzDate = new Date()
      .toISOString()
      .replaceAll(/[-:]/gu, "")
      .replace(/\.\d{3}Z$/u, "Z");
    const shortDate = amzDate.slice(0, 8);
    const scope = `${shortDate}/${configuration.region}/s3/aws4_request`;
    const headers: Record<string, string> = {
      host: endpoint.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...(mediaType === undefined ? {} : { "content-type": mediaType }),
    };
    const canonicalHeaders = Object.keys(headers)
      .sort()
      .map((name) => `${name}:${headers[name]!.trim()}\n`)
      .join("");
    const signedHeaders = Object.keys(headers).sort().join(";");
    const canonicalRequest = [
      method,
      endpoint.pathname,
      "",
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${configuration.secretKey}`, shortDate), configuration.region), "s3"),
      "aws4_request",
    );
    const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    const authorization = `AWS4-HMAC-SHA256 Credential=${configuration.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const response = await fetch(endpoint, {
      method,
      headers: { ...headers, authorization },
      ...(body === undefined ? {} : { body }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 400);
      throw new Error(`Private image storage returned ${String(response.status)}: ${detail}`);
    }
    return response;
  }
}
