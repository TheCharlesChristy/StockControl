import { describe, expect, it } from "vitest";

import { loadRecognitionPipelineConfiguration } from "../src/recognition/recognition-configuration";

describe("loadRecognitionPipelineConfiguration", () => {
  it("leaves every model-backed setting undefined when nothing is configured", () => {
    const configuration = loadRecognitionPipelineConfiguration({});

    expect(configuration.recognitionCoreUrl).toBeUndefined();
    expect(configuration.recognitionFusionUrl).toBeUndefined();
    expect(configuration.recognitionFusionApiKey).toBeUndefined();
    expect(configuration.braveSearchApiKey).toBeUndefined();
  });

  it("applies the specification's default timeouts", () => {
    const configuration = loadRecognitionPipelineConfiguration({});

    expect(configuration.recognitionCoreTimeoutMilliseconds).toBe(20_000);
    expect(configuration.recognitionFusionTimeoutMilliseconds).toBe(15_000);
    expect(configuration.recognitionFusionConcurrency).toBe(2);
    expect(configuration.webFetchTimeoutMilliseconds).toBe(5_000);
  });

  it("reads every configured value", () => {
    const configuration = loadRecognitionPipelineConfiguration({
      RECOGNITION_CORE_URL: "https://recognition-core.internal",
      RECOGNITION_CORE_TIMEOUT_MS: "1000",
      RECOGNITION_FUSION_URL: "https://recognition-fusion.internal",
      RECOGNITION_FUSION_API_KEY: "fusion-key",
      RECOGNITION_FUSION_TIMEOUT_MS: "2000",
      RECOGNITION_FUSION_CONCURRENCY: "4",
      BRAVE_SEARCH_API_KEY: "brave-key",
      WEB_FETCH_TIMEOUT_MS: "3000",
      VISUAL_INDEX_EMBEDDING_MODEL: "nomic-embed-vision-v1.5",
    });

    expect(configuration).toEqual({
      recognitionCoreUrl: "https://recognition-core.internal",
      recognitionCoreTimeoutMilliseconds: 1_000,
      recognitionFusionUrl: "https://recognition-fusion.internal",
      recognitionFusionApiKey: "fusion-key",
      recognitionFusionTimeoutMilliseconds: 2_000,
      recognitionFusionConcurrency: 4,
      braveSearchApiKey: "brave-key",
      webFetchTimeoutMilliseconds: 3_000,
      visualIndexEmbeddingModel: "nomic-embed-vision-v1.5",
    });
  });

  it("treats a blank string the same as unset", () => {
    const configuration = loadRecognitionPipelineConfiguration({
      RECOGNITION_CORE_URL: "   ",
    });
    expect(configuration.recognitionCoreUrl).toBeUndefined();
  });

  it("defaults the visual index embedding model to 'unset'", () => {
    expect(
      loadRecognitionPipelineConfiguration({}).visualIndexEmbeddingModel,
    ).toBe("unset");
  });

  it.each([
    "RECOGNITION_CORE_TIMEOUT_MS",
    "RECOGNITION_FUSION_TIMEOUT_MS",
    "RECOGNITION_FUSION_CONCURRENCY",
    "WEB_FETCH_TIMEOUT_MS",
  ])("rejects a non-positive-integer %s", (name) => {
    expect(() =>
      loadRecognitionPipelineConfiguration({ [name]: "not-a-number" }),
    ).toThrow();
    expect(() =>
      loadRecognitionPipelineConfiguration({ [name]: "0" }),
    ).toThrow();
    expect(() =>
      loadRecognitionPipelineConfiguration({ [name]: "-5" }),
    ).toThrow();
  });
});
