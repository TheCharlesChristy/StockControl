/**
 * What erasing a shape from the map should mean for the location behind it. A
 * location that holds stock, or that any transaction still points at, keeps its
 * identity so the ledger stays readable; anything never used simply goes.
 *
 * Nothing here worries about what was drawn inside the shape: with containment
 * derived from geometry, those locations simply re-derive their parent from
 * whatever is left around them.
 */
export interface LocationRetirementFacts {
  readonly occupied: boolean;
  readonly historicallyReferenced: boolean;
}

export type LocationRetirementOutcome = "Archived" | "Removed";

export const retirementOutcome = (facts: LocationRetirementFacts): LocationRetirementOutcome =>
  facts.occupied || facts.historicallyReferenced ? "Archived" : "Removed";
