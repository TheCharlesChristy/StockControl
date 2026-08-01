# ADR 0009: Derive the location hierarchy from the map

- Status: Accepted
- Date: 2026-08-01
- Supersedes: [ADR 0007](0007-abstract-location-maps.md)

## Context

ADR 0007 kept a stored six-level hierarchy authoritative and treated the map as
an overlay onto it, explicitly forbidding a drawing from meaning anything. In
practice that gave us two models of the same idea, and they fought:

- `locations` carried `node_kind`, `operational_kind`, `parent_id`,
  `building_id` and `general_fulfilment_enabled`, and a framework-free module
  spent roughly 350 lines enforcing which kind could contain which.
- `map_regions` rows were drawings that _linked to_ a hierarchy node and
  separately nested visually, so the picture on screen could disagree with the
  tree that actually governed stock roll-ups.
- Creating one location meant three steps: make a node in a tree, draw a shape,
  connect the two. A third path, `POST /inventory/locations`, hardcoded a
  building id to smuggle a row into the tree entirely outside the editor.

Users experienced this as an inventory system with a diagram attached, and had
to keep the two in agreement by hand.

## Decision

The map becomes the only model of where things are.

A **map** is a standalone named canvas — a floor, a unit, a yard — with no
reference to any location. A **location** is a shape drawn on one: the drawn
region and the place stock sits are a single `locations` row, not two records
with a link between them.

Containment is **derived from geometry**: a location's parent is the smallest
shape that wholly contains it, ties broken by z-order and then id. The
derivation lives in one framework-free function used by both the browser (after
every committed edit, so the breadcrumb tracks the drag) and the server (inside
the save transaction). Its result is written to `locations.derived_parent_id`,
which is a cache of the picture and never something a user sets.

Identity stays where it was. A location keeps its `id` and `code` across every
edit, so stock levels, transactions and reservations are untouched by any amount
of redrawing. `PUT /maps/:mapId` is the only route that writes locations.

## Consequences

- The node-kind ladder, the operational kinds, the parent picker, the move
  action and the create-node form are all gone, along with the rules module that
  policed them. Erasing a shape that has held stock archives its location; one
  never used is deleted.
- Cycles cannot be expressed. Containment orders shapes by area, so the relation
  is a strict order by construction and there is no cycle check to write.
- Every location-shaped read — stock roll-ups on the map, breadcrumbs in stock
  pickers, search results — goes through `derived_parent_id`, so all of them
  agree with the map by construction.
- Locations can only be created by drawing. `POST /inventory/locations` is
  removed; Office users, who could call it, had no screen that did.
- Job sites remain the exception: owned by a job, never drawn, no map and no
  parent.
- The web may now import the framework-free locations module, not only the
  contracts. One containment implementation shared by both sides is worth more
  than the boundary, because a browser copy that drifted would show the user a
  nesting the server would not save.
- Migration `0004` was rewritten rather than superseded, so no database ever
  creates the hierarchy columns. Any database that ran the previous `0004` fails
  its integrity check and must be dropped and re-migrated.

## Rejected alternatives

- **Keep the hierarchy, sync it from the map.** Two sources of truth with a
  reconciliation step between them — the present problem with extra machinery.
- **Centroid containment.** More forgiving of sloppy drawing, but a shape can
  read as inside a parent it visibly hangs out of. Full containment is what the
  picture already says.
- **A single global canvas.** Simplest possible, but no way to model two sites
  or two floors without cramming them onto one image.
- **Duplicating containment in the browser** to preserve the web→contracts-only
  boundary. Rejected: silent drift between the two copies would be invisible
  until a save produced a different tree from the one on screen.
