# Locations and Maps domain

This package owns StockControl's framework-independent location hierarchy,
mobile and virtual location, abstract-map, fulfilment-eligibility, and van
movement rules. It has no dependency on inventory, jobs, identity, browser,
database, or deployment code. External user, job, document, and stock facts
enter as opaque identifiers and explicit policy inputs.

## Authoritative location model

`LocationDirectory` contains exactly one active Branch, any number of
Branch-owned Buildings, and an arbitrary-depth hierarchy of Area, Aisle, Shelf,
Bin, and CustomSection nodes inside each Building. A Bin is a leaf. Descriptive
node kinds do not impose a rigid depth sequence; this supports customer-defined
sections and subsections while preserving these invariants:

- a Building is a direct child of the one Branch and owns its stable Building
  identity;
- every spatial node reaches exactly one Building through existing parents;
- cycles, orphans, cross-Branch ancestry, cross-Building moves, and active
  children below archived parents are rejected;
- every code is canonical, globally unique within the deployment, and retained
  in the used-code ledger forever, including after removal of a never-used
  draft location;
- names can change, but IDs and codes have no mutation API;
- an occupied, historically referenced, or parent location is archived rather
  than deleted. Only an empty, unreferenced leaf can be removed, and its code
  still cannot be reused.

Hierarchy operational kinds are Container, Storage, Quarantine, Repair, and
Transit. Only an active Storage node explicitly enabled for general fulfilment
can source ordinary availability or reservations. Containers, vans, job sites,
quarantine, repair, transit, inactive, and archived locations never contribute
to general fulfilment.

Vans are persistent mobile locations. Creation and assignment replacement
require an explicit manage-van-assignment permission held by an Office or Admin
actor; role alone is insufficient. Every assignment is a unique active
Engineer, at least one must remain, and the named primary Engineer must be in
the exact replacement set. Archiving retains the location, assignments, ID,
code, and history.

Each Job can create exactly one virtual job-site location, including its
inactive history. It can become inactive only after the Job is Completed or
Cancelled and the inventory module confirms that it is empty. No override can
hide outstanding job-site stock.

## Van stock decisions

`evaluateReservationSource` always excludes van stock. Automatic selection
reports the stronger `SilentVanSourcingForbidden` result; explicit selection
requires the separate van issue or transfer flow.

`evaluateVanMovementInitiation` requires an explicit source and capability. An
Engineer can propose a permitted issue only when assigned to that van and when
the destination is an active virtual job site. A permitted Office or Admin
actor can propose a van-to-job transfer or a recall to an eligible fulfilment
location. Proposal does not move stock.

`evaluateVanMovementCompletion` requires either confirmation by an explicitly
permitted Engineer assigned to the source van or an explicitly permitted Admin
override with a non-empty reason. Office role or broad role membership alone
cannot complete the physical handover. The application layer must persist the
actor, represented parties, proposal, confirmation or override, and reason in
the same audited transaction as the inventory movement.

## Abstract maps

Each active Building is expected to have one `BuildingMap`, starting with
either a blank canvas or validated uploaded-floor-plan metadata. The uploaded
document itself remains owned by the private-document platform boundary.

Regions have stable IDs and exactly one same-Building hierarchy link. A region
is a finite normalized rectangle or a simple, non-zero-area polygon with 3–128
unique points. Logical region nesting supports visual grouping but never
changes or overrides hierarchy containment. Geometry, display name, z-order,
search aliases, background, and nesting can change without changing region or
location identity. Archived maps and regions are immutable.

`mapRegionStatusPresentation` derives colour, text, and icon metadata from
stock status. Colour is never the only status cue. Coordinates have no scale,
distance, routing, CAD, or surveying meaning. The MVP stores only the current
map representation; audited map-edit facts belong to the application/audit
boundary.

`validateHierarchyMapConsistency` is intended for transaction validation and
release diagnostics. It reports missing or duplicate Building maps, archive
state mismatches, missing links, archived active links, and cross-Building
links. The application must validate, write hierarchy/map changes, and record
their audit facts atomically.

## Integration contract

Persistence should store and rehydrate `LocationDirectorySnapshot` and
`BuildingMapSnapshot` through their validating factories. The application
layer owns ID generation, concurrency, authorisation capability lookup,
occupancy/history projections, document access, stock movements, and audit
events. Inventory availability must call the exported fulfilment and
reservation policies rather than reimplementing location-kind conditions.
