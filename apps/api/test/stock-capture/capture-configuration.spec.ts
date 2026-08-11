import { describe, expect, it } from "vitest";

import {
  isStockCaptureEnabled,
  loadStockCaptureConfiguration,
} from "../../src/stock-capture/capture-configuration";

describe("assisted stock capture feature flag", () => {
  it("is off when nothing is configured", () => {
    expect(isStockCaptureEnabled({})).toBe(false);
  });

  /*
   * An existing installation must not gain this feature from a nearby typo:
   * only the word "true" turns it on, whatever else was set nearby.
   */
  it.each(["1", "yes", "on", " ", "false", "enabled"])(
    "treats %j as off, not just an explicit false",
    (value) => {
      expect(isStockCaptureEnabled({ STOCK_CAPTURE_ENABLED: value })).toBe(false);
    },
  );

  it("accepts the word true regardless of case or surrounding whitespace", () => {
    expect(isStockCaptureEnabled({ STOCK_CAPTURE_ENABLED: "true" })).toBe(true);
    expect(isStockCaptureEnabled({ STOCK_CAPTURE_ENABLED: "TRUE" })).toBe(true);
    expect(isStockCaptureEnabled({ STOCK_CAPTURE_ENABLED: "  true  " })).toBe(true);
  });
});

describe("assisted stock capture configuration", () => {
  it("uses conservative defaults when nothing is set", () => {
    expect(loadStockCaptureConfiguration({})).toEqual({
      enabled: false,
      uploadGrantSeconds: 600,
      sessionLifetimeSeconds: 6 * 60 * 60,
      recognitionMaxAttempts: 3,
    });
  });

  it("reads every configured number", () => {
    expect(
      loadStockCaptureConfiguration({
        STOCK_CAPTURE_ENABLED: "true",
        STOCK_CAPTURE_UPLOAD_GRANT_SECONDS: "120",
        STOCK_CAPTURE_SESSION_LIFETIME_SECONDS: "3600",
        STOCK_CAPTURE_MAX_ATTEMPTS: "5",
      }),
    ).toEqual({
      enabled: true,
      uploadGrantSeconds: 120,
      sessionLifetimeSeconds: 3_600,
      recognitionMaxAttempts: 5,
    });
  });

  it("refuses a non-integer value rather than silently defaulting", () => {
    expect(() =>
      loadStockCaptureConfiguration({ STOCK_CAPTURE_UPLOAD_GRANT_SECONDS: "soon" }),
    ).toThrow(/positive integer/u);
    expect(() => loadStockCaptureConfiguration({ STOCK_CAPTURE_MAX_ATTEMPTS: "0" })).toThrow(
      /positive integer/u,
    );
  });

  /*
   * A session that outlives its photographs would offer suggestions nobody
   * can act on, and would quietly ask the janitor to keep objects past the
   * 24-hour deadline the privacy notice promises.
   */
  it("refuses a session lifetime longer than the 24-hour photograph deadline", () => {
    expect(() =>
      loadStockCaptureConfiguration({
        STOCK_CAPTURE_SESSION_LIFETIME_SECONDS: String(25 * 60 * 60),
      }),
    ).toThrow(/24-hour limit/u);
  });

  it("accepts a session lifetime exactly at the 24-hour limit", () => {
    expect(
      loadStockCaptureConfiguration({
        STOCK_CAPTURE_SESSION_LIFETIME_SECONDS: String(24 * 60 * 60),
      }).sessionLifetimeSeconds,
    ).toBe(24 * 60 * 60);
  });
});
