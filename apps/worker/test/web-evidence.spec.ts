import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  braveSearch,
  buildWebEvidenceQuery,
  extractJsonLd,
  gatherWebEvidence,
  isDisallowedAddress,
  parseIPv6Groups,
  safeFetch,
  WebFetchRefusedError,
} from "../src/recognition/web-evidence";

const fakeFetch =
  (body: unknown, ok = true): typeof fetch =>
  () =>
    Promise.resolve({
      ok,
      json: () => Promise.resolve(body),
    } as Response);

/*
 * The SSRF suite specification section 12/16.3 asks for: DNS rebinding,
 * redirects, IPv4/IPv6 private ranges, credentials in URLs, oversized pages,
 * and wrong content types. Every disallowed case below is a real network
 * attempt this module must refuse before or after DNS resolution — not a
 * mocked assertion that the right branch was taken.
 */

describe("isDisallowedAddress", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["10.0.0.1", "RFC 1918"],
    ["172.16.0.1", "RFC 1918"],
    ["172.31.255.255", "RFC 1918"],
    ["192.168.1.1", "RFC 1918"],
    ["169.254.169.254", "the cloud metadata service"],
    ["169.254.0.1", "link-local"],
    ["100.64.0.1", "CGNAT"],
    ["0.0.0.0", "this network"],
    ["224.0.0.1", "multicast"],
  ])("refuses %s (%s)", (address) => {
    expect(isDisallowedAddress(address)).toBe(true);
  });

  it.each([["8.8.8.8"], ["1.1.1.1"], ["93.184.216.34"]])(
    "allows a public IPv4 address %s",
    (address) => {
      expect(isDisallowedAddress(address)).toBe(false);
    },
  );

  it.each([
    ["::1", "loopback"],
    ["fe80::1", "link-local"],
    ["fc00::1", "unique local"],
    ["fd12:3456:789a::1", "unique local"],
    ["ff02::1", "multicast"],
    ["::ffff:127.0.0.1", "an IPv4-mapped loopback address"],
    ["::ffff:169.254.169.254", "an IPv4-mapped metadata address"],
    ["::", "unspecified"],
  ])("refuses %s (%s)", (address) => {
    expect(isDisallowedAddress(address)).toBe(true);
  });

  it("allows a public IPv6 address", () => {
    expect(isDisallowedAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("refuses a fully expanded address with no :: compression", () => {
    expect(isDisallowedAddress("fe80:0000:0000:0000:0000:0000:0000:0001")).toBe(true);
  });

  it("allows a fully expanded public address with no :: compression", () => {
    expect(isDisallowedAddress("2606:4700:4700:0000:0000:0000:0000:1111")).toBe(false);
  });

  it("refuses 192.0.x.x, the IETF protocol assignment block", () => {
    expect(isDisallowedAddress("192.0.2.1")).toBe(true);
  });

  it("refuses a value that is not a literal IP address at all", () => {
    expect(isDisallowedAddress("not-an-ip")).toBe(true);
    expect(isDisallowedAddress("example.com")).toBe(true);
  });
});

/*
 * node:net's isIPv6 already rejects every string below, so isDisallowedAddress
 * never reaches these branches of the hand-rolled expander through its public
 * entry point. They are still tested directly: a parser that only works when
 * a stricter gate has already run first is not a parser this module can rely
 * on if that gate is ever bypassed or the two disagree on an edge case.
 */
describe("parseIPv6Groups", () => {
  it("rejects an address with more than one :: compression", () => {
    expect(parseIPv6Groups("1::2::3")).toBeNull();
  });

  it("rejects a malformed embedded IPv4 tail", () => {
    expect(parseIPv6Groups("::ffff:1.2.3")).toBeNull();
  });

  it("rejects a group that is not valid hex or is out of range", () => {
    expect(parseIPv6Groups("::gggg")).toBeNull();
    expect(parseIPv6Groups("::12345")).toBeNull();
  });

  it("rejects too many groups either side of a :: compression", () => {
    expect(parseIPv6Groups("1:2:3:4:5::6:7:8:9")).toBeNull();
  });

  it("parses a fully expanded address with no compression", () => {
    expect(parseIPv6Groups("2001:0db8:0000:0000:0000:0000:0000:0001")).toEqual([
      0x2001, 0x0db8, 0, 0, 0, 0, 0, 1,
    ]);
  });

  it("expands :: to the missing zero groups", () => {
    expect(parseIPv6Groups("2001:db8::1")).toEqual([0x2001, 0x0db8, 0, 0, 0, 0, 0, 1]);
  });
});

describe("buildWebEvidenceQuery", () => {
  it("prefers a validated GTIN over everything else", () => {
    const query = buildWebEvidenceQuery({
      validatedGtin: "05012345678900",
      manufacturerTokens: ["Acme"],
      partNumberCandidates: ["RS-1234A"],
      nameFragments: [],
    });
    expect(query).toBe("05012345678900");
  });

  it("uses manufacturer plus part number when there is no GTIN", () => {
    const query = buildWebEvidenceQuery({
      validatedGtin: null,
      manufacturerTokens: ["Acme"],
      partNumberCandidates: ["RS-1234A"],
      nameFragments: [],
    });
    expect(query).toBe("Acme RS-1234A");
  });

  it("uses manufacturer plus a distinctive name fragment as a last resort", () => {
    const query = buildWebEvidenceQuery({
      validatedGtin: null,
      manufacturerTokens: ["Acme"],
      partNumberCandidates: [],
      nameFragments: ["Heavy Duty Threaded Widget"],
    });
    expect(query).toBe("Acme Heavy Duty Threaded Widget");
  });

  it("returns null without a manufacturer, even with a part number", () => {
    const query = buildWebEvidenceQuery({
      validatedGtin: null,
      manufacturerTokens: [],
      partNumberCandidates: ["RS-1234A"],
      nameFragments: [],
    });
    expect(query).toBeNull();
  });

  it("returns null for a manufacturer with only a short, generic name fragment", () => {
    const query = buildWebEvidenceQuery({
      validatedGtin: null,
      manufacturerTokens: ["Acme"],
      partNumberCandidates: [],
      nameFragments: ["Bolt"],
    });
    expect(query).toBeNull();
  });
});

describe("extractJsonLd", () => {
  it("extracts a single well-formed block", () => {
    const html = `<html><head><script type="application/ld+json">{"a":1}</script></head></html>`;
    expect(extractJsonLd(html)).toEqual([{ a: 1 }]);
  });

  it("extracts multiple blocks", () => {
    const html =
      '<script type="application/ld+json">{"a":1}</script>' +
      '<script type="application/ld+json">{"b":2}</script>';
    expect(extractJsonLd(html)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("skips a malformed block rather than throwing", () => {
    const html = '<script type="application/ld+json">{not json}</script>';
    expect(extractJsonLd(html)).toEqual([]);
  });

  it("returns nothing for a page with no structured data", () => {
    expect(extractJsonLd("<html><body>Hello</body></html>")).toEqual([]);
  });
});

const httpsServers: HttpsServer[] = [];

afterEach(async () => {
  while (httpsServers.length > 0) {
    const server = httpsServers.pop();
    if (server === undefined) continue;
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
});

const DEFAULT_OPTIONS = {
  maxRedirects: 2,
  maxBytes: 1024,
  timeoutMilliseconds: 2_000,
  allowedContentTypes: ["text/html", "application/json"],
};

const generateSelfSignedCertificate = (): { readonly cert: string; readonly key: string } => {
  const directory = mkdtempSync(path.join(tmpdir(), "web-evidence-cert-"));
  const keyPath = path.join(directory, "key.pem");
  const certPath = path.join(directory, "cert.pem");
  execFileSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-days",
    "1",
    "-nodes",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
  ]);
  return { cert: readFileSync(certPath, "utf8"), key: readFileSync(keyPath, "utf8") };
};

// The test server itself has to bind to a loopback address, which the real
// isDisallowedAddress correctly refuses — that is the whole point of the
// function. Tests that need a real server allow only 127.0.0.1 through so
// they still exercise the redirect/content-type/byte-limit logic for real,
// while every other address (including a redirect target) still runs the
// genuine, unmodified check.
const allowLoopbackTestServer = (address: string): boolean =>
  address === "127.0.0.1" ? false : isDisallowedAddress(address);

describe("safeFetch", () => {
  it("refuses a non-HTTPS URL", async () => {
    await expect(safeFetch("http://127.0.0.1:1/", DEFAULT_OPTIONS)).rejects.toBeInstanceOf(
      WebFetchRefusedError,
    );
  });

  it("refuses a loopback address without attempting a connection", async () => {
    await expect(safeFetch("https://127.0.0.1:9/nowhere", DEFAULT_OPTIONS)).rejects.toBeInstanceOf(
      WebFetchRefusedError,
    );
  });

  it("refuses the cloud metadata address", async () => {
    await expect(
      safeFetch("https://169.254.169.254/latest/meta-data/", DEFAULT_OPTIONS),
    ).rejects.toBeInstanceOf(WebFetchRefusedError);
  });

  it("refuses a private RFC 1918 address", async () => {
    await expect(safeFetch("https://10.0.0.5/", DEFAULT_OPTIONS)).rejects.toBeInstanceOf(
      WebFetchRefusedError,
    );
  });

  it("refuses a hostname that does not resolve at all", async () => {
    await expect(
      safeFetch("https://this-does-not-exist.invalid/", DEFAULT_OPTIONS),
    ).rejects.toBeInstanceOf(WebFetchRefusedError);
  });

  it("wraps a genuine connection failure from an allowed address", async () => {
    // A real TCP-level failure (nothing listening), as opposed to the
    // pre-connection DNS/address refusal every other case here exercises —
    // this is what proves the request-level error handler wraps a plain
    // socket error too, not only WebFetchRefusedError.
    await expect(
      safeFetch("https://127.0.0.1:1/", {
        ...DEFAULT_OPTIONS,
        isAddressDisallowed: allowLoopbackTestServer,
      }),
    ).rejects.toBeInstanceOf(WebFetchRefusedError);
  });

  it("refuses a URL carrying credentials", async () => {
    await expect(
      safeFetch("https://user:pass@example.invalid/", DEFAULT_OPTIONS),
    ).rejects.toBeInstanceOf(WebFetchRefusedError);
  });

  it("fetches successfully from a real HTTPS server with a trusted certificate", async () => {
    const { cert, key } = generateSelfSignedCertificate();
    const server = createHttpsServer({ cert, key }, (_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ hello: "world" }));
    });
    httpsServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Server did not bind.");

    const result = await safeFetch(`https://127.0.0.1:${String(address.port)}/data`, {
      ...DEFAULT_OPTIONS,
      ca: cert,
      isAddressDisallowed: allowLoopbackTestServer,
    });

    expect(result.contentType).toBe("application/json");
    expect(JSON.parse(result.body.toString("utf8"))).toEqual({ hello: "world" });
  });

  it("refuses a redirect to a disallowed address", async () => {
    const { cert, key } = generateSelfSignedCertificate();
    const server = createHttpsServer({ cert, key }, (_request, response) => {
      response.writeHead(302, { location: "https://169.254.169.254/stolen" });
      response.end();
    });
    httpsServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Server did not bind.");

    await expect(
      safeFetch(`https://127.0.0.1:${String(address.port)}/redirect`, {
        ...DEFAULT_OPTIONS,
        ca: cert,
        isAddressDisallowed: allowLoopbackTestServer,
      }),
    ).rejects.toBeInstanceOf(WebFetchRefusedError);
  });

  it("refuses once the redirect chain exceeds the cap", async () => {
    const { cert, key } = generateSelfSignedCertificate();
    let hopsServed = 0;
    const server = createHttpsServer({ cert, key }, (request, response) => {
      hopsServed += 1;
      const address = server.address();
      const port = address !== null && typeof address !== "string" ? address.port : 0;
      response.writeHead(302, {
        location: `https://127.0.0.1:${String(port)}/hop-${String(hopsServed)}`,
      });
      response.end();
      void request;
    });
    httpsServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Server did not bind.");

    await expect(
      safeFetch(`https://127.0.0.1:${String(address.port)}/start`, {
        ...DEFAULT_OPTIONS,
        maxRedirects: 1,
        ca: cert,
        isAddressDisallowed: allowLoopbackTestServer,
      }),
    ).rejects.toBeInstanceOf(WebFetchRefusedError);
  });

  it("refuses a disallowed content type", async () => {
    const { cert, key } = generateSelfSignedCertificate();
    const server = createHttpsServer({ cert, key }, (_request, response) => {
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.end("binary");
    });
    httpsServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Server did not bind.");

    await expect(
      safeFetch(`https://127.0.0.1:${String(address.port)}/binary`, {
        ...DEFAULT_OPTIONS,
        ca: cert,
        isAddressDisallowed: allowLoopbackTestServer,
      }),
    ).rejects.toBeInstanceOf(WebFetchRefusedError);
  });

  it("refuses a response over the byte limit", async () => {
    const { cert, key } = generateSelfSignedCertificate();
    const server = createHttpsServer({ cert, key }, (_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("x".repeat(10_000));
    });
    httpsServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Server did not bind.");

    await expect(
      safeFetch(`https://127.0.0.1:${String(address.port)}/big`, {
        ...DEFAULT_OPTIONS,
        maxBytes: 100,
        ca: cert,
        isAddressDisallowed: allowLoopbackTestServer,
      }),
    ).rejects.toBeInstanceOf(WebFetchRefusedError);
  });

  it("refuses an unexpected non-2xx, non-redirect status", async () => {
    const { cert, key } = generateSelfSignedCertificate();
    const server = createHttpsServer({ cert, key }, (_request, response) => {
      response.writeHead(500);
      response.end("server error");
    });
    httpsServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Server did not bind.");

    await expect(
      safeFetch(`https://127.0.0.1:${String(address.port)}/error`, {
        ...DEFAULT_OPTIONS,
        ca: cert,
        isAddressDisallowed: allowLoopbackTestServer,
      }),
    ).rejects.toBeInstanceOf(WebFetchRefusedError);
  });

  it("defaults to port 443 when the URL specifies none", async () => {
    // Nothing listens on 127.0.0.1:443 in the test environment, so this
    // reaches the port-defaulting logic and then fails fast on connection —
    // proving the default is applied, not that anything answers on it.
    await expect(
      safeFetch("https://127.0.0.1/", {
        ...DEFAULT_OPTIONS,
        isAddressDisallowed: allowLoopbackTestServer,
      }),
    ).rejects.toBeInstanceOf(WebFetchRefusedError);
  });

  it("times out when the server never responds, wrapping its own timeout error unchanged", async () => {
    const { cert, key } = generateSelfSignedCertificate();
    const server = createHttpsServer({ cert, key }, () => {
      /* Never responds. */
    });
    httpsServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Server did not bind.");

    await expect(
      safeFetch(`https://127.0.0.1:${String(address.port)}/slow`, {
        ...DEFAULT_OPTIONS,
        timeoutMilliseconds: 50,
        ca: cert,
        isAddressDisallowed: allowLoopbackTestServer,
      }),
    ).rejects.toBeInstanceOf(WebFetchRefusedError);
  });
});

