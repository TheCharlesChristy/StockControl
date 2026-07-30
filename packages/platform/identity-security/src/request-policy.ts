export interface BrowserRequestMetadata {
  readonly method: string;
  readonly origin?: string;
  readonly secFetchSite?: string;
  readonly secFetchMode?: string;
}

export interface BrowserRequestPolicyInput {
  readonly allowedOrigins: readonly string[];
  /**
   * Set true only when every supported client is known to emit Fetch Metadata headers.
   * Exact Origin checking remains mandatory either way.
   */
  readonly requireFetchMetadata?: boolean;
}

export type BrowserRequestPolicyDecision =
  | { readonly allowed: true; readonly requiresCsrf: boolean }
  | {
      readonly allowed: false;
      readonly reason:
        | "missing-origin"
        | "untrusted-origin"
        | "missing-fetch-metadata"
        | "cross-origin-fetch"
        | "disallowed-fetch-mode";
    };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ALLOWED_FETCH_MODES = new Set(["cors", "same-origin"]);

const canonicalOrigin = (origin: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new RangeError(`Invalid allowed origin: ${origin}.`);
  }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.origin !== origin) {
    throw new RangeError(`Allowed origin must be an exact HTTP(S) origin: ${origin}.`);
  }
  return parsed.origin;
};

export class BrowserRequestPolicy {
  readonly #allowedOrigins: ReadonlySet<string>;
  readonly #requireFetchMetadata: boolean;

  public constructor(input: BrowserRequestPolicyInput) {
    if (input.allowedOrigins.length < 1) {
      throw new RangeError("At least one allowed origin is required.");
    }
    const origins = input.allowedOrigins.map(canonicalOrigin);
    if (new Set(origins).size !== origins.length) {
      throw new Error("Allowed origins must be unique.");
    }
    this.#allowedOrigins = new Set(origins);
    this.#requireFetchMetadata = input.requireFetchMetadata ?? false;
  }

  public evaluate(request: BrowserRequestMetadata): BrowserRequestPolicyDecision {
    const method = request.method.trim().toUpperCase();
    if (SAFE_METHODS.has(method)) {
      return { allowed: true, requiresCsrf: false };
    }

    if (request.origin === undefined || request.origin.length === 0) {
      return { allowed: false, reason: "missing-origin" };
    }
    if (!this.#allowedOrigins.has(request.origin)) {
      return { allowed: false, reason: "untrusted-origin" };
    }

    const site = request.secFetchSite?.toLowerCase();
    const mode = request.secFetchMode?.toLowerCase();
    if (this.#requireFetchMetadata && (site === undefined || mode === undefined)) {
      return { allowed: false, reason: "missing-fetch-metadata" };
    }
    if (site !== undefined && site !== "same-origin") {
      return { allowed: false, reason: "cross-origin-fetch" };
    }
    if (mode !== undefined && !ALLOWED_FETCH_MODES.has(mode)) {
      return { allowed: false, reason: "disallowed-fetch-mode" };
    }

    return { allowed: true, requiresCsrf: true };
  }
}
