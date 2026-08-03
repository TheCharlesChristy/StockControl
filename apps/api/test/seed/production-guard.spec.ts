import { describe, expect, it } from "vitest";

import { assertDemoSeedAllowed, DemoSeedDisabledError } from "../../src/seed/production-guard";

describe("demo seed production guard", () => {
  it.each(["production", " PRODUCTION "])('rejects NODE_ENV="%s"', (nodeEnvironment) => {
    expect(() => assertDemoSeedAllowed({ NODE_ENV: nodeEnvironment })).toThrow(
      DemoSeedDisabledError,
    );
  });

  it.each([undefined, "", "development", "test"])(
    'allows NODE_ENV="%s" for deliberate non-production use',
    (nodeEnvironment) => {
      expect(() => assertDemoSeedAllowed({ NODE_ENV: nodeEnvironment })).not.toThrow();
    },
  );
});
