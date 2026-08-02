# Locations and maps

The map is the model. A location exists because someone drew it, and it sits
inside whatever it is drawn inside. There is no hierarchy to maintain, no parent
to choose, and no way for the tree the application reasons about to disagree
with the picture on screen.

The `/locations` screen is read-only for Engineer and Office users. Admins
receive the `manageLocations` capability and can create maps, draw rectangles or
polygons, move them with the arrow keys, and save a complete snapshot.

## The implicit hierarchy

A location's parent is **the smallest shape that wholly contains it**. Nothing
else is consulted:

- Shapes that only partly overlap are siblings — neither contains the other.
- Sharing an edge counts as inside, because drawing a shelf flush against the
  wall of an aisle is the normal way to draw it.
- Where two shapes are identical, the one drawn on top is the one inside.
- Archived shapes stay on the canvas, greyed out, but take no part in
  containment: anything drawn inside one re-derives its parent from what is left
  around it.

The rule lives in `packages/modules/locations/src/locations/containment.ts` and
is used unchanged by both sides. The browser runs it after every committed edit,
so the breadcrumb in the inspector updates as you drag; the server runs it inside
the save transaction and writes the result to `locations.derived_parent_id`.
That column is a cache of the geometry, never a thing a user sets, and every
read — stock roll-ups, breadcrumbs in stock pickers, search results — goes
through it.

Because containment orders shapes by area, a cycle cannot be expressed. There is
no cycle check, because there is nothing to check.

## Editor controls

| Input                                            | Action                                                                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Drag a shape, or its corner handles              | Move or resize it, which is also how you change what it sits inside                                              |
| Arrow keys                                       | Nudge the selected shape; Shift moves farther                                                                    |
| Delete or Backspace                              | Remove the selected shape                                                                                        |
| Rectangle tool                                   | Drag to draw; the outline follows the pointer                                                                    |
| Polygon tool                                     | Click to add points; click the first point or press Enter to finish, Backspace to undo a point, Escape to cancel |
| Snap toggle                                      | Aligns to a 1% grid; hold Alt to place freely                                                                    |
| Ctrl/⌘ + wheel, or trackpad pinch                | Zoom towards the pointer                                                                                         |
| Wheel, or two-finger scroll                      | Pan; Shift swaps the axes                                                                                        |
| Space + drag, middle-mouse drag, or the Pan tool | Pan                                                                                                              |
| `+` / `-` / `0`                                  | Zoom in, zoom out, fit to the canvas                                                                             |
| Tab inside the canvas                            | Move the selection through the shapes                                                                            |

The canvas is a single tab stop that moves an `aria-activedescendant`, rather
than one tab stop per shape. Zoom is reported relative to the fitted view, so
100% means the map fills the canvas.

Drag geometry is held outside React state and published once per animation
frame, so a drag re-renders only the shape being moved. The committed change
reaches the editor's reducer once, when the pointer is released.

## Identity, and what a save does

A drawn shape and the place stock sits are one `locations` row. Identity — the
`id` and `code` — is what stock levels, transactions and reservations point at,
and drawing never changes it: moving a shape changes where it sits, not what it
is. A newly drawn shape is given a code derived from its name, which the admin
can override before saving.

`PUT /api/v1/maps/:mapId` is the only route that writes locations. In one
transaction, guarded by the map revision, it inserts what was drawn, updates
what moved, retires what was erased, recomputes every `derived_parent_id` on the
map, bumps the revision and appends a `map_edit_events` row. There is no second
path, and no way to create a location that is not on a map — `POST
/inventory/locations` was removed with the hierarchy.

Erasing a shape that has held stock, or that any transaction still points at,
archives the location instead of deleting it, so the ledger stays readable.
Anything never used is deleted outright.

Coordinates are decimal JSON values normalized to `[0, 1]`. Rectangles and
simple polygons are validated both in the browser and in the framework-free
locations module on the server, which rejects self-intersecting polygons,
out-of-bounds coordinates, duplicate codes and stale map revisions.

Stock status is derived from the location and everything drawn inside it. The
first implementation exposes Available, Low stock, Out of stock, and Archived;
each status includes colour, text, and an icon cue, so colour is never the only
meaning. Quarantine and attention values remain reserved for future
stock-condition models.

Job sites are the one kind of location that is never drawn. A job owns one, it
holds stock, and it has no map, no geometry and no parent.

## Local floor plans

Compose starts PostgreSQL and a private MinIO instance on ports `5432`, `9000`,
and `9001`. The private bucket is shared with user profile and item photos.
Accepted floor-plan media types are PNG and JPEG, with the limit in
`FLOOR_PLAN_MAX_BYTES` (10 MiB by default). PostgreSQL stores only document
metadata and an opaque document ID. Admins upload through
`POST /api/v1/maps/:mapId/background`; the API verifies the image signature,
stores the bytes under an opaque S3 key, and records the map/audit update
transactionally. Client code receives the bytes through the authenticated
`GET /api/v1/floor-plans/:documentId` route; bucket names, credentials, and
permanent public URLs do not belong in a map response.

The map editor does not provide CAD measurement, routing, scale, graphical
history, real-time collaboration, or persistent graphical undo.
