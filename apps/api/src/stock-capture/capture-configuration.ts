/*
 * Whether assisted stock capture is switched on, and the few numbers the
 * feature needs to be told.
 *
 * Default off. A customer installation that deploys this commit gets exactly
 * the behaviour it had before until somebody sets the flag, which is what
 * makes a per-customer pilot rollout possible without branching the build.
 */

export type CaptureEnvironment = Readonly<Record<string, string | undefined>>;

export interface StockCaptureConfiguration {
  readonly enabled: boolean;
  /** How long a presigned upload grant lives. Minutes, not hours. */
  readonly uploadGrantSeconds: number;
  /**
   * How long an unfinished session's photographs and evidence survive. The
   * product queue keeps both for the same bounded review period.
   */
  readonly sessionLifetimeSeconds: number;
  /** Attempts a recognition job gets before it dead-letters visibly. */
  readonly recognitionMaxAttempts: number;
}

const DEFAULT_UPLOAD_GRANT_SECONDS = 600;
const DEFAULT_SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_RECOGNITION_MAX_ATTEMPTS = 3;
const MAXIMUM_OBJECT_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

const readPositiveInteger = (
  environment: CaptureEnvironment,
  name: string,
  defaultValue: number,
): number => {
  const value = environment[name]?.trim();
  if (value === undefined || value.length === 0) return defaultValue;
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return Number(value);
};

/**
 * Anything other than an explicit "true" leaves the feature off. Exported on
 * its own, separate from full validation, because deciding whether to
 * register the capture routes at all happens at module load — and that
 * decision must not fail an otherwise-healthy deployment over an unrelated
 * stock-capture number nobody is using yet.
 */
export const isStockCaptureEnabled = (environment: CaptureEnvironment = process.env): boolean =>
  environment.STOCK_CAPTURE_ENABLED?.trim().toLowerCase() === "true";

export const loadStockCaptureConfiguration = (
  environment: CaptureEnvironment = process.env,
): StockCaptureConfiguration => {
  const sessionLifetimeSeconds = readPositiveInteger(
    environment,
    "STOCK_CAPTURE_SESSION_LIFETIME_SECONDS",
    DEFAULT_SESSION_LIFETIME_SECONDS,
  );

  /*
   * A session outliving its photographs would show a person suggestions they
   * can no longer act on, and would quietly ask the janitor to keep objects
   * past the deadline the privacy notice promises.
   */
  if (sessionLifetimeSeconds > MAXIMUM_OBJECT_LIFETIME_SECONDS) {
    throw new Error(
      "STOCK_CAPTURE_SESSION_LIFETIME_SECONDS cannot exceed the 30-day limit on stored photographs.",
    );
  }

  return {
    enabled: isStockCaptureEnabled(environment),
    uploadGrantSeconds: readPositiveInteger(
      environment,
      "STOCK_CAPTURE_UPLOAD_GRANT_SECONDS",
      DEFAULT_UPLOAD_GRANT_SECONDS,
    ),
    sessionLifetimeSeconds,
    recognitionMaxAttempts: readPositiveInteger(
      environment,
      "STOCK_CAPTURE_MAX_ATTEMPTS",
      DEFAULT_RECOGNITION_MAX_ATTEMPTS,
    ),
  };
};
