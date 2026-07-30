import { describe, expect, it } from "vitest";

import { TOTP_POLICY, TotpService, createTotpProvisioningUri, generateHotp } from "../src/totp.js";
import { FixedClock, FixedRandomSource, IncrementingRandomSource } from "./helpers.js";

const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("RFC 4226 and RFC 6238 primitives", () => {
  it("matches every RFC 4226 HOTP test vector", () => {
    const expected = [
      "755224",
      "287082",
      "359152",
      "969429",
      "338314",
      "254676",
      "287922",
      "162583",
      "399871",
      "520489",
    ];
    expect(expected.map((_, counter) => generateHotp(RFC_SECRET, BigInt(counter)))).toEqual(
      expected,
    );
  });

  it("matches the RFC 6238 SHA-1 eight-digit vectors", () => {
    const vectors = [
      [59n, "94287082"],
      [1_111_111_109n, "07081804"],
      [1_111_111_111n, "14050471"],
      [1_234_567_890n, "89005924"],
      [2_000_000_000n, "69279037"],
      [20_000_000_000n, "65353130"],
    ] as const;
    for (const [timestamp, expected] of vectors) {
      expect(generateHotp(RFC_SECRET, timestamp / 30n, 8)).toBe(expected);
    }
  });

  it("normalizes readable secrets and bounds the RFC counter", () => {
    expect(generateHotp("gezd-gnbv gy3tqojq gezdgnbvgy3tqojq", 0n)).toBe("755224");
    expect(() => generateHotp(RFC_SECRET, -1n)).toThrow("unsigned 64-bit");
    expect(() => generateHotp(RFC_SECRET, 0x1_0000_0000_0000_0000n)).toThrow("unsigned 64-bit");
    expect(() => generateHotp("1".repeat(32), 0n)).toThrow("base32");
    expect(() => generateHotp("MY", 0n)).toThrow("16-64");
    expect(() => generateHotp("A".repeat(104), 0n)).toThrow("16-64");
    expect(() => generateHotp("A".repeat(25) + "B", 0n)).toThrow("padding bits");
    expect(() => generateHotp("A".repeat(257), 0n)).toThrow("too long");
  });
});

