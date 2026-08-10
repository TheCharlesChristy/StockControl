import { describe, expect, it } from "vitest";

import { S3ImageStorage } from "../src/recognition/image-storage";

const FULL_CONFIGURATION: NodeJS.ProcessEnv = {
  FLOOR_PLAN_S3_ENDPOINT: "https://s3.example.invalid",
  FLOOR_PLAN_S3_BUCKET: "media",
  FLOOR_PLAN_S3_REGION: "auto",
  FLOOR_PLAN_S3_ACCESS_KEY: "test-access-key",
  FLOOR_PLAN_S3_SECRET_KEY: "test-secret-key",
};

describe("S3ImageStorage", () => {
  it("constructs without throwing when entirely unconfigured", () => {
    expect(() => new S3ImageStorage({})).not.toThrow();
  });

  it("reports not configured when an operation is attempted without configuration", async () => {
    const storage = new S3ImageStorage({});
    await expect(storage.getObject("some/key")).rejects.toThrow("not configured");
    await expect(storage.putObject("some/key", Buffer.from(""), "image/webp")).rejects.toThrow(
      "not configured",
    );
    await expect(storage.deleteObject("some/key")).rejects.toThrow("not configured");
  });

  it("throws at construction when only some variables are set", () => {
    expect(
      () =>
        new S3ImageStorage({
          FLOOR_PLAN_S3_ENDPOINT: "https://s3.example.invalid",
          FLOOR_PLAN_S3_BUCKET: "media",
        }),
    ).toThrow(/incomplete/u);
  });

  it("constructs without throwing when fully configured", () => {
    expect(() => new S3ImageStorage(FULL_CONFIGURATION)).not.toThrow();
  });

  it("rejects a non-HTTP(S) endpoint", () => {
    expect(
      () => new S3ImageStorage({ ...FULL_CONFIGURATION, FLOOR_PLAN_S3_ENDPOINT: "not-a-url" }),
    ).toThrow(/valid HTTP or HTTPS URL/u);
  });

  it("rejects an invalid URL style", () => {
    expect(
      () => new S3ImageStorage({ ...FULL_CONFIGURATION, FLOOR_PLAN_S3_URL_STYLE: "nonsense" }),
    ).toThrow(/path.*virtual/u);
  });
});
