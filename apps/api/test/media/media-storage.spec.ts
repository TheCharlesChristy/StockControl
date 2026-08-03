import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type * as S3Module from "@aws-sdk/client-s3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const s3Mock = vi.hoisted(() => ({
  configuration: undefined as Record<string, unknown> | undefined,
  send: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof S3Module>();
  return {
    ...actual,
    S3Client: vi.fn(function (configuration: Record<string, unknown>) {
      s3Mock.configuration = configuration;
      return { send: s3Mock.send };
    }),
  };
});

import { S3PrivateObjectStorage } from "../../src/media/media-storage";

const environment = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  FLOOR_PLAN_S3_ENDPOINT: "https://storage.example.test",
  FLOOR_PLAN_S3_BUCKET: "private-media",
  FLOOR_PLAN_S3_REGION: "eu-west-1",
  FLOOR_PLAN_S3_ACCESS_KEY: "access-key",
  FLOOR_PLAN_S3_SECRET_KEY: "secret-key",
  ...overrides,
});

describe("S3 private object storage", () => {
  beforeEach(() => {
    s3Mock.configuration = undefined;
    s3Mock.send.mockReset();
    vi.mocked(S3Client).mockClear();
  });

  it("uses path-style URLs by default for local MinIO compatibility", () => {
    new S3PrivateObjectStorage(environment());

    expect(s3Mock.configuration).toMatchObject({
      endpoint: "https://storage.example.test/",
      region: "eu-west-1",
      forcePathStyle: true,
    });
  });

  it("uses virtual-hosted URLs when configured for Railway Buckets", () => {
    new S3PrivateObjectStorage(environment({ FLOOR_PLAN_S3_URL_STYLE: "virtual" }));

    expect(s3Mock.configuration).toMatchObject({
      endpoint: "https://storage.example.test/",
      forcePathStyle: false,
    });
  });

  it("rejects partial or invalid configuration without including credential values", () => {
    const partial = {
      FLOOR_PLAN_S3_ENDPOINT: "https://storage.example.test",
      FLOOR_PLAN_S3_ACCESS_KEY: "must-not-appear",
    };

    expect(() => new S3PrivateObjectStorage(partial)).toThrow(
      "Private image storage configuration is incomplete",
    );
    try {
      new S3PrivateObjectStorage(partial);
    } catch (error) {
      expect(String(error)).not.toContain("must-not-appear");
    }
    expect(
      () => new S3PrivateObjectStorage(environment({ FLOOR_PLAN_S3_URL_STYLE: "unsupported" })),
    ).toThrow('FLOOR_PLAN_S3_URL_STYLE must be either "path" or "virtual".');
  });

  it("keeps storage optional until an operation needs it", async () => {
    const storage = new S3PrivateObjectStorage({});

    await expect(storage.deleteObject("item-photos/example")).rejects.toThrow(
      "Private image storage is not configured",
    );
    expect(S3Client).not.toHaveBeenCalled();
  });

  it("requires storage configuration when the API runs in production", () => {
    expect(() => new S3PrivateObjectStorage({ NODE_ENV: "production" })).toThrow(
      "Private image storage must be configured in production",
    );
  });

  it("sends put, get and delete operations through the configured bucket", async () => {
    const bytes = Buffer.from("photo");
    s3Mock.send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        Body: { transformToByteArray: () => Promise.resolve(Uint8Array.from(bytes)) },
        ContentType: "image/png",
      })
      .mockResolvedValueOnce({});
    const storage = new S3PrivateObjectStorage(environment());

    await storage.putObject({ key: "item-photos/example", bytes, mediaType: "image/png" });
    await expect(storage.getObject("item-photos/example")).resolves.toEqual({
      bytes,
      mediaType: "image/png",
    });
    await storage.deleteObject("item-photos/example");

    const put = s3Mock.send.mock.calls[0]?.[0];
    const get = s3Mock.send.mock.calls[1]?.[0];
    const remove = s3Mock.send.mock.calls[2]?.[0];
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect(put.input).toMatchObject({
      Bucket: "private-media",
      Key: "item-photos/example",
      Body: bytes,
      ContentType: "image/png",
    });
    expect(get).toBeInstanceOf(GetObjectCommand);
    expect(get.input).toEqual({ Bucket: "private-media", Key: "item-photos/example" });
    expect(remove).toBeInstanceOf(DeleteObjectCommand);
    expect(remove.input).toEqual({ Bucket: "private-media", Key: "item-photos/example" });
  });

  it("rejects an object response without a body", async () => {
    s3Mock.send.mockResolvedValueOnce({ ContentType: "image/png" });
    const storage = new S3PrivateObjectStorage(environment());

    await expect(storage.getObject("missing-content")).rejects.toThrow(
      "Private image storage returned an object without content",
    );
  });
});
