export type ConfigurationEnvironment = Readonly<Record<string, string | undefined>>;

const trimmedOrUndefined = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};

const readPositiveInteger = (
  environment: ConfigurationEnvironment,
  name: string,
  defaultValue: number,
): number => {
  const value = trimmedOrUndefined(environment[name]);
  if (value === undefined) return defaultValue;
  if (!/^[1-9]\d*$/u.test(value)) throw new Error(`${name} must be a positive integer.`);
  return Number(value);
};

export interface RecognitionPipelineConfiguration {
  /** Undefined means the stage reports Unavailable rather than failing the job. */
  readonly recognitionCoreUrl: string | undefined;
  readonly recognitionCoreTimeoutMilliseconds: number;
  readonly recognitionFusionUrl: string | undefined;
  readonly recognitionFusionApiKey: string | undefined;
  readonly recognitionFusionTimeoutMilliseconds: number;
  readonly braveSearchApiKey: string | undefined;
  readonly webFetchTimeoutMilliseconds: number;
  readonly visualIndexEmbeddingModel: string;
}

/**
 * Every model-backed stage is independently optional here for the same
 * reason recognition-core's own backends are (services/recognition-core/src/
 * recognition_core/backend.py): no service is deployed in every environment,
 * and a missing one degrades its stage to `Unavailable` rather than failing
 * the whole session (specification section 9.3's per-stage-unavailable
 * guarantee).
 */
export const loadRecognitionPipelineConfiguration = (
  environment: ConfigurationEnvironment = process.env,
): RecognitionPipelineConfiguration => ({
  recognitionCoreUrl: trimmedOrUndefined(environment.RECOGNITION_CORE_URL),
  recognitionCoreTimeoutMilliseconds: readPositiveInteger(
    environment,
    "RECOGNITION_CORE_TIMEOUT_MS",
    20_000,
  ),
  recognitionFusionUrl: trimmedOrUndefined(environment.RECOGNITION_FUSION_URL),
  recognitionFusionApiKey: trimmedOrUndefined(environment.RECOGNITION_FUSION_API_KEY),
  recognitionFusionTimeoutMilliseconds: readPositiveInteger(
    environment,
    "RECOGNITION_FUSION_TIMEOUT_MS",
    15_000,
  ),
  braveSearchApiKey: trimmedOrUndefined(environment.BRAVE_SEARCH_API_KEY),
  webFetchTimeoutMilliseconds: readPositiveInteger(environment, "WEB_FETCH_TIMEOUT_MS", 5_000),
  visualIndexEmbeddingModel:
    trimmedOrUndefined(environment.VISUAL_INDEX_EMBEDDING_MODEL) ?? "unset",
});