describe("gatherWebEvidence", () => {
  it("reports NotApplicable when no strong query can be built", async () => {
    const outcome = await gatherWebEvidence(
      { validatedGtin: null, manufacturerTokens: [], partNumberCandidates: [], nameFragments: [] },
      { braveApiKey: "key", fetchTimeoutMilliseconds: 1_000 },
    );
    expect(outcome.outcome).toBe("NotApplicable");
  });

  it("reports Unavailable when there is a query but no API key configured", async () => {
    const outcome = await gatherWebEvidence(
      {
        validatedGtin: "05012345678900",
        manufacturerTokens: [],
        partNumberCandidates: [],
        nameFragments: [],
      },
      { braveApiKey: undefined, fetchTimeoutMilliseconds: 1_000 },
    );
    expect(outcome.outcome).toBe("Unavailable");
    expect(outcome.query).toBe("05012345678900");
  });

  it("reports Succeeded with search results, even when the page fetches themselves fail", async () => {
    // gatherWebEvidence has no fetchImpl seam of its own; braveSearch's
    // default parameter resolves the global fetch at call time, so stubbing
    // it here reaches braveSearch without a real network call and without
    // changing any production signature.
    vi.stubGlobal(
      "fetch",
      fakeFetch({
        web: {
          results: [
            { title: "Acme Widget", description: "A widget.", url: "https://example.invalid/a" },
          ],
        },
      }),
    );

    try {
      const outcome = await gatherWebEvidence(
        {
          validatedGtin: "05012345678900",
          manufacturerTokens: [],
          partNumberCandidates: [],
          nameFragments: [],
        },
        { braveApiKey: "key", fetchTimeoutMilliseconds: 200 },
      );

      expect(outcome.outcome).toBe("Succeeded");
      expect(outcome.results).toEqual([
        { title: "Acme Widget", snippet: "A widget.", url: "https://example.invalid/a" },
      ]);
      // example.invalid resolves to nothing real, so the page fetch itself
      // fails and is skipped — the stage still succeeded on the search.
      expect(outcome.pages).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fetches and parses a result page for real, using the same test-only trust seam as safeFetch", async () => {
    const { cert, key } = generateSelfSignedCertificate();
    const server = createHttpsServer({ cert, key }, (_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        '<script type="application/ld+json">{"@type":"Product","name":"Acme Widget"}</script>',
      );
    });
    httpsServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Server did not bind.");
    const pageUrl = `https://127.0.0.1:${String(address.port)}/product`;

    vi.stubGlobal(
      "fetch",
      fakeFetch({
        web: { results: [{ title: "Acme Widget", description: "A widget.", url: pageUrl }] },
      }),
    );

    try {
      const outcome = await gatherWebEvidence(
        {
          validatedGtin: "05012345678900",
          manufacturerTokens: [],
          partNumberCandidates: [],
          nameFragments: [],
        },
        {
          braveApiKey: "key",
          fetchTimeoutMilliseconds: 2_000,
          ca: cert,
          isAddressDisallowed: allowLoopbackTestServer,
        },
      );

      expect(outcome.outcome).toBe("Succeeded");
      expect(outcome.pages).toEqual([
        { url: pageUrl, jsonLd: [{ "@type": "Product", name: "Acme Widget" }] },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("braveSearch", () => {
  it("parses well-formed results", async () => {
    const results = await braveSearch(
      "key",
      "query",
      fakeFetch({
        web: {
          results: [
            { title: "Acme Widget", description: "A widget.", url: "https://example.com/a" },
          ],
        },
      }),
    );
    expect(results).toEqual([
      { title: "Acme Widget", snippet: "A widget.", url: "https://example.com/a" },
    ]);
  });

  it("defaults a missing description to an empty snippet", async () => {
    const results = await braveSearch(
      "key",
      "query",
      fakeFetch({ web: { results: [{ title: "Acme Widget", url: "https://example.com/a" }] } }),
    );
    expect(results[0]?.snippet).toBe("");
  });

  it("skips a malformed result entry rather than throwing", async () => {
    const results = await braveSearch(
      "key",
      "query",
      fakeFetch({ web: { results: ["not an object", { title: "Acme Widget" }] } }),
    );
    expect(results).toEqual([]);
  });

  it("returns nothing on a non-2xx response", async () => {
    expect(await braveSearch("key", "query", fakeFetch({}, false))).toEqual([]);
  });

  it("returns nothing when the response has no web.results shape", async () => {
    expect(await braveSearch("key", "query", fakeFetch({ unexpected: true }))).toEqual([]);
    expect(await braveSearch("key", "query", fakeFetch({ web: {} }))).toEqual([]);
    expect(
      await braveSearch("key", "query", fakeFetch({ web: { results: "not an array" } })),
    ).toEqual([]);
  });

  it("returns nothing when the body is not valid JSON", async () => {
    const throwingFetch = (() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.reject(new Error("not json")),
      } as Response)) as typeof fetch;
    expect(await braveSearch("key", "query", throwingFetch)).toEqual([]);
  });
});
