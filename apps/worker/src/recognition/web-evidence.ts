import { lookup as dnsLookup } from "node:dns/promises";
import * as https from "node:https";
import { isIPv4, isIPv6 } from "node:net";

import type { CoreParsedIdentifiers } from "./core-client";

/*
 * Stage 5, specification section 7.8, hardened per section 16.3: block
 * loopback, link-local, private, metadata-service and non-HTTPS destinations
 * before and after every DNS resolution and redirect. The query is built
 * from allowlisted structured fields only, never a raw prompt or photograph.
 */

// ---- Query construction --------------------------------------------------

export interface WebEvidenceQueryInput {
  readonly validatedGtin: string | null;
  readonly manufacturerTokens: readonly string[];
  readonly partNumberCandidates: readonly string[];
  readonly nameFragments: readonly string[];
}

const MIN_DISTINCTIVE_NAME_LENGTH = 12;

/**
 * Returns a search string only when the evidence is strong enough to be
 * worth a paid request (section 7.8): a valid GTIN, a manufacturer plus
 * part/model number, or a manufacturer plus a sufficiently distinctive name.
 * Anything weaker returns null, and the caller reports the stage
 * `NotApplicable` rather than spending a lookup on a guess.
 */
export const buildWebEvidenceQuery = (input: WebEvidenceQueryInput): string | null => {
  if (input.validatedGtin !== null) return input.validatedGtin;

  const manufacturer = input.manufacturerTokens[0];
  if (manufacturer === undefined) return null;

  const partNumber = input.partNumberCandidates[0];
  if (partNumber !== undefined) return `${manufacturer} ${partNumber}`;

  const name = input.nameFragments.find(
    (fragment) => fragment.length >= MIN_DISTINCTIVE_NAME_LENGTH,
  );
  if (name !== undefined) return `${manufacturer} ${name}`;

  return null;
};

export const queryFromIdentifiers = (
  identifiers: CoreParsedIdentifiers,
  validatedGtin: string | null,
): string | null =>
  buildWebEvidenceQuery({
    validatedGtin,
    manufacturerTokens: identifiers.manufacturerTokens,
    partNumberCandidates: identifiers.partNumberCandidates,
    nameFragments: identifiers.nameFragments,
  });

// ---- Address safety -------------------------------------------------------

/** Called only after `isIPv4` has already confirmed four 0-255 octets. */
const isDisallowedIPv4 = (address: string): boolean => {
  const [a, b] = address.split(".").map(Number) as [number, number, number, number];

  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC 1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT, RFC 6598
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, includes the 169.254.169.254 metadata service
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a >= 224) return true; // multicast and reserved

  return false;
};

/**
 * Parses the 8 16-bit groups of an IPv6 address, expanding `::`. Exported, in
 * addition to `isDisallowedAddress`, so this hand-rolled parser's own
 * malformed-input handling is verified directly: `node:net`'s `isIPv6`
 * happens to reject everything that would trip these branches today, but a
 * parsing bug here — accepting something `isIPv6` didn't, or expanding it
 * wrongly — is exactly the class of SSRF bypass this module exists to catch,
 * so it is not tested only through that gate.
 */
export const parseIPv6Groups = (address: string): readonly number[] | null => {
  const withoutZone = address.split("%")[0]!;
  const halves = withoutZone.split("::");
  if (halves.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (side === "") return [];
    const parts = side.split(":");
    const groups: number[] = [];
    for (const part of parts) {
      if (part.includes(".")) {
        // Trailing embedded IPv4, e.g. ::ffff:169.254.169.254.
        const ipv4 = part.split(".").map(Number);
        if (ipv4.length !== 4 || ipv4.some((value) => Number.isNaN(value))) return null;
        const [i0, i1, i2, i3] = ipv4 as [number, number, number, number];
        groups.push((i0 << 8) | i1, (i2 << 8) | i3);
        continue;
      }
      const value = Number.parseInt(part, 16);
      if (Number.isNaN(value) || value < 0 || value > 0xffff) return null;
      groups.push(value);
    }
    return groups;
  };

  if (halves.length === 1) {
    const groups = parseSide(halves[0]!);
    return groups !== null && groups.length === 8 ? groups : null;
  }

  const left = parseSide(halves[0]!);
  const right = parseSide(halves[1]!);
  if (left === null || right === null) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  return [...left, ...new Array<number>(missing).fill(0), ...right];
};