describe("TOTP enrolment and verification", () => {
  it("locks the StockControl TOTP policy to an interoperable narrow profile", () => {
    expect(TOTP_POLICY).toEqual({
      algorithm: "SHA1",
      digits: 6,
      periodSeconds: 30,
      secretBytes: 20,
      maximumVerificationWindow: 1,
    });
    expect(Object.isFrozen(TOTP_POLICY)).toBe(true);
  });

  it("builds a correctly escaped provisioning URI with no secret in logs or storage", () => {
    const uri = createTotpProvisioningUri(
      " Stock & Control ",
      " engineer+one@example.test ",
      RFC_SECRET,
    );
    expect(uri).toMatch(
      /^otpauth:\/\/totp\/Stock%20%26%20Control:engineer%2Bone%40example\.test\?/u,
    );
    const parsed = new URL(uri);
    expect(parsed.searchParams.get("secret")).toBe(RFC_SECRET);
    expect(parsed.searchParams.get("issuer")).toBe("Stock & Control");
    expect(parsed.searchParams.get("algorithm")).toBe("SHA1");
    expect(parsed.searchParams.get("digits")).toBe("6");
    expect(parsed.searchParams.get("period")).toBe("30");
  });

  it("issues deterministic one-time enrollment material", () => {
    const service = new TotpService(new FixedClock(new Date(0)), new IncrementingRandomSource());
    const enrollment = service.issueEnrollment("StockControl", "admin@example.test");
    expect(enrollment.secret).toBe("AAAQEAYEAUDAOCAJBIFQYDIOB4IBCEQT");
    expect(enrollment.provisioningUri).toContain(`secret=${enrollment.secret}`);
  });

  it("validates labels, secrets, entropy, and verification windows", () => {
    expect(() => createTotpProvisioningUri("", "account", RFC_SECRET)).toThrow("Issuer");
    expect(() => createTotpProvisioningUri("issuer", " ", RFC_SECRET)).toThrow("Account");
    expect(() => createTotpProvisioningUri("a".repeat(201), "account", RFC_SECRET)).toThrow(
      "Issuer",
    );
    expect(() => createTotpProvisioningUri("a".repeat(401), "account", RFC_SECRET)).toThrow(
      "Issuer",
    );
    expect(() =>
      new TotpService(
        new FixedClock(new Date(0)),
        new FixedRandomSource(new Uint8Array(19)),
      ).issueEnrollment("issuer", "account"),
    ).toThrow("expected 20");
    expect(
      () => new TotpService(new FixedClock(new Date(0)), new IncrementingRandomSource(), -1 as 0),
    ).toThrow("window");
    expect(
      () => new TotpService(new FixedClock(new Date(0)), new IncrementingRandomSource(), 2 as 1),
    ).toThrow("window");
  });

  it("accepts current, previous, and next counters within the one-step window", () => {
    const currentCounter = 100n;
    const service = new TotpService(
      new FixedClock(new Date(Number(currentCounter) * 30_000)),
      new IncrementingRandomSource(),
    );

    expect(service.verify({ secret: RFC_SECRET, code: generateHotp(RFC_SECRET, 100n) })).toEqual({
      valid: true,
      counter: 100n,
    });
    expect(service.verify({ secret: RFC_SECRET, code: generateHotp(RFC_SECRET, 99n) })).toEqual({
      valid: true,
      counter: 99n,
    });
    expect(service.verify({ secret: RFC_SECRET, code: generateHotp(RFC_SECRET, 101n) })).toEqual({
      valid: true,
      counter: 101n,
    });
    expect(service.verify({ secret: RFC_SECRET, code: generateHotp(RFC_SECRET, 98n) })).toEqual({
      valid: false,
      reason: "invalid",
    });
  });

  it("can require an exact counter and rejects malformed codes without using the secret", () => {
    const service = new TotpService(
      new FixedClock(new Date(3_000_000)),
      new IncrementingRandomSource(),
      0,
    );
    expect(service.verify({ secret: RFC_SECRET, code: generateHotp(RFC_SECRET, 99n) })).toEqual({
      valid: false,
      reason: "invalid",
    });
    expect(service.verify({ secret: "not-a-secret", code: "12345" })).toEqual({
      valid: false,
      reason: "invalid",
    });
  });

  it("returns a counter for atomic replay prevention", () => {
    const service = new TotpService(
      new FixedClock(new Date(3_000_000)),
      new IncrementingRandomSource(),
    );
    const currentCode = generateHotp(RFC_SECRET, 100n);
    const previousCode = generateHotp(RFC_SECRET, 99n);

    expect(
      service.verify({
        secret: RFC_SECRET,
        code: currentCode,
        lastAcceptedCounter: 100n,
      }),
    ).toEqual({ valid: false, reason: "replayed" });
    expect(
      service.verify({
        secret: RFC_SECRET,
        code: previousCode,
        lastAcceptedCounter: 99n,
      }),
    ).toEqual({ valid: false, reason: "replayed" });
    expect(
      service.verify({
        secret: RFC_SECRET,
        code: generateHotp(RFC_SECRET, 101n),
        lastAcceptedCounter: 100n,
      }),
    ).toEqual({ valid: true, counter: 101n });
    expect(() =>
      service.verify({
        secret: RFC_SECRET,
        code: currentCode,
        lastAcceptedCounter: -1n,
      }),
    ).toThrow("unsigned 64-bit");
    expect(() =>
      service.verify({
        secret: RFC_SECRET,
        code: currentCode,
        lastAcceptedCounter: 0x1_0000_0000_0000_0000n,
      }),
    ).toThrow("unsigned 64-bit");
  });

  it("handles the first counter without evaluating a negative window", () => {
    const service = new TotpService(new FixedClock(new Date(0)), new IncrementingRandomSource());
    expect(service.verify({ secret: RFC_SECRET, code: "000000" })).toEqual({
      valid: false,
      reason: "invalid",
    });
  });

  it("rejects invalid or pre-epoch clocks", () => {
    const invalid = new TotpService(
      new FixedClock(new Date(Number.NaN)),
      new IncrementingRandomSource(),
    );
    expect(() => invalid.verify({ secret: RFC_SECRET, code: "000000" })).toThrow("invalid date");
    const preEpoch = new TotpService(new FixedClock(new Date(-1)), new IncrementingRandomSource());
    expect(() => preEpoch.verify({ secret: RFC_SECRET, code: "000000" })).toThrow("invalid date");
  });
});
