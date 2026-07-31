# Locations and maps

The `/locations` screen is read-only for Engineer and Office users. Admins
receive the `manageLocations` capability and can create hierarchy nodes, start
blank building maps, draw rectangles or polygons, move regions with the arrow
keys, and save a complete snapshot.

## Editor controls

| Input                                            | Action                                                                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Drag a region, or its corner handles             | Move or resize it                                                                                                |
| Arrow keys                                       | Nudge the selected region; Shift moves farther                                                                   |
| Delete or Backspace                              | Remove the selected region                                                                                       |
| Rectangle tool                                   | Drag to draw; the outline follows the pointer                                                                    |
| Polygon tool                                     | Click to add points; click the first point or press Enter to finish, Backspace to undo a point, Escape to cancel |
| Snap toggle                                      | Aligns to a 1% grid; hold Alt to place freely                                                                    |
| Ctrl/⌘ + wheel, or trackpad pinch                | Zoom towards the pointer                                                                                         |
| Wheel, or two-finger scroll                      | Pan; Shift swaps the axes                                                                                        |
| Space + drag, middle-mouse drag, or the Pan tool | Pan                                                                                                              |
| `+` / `-` / `0`                                  | Zoom in, zoom out, fit to the canvas                                                                             |
| Tab inside the canvas                            | Move the selection through the regions                                                                           |

The canvas is a single tab stop that moves an `aria-activedescendant`, rather
than one tab stop per region. Zoom is reported relative to the fitted view, so
100% means the map fills the canvas.

Drag geometry is held outside React state and published once per animation
frame, so a drag re-renders only the shape being moved. The committed change
reaches the editor's reducer once, when the pointer is released.

The `locations` table remains the stock system's source of truth. Existing IDs,
codes, balances, jobs, and transactions are retained by migration `0004`. A
region is only a visual link to one hierarchy node; containing one SVG shape in
another never changes the hierarchy.

Coordinates are decimal JSON values normalized to `[0, 1]`. Rectangles and
simple polygons are validated both in the browser and in the framework-free
locations module on the server. The API rejects cross-building links, cycles,
archived parents, self-intersecting polygons, and stale map revisions. A
successful save writes the map revision and `map_edit_events` row in one
transaction.

Stock status is derived from the linked node and its descendants. The first
implementation exposes Available, Low stock, Out of stock, and Archived; each
status includes colour, text, and an icon cue. Quarantine and attention values
remain reserved for future stock-condition models.

## Local floor plans

Compose starts PostgreSQL and a private MinIO instance on ports `5432`, `9000`,
and `9001`. Accepted floor-plan media types are PNG and JPEG, with the limit in
`FLOOR_PLAN_MAX_BYTES` (10 MiB by default). PostgreSQL stores only document
metadata and an opaque document ID. Admins upload through
`POST /api/v1/maps/:mapId/background`; the API verifies the image signature,
stores the bytes under an opaque S3 key, and records the map/audit update
transactionally. Client code receives the bytes through the authenticated
`GET /api/v1/floor-plans/:documentId` route; bucket names, credentials, and
permanent public URLs do not belong in a map response.

The map editor does not provide CAD measurement, routing, scale, graphical
history, real-time collaboration, or persistent graphical undo.