const isDisallowedIPv6 = (address: string): boolean => {
  const groups = parseIPv6Groups(address);
  if (groups === null || groups.length !== 8) return true;
  const [first, second, third, fourth, fifth, sixth] = groups as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  if (groups.every((group, index) => (index < 7 ? group === 0 : true)) && groups[7] === 1) {
    return true; // ::1 loopback
  }
  if (groups.every((group) => group === 0)) return true; // :: unspecified
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (
    first === 0 &&
    second === 0 &&
    third === 0 &&
    fourth === 0 &&
    fifth === 0 &&
    sixth === 0xffff
  ) {
    // ::ffff:a.b.c.d, an IPv4-mapped address — the embedded address governs.
    const embedded = groups.slice(6, 8) as [number, number];
    const ipv4 = `${String(embedded[0] >> 8)}.${String(embedded[0] & 0xff)}.${String(embedded[1] >> 8)}.${String(embedded[1] & 0xff)}`;
    return isDisallowedIPv4(ipv4);
  }

  return false;
};

/** True when the address must never be connected to. */
export const isDisallowedAddress = (address: string): boolean => {
  if (isIPv4(address)) return isDisallowedIPv4(address);
  if (isIPv6(address)) return isDisallowedIPv6(address);
  return true; // Not a literal address at all — refuse rather than guess.
};

// ---- Safe fetch -------------------------------------------------------

export class WebFetchRefusedError extends Error {
  public constructor(reason: string) {
    super(reason);
    this.name = "WebFetchRefusedError";
  }
}

export interface SafeFetchOptions {
  readonly maxRedirects: number;
  readonly maxBytes: number;
  readonly timeoutMilliseconds: number;
  readonly allowedContentTypes: readonly string[];
  /** Trusts an additional CA, for tests against a local server only —
   * production destinations rely on the platform's default trust store. */
  readonly ca?: string | Buffer;
  /** Overrides the address check, for tests against a local server only —
   * every real caller relies on the exported default. */
  readonly isAddressDisallowed?: (address: string) => boolean;
}

export interface SafeFetchResult {
  readonly url: string;
  readonly contentType: string;
  readonly body: Buffer;
}

/**
 * Resolves the hostname, refuses if any resolved address is disallowed, and
 * connects to the specific validated address — never trusting a second DNS
 * lookup to return the same thing, which is exactly what a DNS-rebinding
 * attack relies on. Every redirect target is validated the same way, up to
 * `maxRedirects`, and only `https:` is ever followed.
 */
