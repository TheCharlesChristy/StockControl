import type { MapLocationView } from "@stockcontrol/contracts";
import { geometryContains, geometryPartiallyOverlaps } from "@stockcontrol/module-locations";

export type MapRuleCode = "DuplicateCode" | "DuplicateGeometry" | "MissingName" | "PartialOverlap";

export interface MapRuleViolation {
  readonly code: MapRuleCode;
  readonly locationIds: readonly string[];
  readonly shortMessage: string;
  readonly message: string;
}

const label = (location: MapLocationView): string =>
  location.code.length > 0 ? `${location.name} (${location.code})` : location.name;

/**
 * Rules that can be checked while editing, before a save reaches the server.
 * Areas may touch, or be wholly nested, but their interiors may not partially
 * overlap. This keeps the derived hierarchy unambiguous.
 */
export const validateMapRules = (
  locations: readonly MapLocationView[],
): readonly MapRuleViolation[] => {
  const violations: MapRuleViolation[] = [];
  const seenCodes = new Map<string, MapLocationView>();

  for (const location of locations) {
    if (location.status === "Active" && location.name.trim().length === 0) {
      violations.push({
        code: "MissingName",
        locationIds: [location.id],
        shortMessage: `Missing name: ${label(location)}.`,
        message: "Every active location area needs a name.",
      });
    }
    if (location.code.length === 0) continue;
    const previous = seenCodes.get(location.code.toLocaleLowerCase("en-GB"));
    if (previous !== undefined) {
      violations.push({
        code: "DuplicateCode",
        locationIds: [previous.id, location.id],
        shortMessage: `Duplicate code: ${location.code}.`,
        message: `Location code ${location.code} is used by both ${label(previous)} and ${label(location)}.`,
      });
    } else {
      seenCodes.set(location.code.toLocaleLowerCase("en-GB"), location);
    }
  }

  const active = locations.filter((location) => location.status === "Active");
  for (let leftIndex = 0; leftIndex < active.length; leftIndex += 1) {
    const left = active[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < active.length; rightIndex += 1) {
      const right = active[rightIndex]!;
      const leftContainsRight = geometryContains(left.geometry, right.geometry);
      const rightContainsLeft = geometryContains(right.geometry, left.geometry);
      if (leftContainsRight && rightContainsLeft) {
        violations.push({
          code: "DuplicateGeometry",
          locationIds: [left.id, right.id],
          shortMessage: `Duplicate area: ${label(left)} / ${label(right)}.`,
          message: `${label(left)} and ${label(right)} occupy the same area. Move or resize one of them.`,
        });
      } else if (geometryPartiallyOverlaps(left.geometry, right.geometry)) {
        violations.push({
          code: "PartialOverlap",
          locationIds: [left.id, right.id],
          shortMessage: `${label(left)} partially overlaps ${label(right)}.`,
          message: `${label(left)} partially overlaps ${label(right)}. Areas must be separate or fully contained.`,
        });
      }
    }
  }

  return violations;
};
