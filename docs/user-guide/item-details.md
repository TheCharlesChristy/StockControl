# Item details

An item detail page is available to every role at `/inventory/:itemId`. It is the main place to
inspect one item, perform direct stock operations, request stock, print a label, and open history.

## Understand the page

The summary tiles separate the important quantities:

- **Total in stock** — all locations.
- **In stores** — stock available in store locations before reservations.
- **At job sites** — stock already collected to jobs.
- **Committed to jobs** — stock committed to open reservations.
- **Ready to use** — store stock minus open reservations.
- Engineers also see **Committed for you** where relevant.

The **Stock by location** table shows the exact quantity and whether the location is a Store or Job
site. Select **Show on map** to open a map view of mapped storage locations.

## Direct stock operations

Office and Admin users have the full stock controls. Engineers can use **Take from store**, but do
not receive, transfer, adjust, or edit catalogue records.

### Receive stock — Office and Admin

1. Select **Receive**.
2. Choose a store in **Location**.
3. Enter **Quantity**.
4. Select **Receive**.

Receiving increases both Total in stock and In stores. It can only target an active Store location.

### Take stock out — all roles

1. Select **Take from store**.
2. Choose the location holding the stock.
3. Enter **Quantity**.
4. Select **Take from store**.

The available amount at the selected location is shown in the dialog. StockControl refuses an issue
that would take the location below zero, and no partial change is made.

### Transfer between stores — Office and Admin

1. Open **More actions** and select **Transfer between stores**.
2. Choose **From location** and **To location**.
3. Enter **Quantity**.
4. Select **Transfer**.

The total remains unchanged; the quantity moves from one store to another.

### Correct a counted quantity — Office and Admin

1. Open **More actions** and select **Correct a counted quantity**.
2. Choose **Location**.
3. Enter the complete new count in **Total counted**. This replaces the recorded quantity; it is
   not added to it.
4. Enter a **Reason**.
5. Select **Save new count**.

The reason and your name are recorded in the transaction history.

## Request stock — all roles, normally used by Engineers

1. Select **Request stock**.
2. Enter the required **Quantity** in the item’s unit.
3. In **Where will you use it?**, choose an open job or leave **General stock request** selected.
4. Add an optional note, such as why the stock is needed or when it is required.
5. Select **Send request**.

A pending request changes no stock. If an Office or Admin user approves a request named for a job,
the approved quantity becomes a reservation for that job. A general request records demand without
creating a reservation.

## Catalogue and photos — Office and Admin

Open **More actions** and select **Edit item details** to change the name, unit, barcode,
manufacturer part number, or low-stock minimum. The item reference and its history do not change.

The item photo section allows up to ten photos. Select **Add photos**, choose PNG or JPEG files,
then use the photo controls to set a **Primary photo** or remove a photo. The primary photo appears
where the item is referenced elsewhere in the app.

Select **Archive item** to take an item out of normal use while keeping its history. Archived items
cannot be received, taken from a store, or reserved and are labelled as Archived in lists.

## Labels and history

- The page displays a QR code linking to the item and a barcode when available.
- Select **Print label** to print the item’s name, reference, QR code, and barcode in the print label
  layout.
- Select **See the full log** to open Transactions filtered to this item.

Office and Admin users see the item’s recent activity with the actor. Engineers see **Your activity
on this item**, limited to their own actions.

Related: [Inventory](inventory.md), [Jobs](jobs.md), [Stock requests](stock-requests.md),
[Transactions](transactions.md), [Scanning items](scan-an-item.md).