export const safeFetch = async (
  targetUrl: string,
  options: SafeFetchOptions,
): Promise<SafeFetchResult> => {
  let current = new URL(targetUrl);

  for (let redirectsFollowed = 0; ; redirectsFollowed += 1) {
    if (current.protocol !== "https:") {
      throw new WebFetchRefusedError(`Refusing a non-HTTPS destination: ${current.protocol}`);
    }
    if (current.username !== "" || current.password !== "") {
      throw new WebFetchRefusedError("Refusing a URL that carries credentials.");
    }

    const addressIsDisallowed = options.isAddressDisallowed ?? isDisallowedAddress;
    const addresses = await dnsLookup(current.hostname, { all: true }).catch(() => []);
    if (addresses.length === 0) {
      throw new WebFetchRefusedError(`Could not resolve ${current.hostname}.`);
    }
    if (addresses.some(({ address }) => addressIsDisallowed(address))) {
      throw new WebFetchRefusedError(`${current.hostname} resolves to a disallowed address.`);
    }

    // addresses.length === 0 was already refused above.
    const pinnedAddress = addresses[0]!.address;

    const response = await requestOnce(current, pinnedAddress, options);

    if (
      response.statusCode >= 300 &&
      response.statusCode < 400 &&
      response.location !== undefined
    ) {
      if (redirectsFollowed >= options.maxRedirects) {
        throw new WebFetchRefusedError("Too many redirects.");
      }
      current = new URL(response.location, current);
      continue;
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new WebFetchRefusedError(`Unexpected status ${String(response.statusCode)}.`);
    }

    const contentType = response.contentType.split(";")[0]!.trim();
    if (!options.allowedContentTypes.includes(contentType)) {
      throw new WebFetchRefusedError(`Refusing content type "${contentType}".`);
    }

    return { url: current.toString(), contentType, body: response.body };
  }
};

interface RawResponse {
  readonly statusCode: number;
  readonly contentType: string;
  readonly location: string | undefined;
  readonly body: Buffer;
}

