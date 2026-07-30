import { describe, expect, it } from "vitest";

import {
  capabilityGroups,
  capabilityKeys,
  permissionCatalogue,
  PERMISSION_CATALOGUE_VERSION,
} from "../src/identity/capabilities";

describe("permission catalogue V1", () => {
  it("publishes the locked, unique 61-capability catalogue", () => {
    expect(PERMISSION_CATALOGUE_VERSION).toBe(1);
    expect(permissionCatalogue.version).toBe(1);
    expect(capabilityKeys).toHaveLength(61);
    expect(new Set(capabilityKeys)).toHaveProperty("size", 61);
    expect(permissionCatalogue.capabilities.map(({ key }) => key)).toEqual(capabilityKeys);
  });

  it("assigns every capability to its prefix group", () => {
    expect(new Set(permissionCatalogue.capabilities.map(({ group }) => group))).toEqual(
      new Set(capabilityGroups),
    );

    for (const capability of permissionCatalogue.capabilities) {
      expect(capability.key.startsWith(`${capability.group}.`)).toBe(true);
    }
  });

  it("exposes immutable catalogue metadata", () => {
    expect(Object.isFrozen(permissionCatalogue)).toBe(true);
    expect(Object.isFrozen(permissionCatalogue.capabilities)).toBe(true);
    expect(permissionCatalogue.capabilities.every(Object.isFrozen)).toBe(true);
  });
});
