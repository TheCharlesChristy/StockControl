# Inventory

## Who can use this page?

Inventory is available to Office and Admin users. Engineers use the stock table on [Overview](overview.md)
instead. Every role can still open an individual item through a link or [scanner](scan-an-item.md).

## Find stock

1. Enter text in **Search inventory**.
2. Search by item name, item code, barcode, or manufacturer part number.
3. Select the arrow beside a row to load its per-location breakdown.
4. Select the item code to open [Item details](item-details.md).

The table shows:

- **Total in stock:** all locations combined.
- **Committed to jobs:** open reservations.
- **Ready to use:** store stock less open reservations.
- **Unit:** the unit used for that item, such as `ea`, `m`, or `L`.

The expanded breakdown labels each location as a Store or Job site. Job-site stock remains visible,
but it is not included in Ready to use.

Use pagination to move through results. The table reports the total number of matching items.

## Export inventory

Select **Export CSV**. The export includes every row matching the current search, not only the page
currently visible. It includes item code, name, unit, on-hand quantity, store quantity, job-site
quantity, reserved quantity, and available quantity.

## Create an item — Office and Admin

1. Select **New item**.
2. Enter the required **Name** and **Unit**.
3. Optionally enter **Barcode**, **Manufacturer part number**, and **Low-stock minimum**.
4. Select **Create item**.

The reference is allocated by StockControl. The low-stock minimum controls whether the item appears
in the dashboard’s Low on stock panel. Receive stock from the new item’s detail page; creating the
catalogue record does not create stock.

Related: [Item details](item-details.md), [Overview](overview.md), [Transactions](transactions.md).