// content-type and location are never split across repeated header lines by
// Node's HTTP client — unlike set-cookie, duplicates of either are folded
// into one value before this code ever sees them.
const firstHeaderValue = (value: string | string[] | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

/**
 * One request to one already-validated IP address. `servername`/the `Host`
 * header stay the original hostname so TLS certificate validation and
 * virtual hosting both still work — only the socket's destination is pinned.
 */
const requestOnce = (url: URL, address: string, options: SafeFetchOptions): Promise<RawResponse> =>
  new Promise<RawResponse>((resolve, reject) => {
    const request = https.request(
      {
        host: address,
        servername: url.hostname,
        port: url.port === "" ? 443 : Number(url.port),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { host: url.hostname, accept: "text/html,application/ld+json,application/json" },
        timeout: options.timeoutMilliseconds,
        ...(options.ca === undefined ? {} : { ca: options.ca }),
      },
      (response) => {
        // Always set by the time this callback runs, for a client response.
        const statusCode = response.statusCode!;
        const contentType = firstHeaderValue(response.headers["content-type"]) ?? "";
        const location = firstHeaderValue(response.headers.location);

        const chunks: Buffer[] = [];
        let receivedBytes = 0;
        let settled = false;

        response.on("data", (chunk: Buffer) => {
          receivedBytes += chunk.length;
          if (receivedBytes > options.maxBytes) {
            settled = true;
            request.destroy();
            reject(new WebFetchRefusedError("Response exceeded the byte limit."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          if (settled) return;
          resolve({ statusCode, contentType, location, body: Buffer.concat(chunks) });
        });
        response.on("error", (error: Error) => {
          if (settled) return;
          settled = true;
          reject(error);
        });
      },
    );

    request.on("timeout", () => {
      request.destroy(new WebFetchRefusedError("Request timed out."));
    });
    request.on("error", (error: Error) => {
      reject(
        error instanceof WebFetchRefusedError ? error : new WebFetchRefusedError(error.message),
      );
    });
    request.end();
  });

// ---- Brave Search ----------------------------------------------------

const BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search";
const MAX_SEARCH_RESULTS = 5;
const MAX_PAGE_FETCHES = 2;

export interface WebSearchResult {
  readonly title: string;
  readonly snippet: string;
  readonly url: string;
}

/**
 * Brave's own API endpoint is fixed and first-party, not a target chosen by
 * OCR text or search results — it does not go through `safeFetch`. Only the
 * result pages that come back from it do.
 */
export const braveSearch = async (
  apiKey: string,
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<readonly WebSearchResult[]> => {
  const url = new URL(BRAVE_API_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(MAX_SEARCH_RESULTS));

  const response = await fetchImpl(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
  });
  if (!response.ok) return [];

  const json: unknown = await response.json().catch(() => null);
  if (typeof json !== "object" || json === null || !("web" in json)) return [];
  const web = (json as { web?: unknown }).web;
  if (typeof web !== "object" || web === null || !("results" in web)) return [];
  const results = (web as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];

  const parsed: WebSearchResult[] = [];
  for (const entry of results.slice(0, MAX_SEARCH_RESULTS)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { title, description, url: resultUrl } = entry as Record<string, unknown>;
    if (typeof title !== "string" || typeof resultUrl !== "string") continue;
    parsed.push({
      title,
      snippet: typeof description === "string" ? description : "",
      url: resultUrl,
    });
  }
  return parsed;
};

// ---- JSON-LD-first extraction ------------------------------------------

const JSON_LD_SCRIPT_PATTERN =
  /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu;

/** Every well-formed JSON-LD block on the page, malformed ones skipped. */
export const extractJsonLd = (html: string): readonly unknown[] => {
  const blocks: unknown[] = [];
  for (const match of html.matchAll(JSON_LD_SCRIPT_PATTERN)) {
    // The pattern's one capturing group always participates in a match.
    const raw = match[1]!;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // A page with malformed structured data contributes nothing, not an error.
    }
  }
  return blocks;
};

// ---- Orchestration ------------------------------------------------------

export interface PageEvidence {
  readonly url: string;
  readonly jsonLd: readonly unknown[];
}

export interface WebEvidenceOutcome {
  readonly outcome: "Succeeded" | "NotApplicable" | "Unavailable";
  readonly query: string | null;
  readonly results: readonly WebSearchResult[];
  readonly pages: readonly PageEvidence[];
}

export interface WebEvidenceOptions {
  readonly braveApiKey: string | undefined;
  readonly fetchTimeoutMilliseconds: number;
  /** Trusts an additional CA when fetching result pages, for tests against a
   * local server only — see `SafeFetchOptions.ca`. */
  readonly ca?: string | Buffer;
  /** Overrides the address check when fetching result pages, for tests
   * against a local server only — see `SafeFetchOptions.isAddressDisallowed`. */
  readonly isAddressDisallowed?: (address: string) => boolean;
}

const DEFAULT_SAFE_FETCH_OPTIONS: SafeFetchOptions = {
  maxRedirects: 3,
  maxBytes: 2 * 1024 * 1024,
  timeoutMilliseconds: 5_000,
  allowedContentTypes: ["text/html", "application/json", "application/ld+json"],
};

/**
 * Runs for every non-barcode session (section 7.8) but never fails the
 * session: a missing API key, no strong query, or a refused/unreachable page
 * all resolve to bounded evidence rather than an error the caller must
 * handle specially.
 */
export const gatherWebEvidence = async (
  queryInput: WebEvidenceQueryInput,
  options: WebEvidenceOptions,
): Promise<WebEvidenceOutcome> => {
  const query = buildWebEvidenceQuery(queryInput);
  if (query === null) return { outcome: "NotApplicable", query: null, results: [], pages: [] };
  if (options.braveApiKey === undefined) {
    return { outcome: "Unavailable", query, results: [], pages: [] };
  }

  const results = await braveSearch(options.braveApiKey, query);

  const pages: PageEvidence[] = [];
  for (const result of results.slice(0, MAX_PAGE_FETCHES)) {
    const fetched = await safeFetch(result.url, {
      ...DEFAULT_SAFE_FETCH_OPTIONS,
      timeoutMilliseconds: options.fetchTimeoutMilliseconds,
      ...(options.ca === undefined ? {} : { ca: options.ca }),
      ...(options.isAddressDisallowed === undefined
        ? {}
        : { isAddressDisallowed: options.isAddressDisallowed }),
    }).catch(() => null);
    if (fetched === null) continue;
    pages.push({ url: fetched.url, jsonLd: extractJsonLd(fetched.body.toString("utf8")) });
  }

  return { outcome: "Succeeded", query, results, pages };
};
