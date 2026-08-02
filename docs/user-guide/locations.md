# Locations and maps

## Who can use this page?

Engineer, Office, and Admin users can open Locations and inspect maps, locations, stock status, and
search results. The map is view-only for Engineers and Office users. Admins can create and edit maps
and locations.

## Find a location

1. Open **Locations**.
2. Use the **Map** selector to choose a map.
3. Use the location search field to search by code, name, or search alias. Search begins after at
   least two characters.
4. Select a result or a location in the **On this map** list.
5. Select the location or choose **View details** to inspect its stock status and breadcrumb.

The breadcrumb shows the containment derived from the drawing. A location is inside the smallest
shape that contains it; there is no separate parent field to maintain.

## Read map status

Locations use text, colour, and an icon to show statuses such as Available, Low stock, Out of stock,
or Archived. Select a location to see its stock summary and item list in the inspector.

## Edit a map — Admin only

### Create or choose a map

Select **New map**, enter a **Map code** and **Map name**, then select **Create**. Existing maps can
be selected from the Map selector.

### Draw a location

1. Select **Draw rectangle** or **Draw polygon**.
2. For a rectangle, drag across the area.
3. For a polygon, click each point, then click the first point or press Enter to finish. Press
   Backspace to undo the last point or Escape to cancel.
4. Select the new shape to open its details.
5. Enter the location name and any search aliases. Separate aliases with commas.
6. Select **Save** in the map toolbar.

New shapes become stock locations. Their hierarchy is determined by where they are drawn, not by a
parent selection.

### Move, resize, and organise

- Drag a shape to move it.
- Drag its corner handles to resize it.
- Use arrow keys to nudge a selected shape; hold Shift for a larger nudge.
- Draw or move a shape inside another shape to nest it.
- Use **Raise** or **Lower** in location details to change drawing order when shapes overlap.
- Use Delete or Backspace to remove a selected shape from the draft.
- Use **Snap to grid** for 1% alignment; hold Alt to place freely.
- Use the navigation tools, mouse wheel, pinch, **Zoom in**, **Zoom out**, and **Fit map to canvas**
  to move around the map.

### Floor plans and saving

Select **Upload floor plan** and choose a PNG or JPEG image. Select **Save** to persist geometry and
the floor plan together. Select **Revert** to discard unsaved changes. The toolbar marks unsaved
work with **Unsaved changes**.

If another person saves first, StockControl preserves your draft and displays a conflict. Select
**Reload latest** to load the current server version, then reapply your changes if necessary.

Archiving a location keeps it on the canvas for history but removes it from active containment and
stock use. A location that has held stock is archived rather than erased so historical transactions
remain readable.

Job sites are created by jobs and are not drawn on maps.

Related: [Item details](item-details.md), [Jobs](jobs.md), [Troubleshooting](troubleshooting.md).
