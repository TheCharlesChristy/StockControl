# ADR 0007: Model location maps as abstract overlays

- Status: Superseded by [ADR 0009](0009-map-driven-locations.md)
- Date: 2026-07-29
- Demo MVP: deferred by [demo requirements v2.0](../product-requirements.md) section 10; retained for when the capability returns
- Requirements: Archived [product requirements v1.0](../archive/product-requirements-full-v1.md) 7 and 16.1

## Context

Users need a visual aid linked to the authoritative location hierarchy. The MVP
explicitly excludes precise scale, measurement, route planning, map history, and
graphical undo.

## Decision

Keep the location hierarchy and stable location code authoritative. Represent a
building map as a background image or blank canvas plus an ordered set of named
rectangles or polygons in normalised zero-to-one coordinates. Each region links
to exactly one hierarchy node; geometry and display name may change without
changing location identity.

Support region nesting for visual grouping while continuing to derive
containment and stock rules from the location hierarchy. Validate polygon
shape, coordinate bounds, hierarchy link, and archive state server-side.
Status colours are derived presentation and always accompanied by text or an
icon so colour is not the only meaning.

Store only the current map representation and ordinary audited edit facts for
the MVP. Uploaded backgrounds follow ADR 0006. Vans and job-site locations do
not require geometry.

## Consequences

- Maps remain useful across phone, tablet, and desktop sizes without claiming
  surveying precision.
- Search and stock operations use stable location IDs/codes, not coordinates.
- Editing tests cover coordinate normalisation, nesting, archived locations,
  keyboard operation, touch targets, and non-colour status cues.
- Precise CAD, routing, version timelines, and visual undo require a future ADR.

## Rejected alternatives

- Pixel coordinates: bind data to one image size and viewport.
- GIS/CAD models: exceed the MVP need and imply unsupported precision.
- Treating regions as locations: would let visual edits change audited stock
  identity.
