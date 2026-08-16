# Adding stock from photographs

## Who can use this feature?

Office and Admin users, and only when your administrator has turned assisted stock capture on.
When it is off, **Add stock** does not appear in navigation or on the inventory page, and the scan
sheet never offers to identify a photograph.

Nothing you do here changes stock until you select **Confirm receipt**.

## Everything starts at the scan button

The round button in the bottom-right corner of every screen opens the scan sheet. It is the only
place in StockControl where you point a device at a thing, and it takes three kinds of input:

- **The camera.** Hold a QR code or barcode inside the frame.
- **A typed code.** Type it, or let a handheld scanner type it — they behave like keyboards.
- **A photo.** Take one, or choose one you already have.

Whatever you use, StockControl reads it **on your device**. A photo is checked for a barcode here,
on the phone or laptop in your hand. Nothing is sent anywhere to do that.

## When the item is recognised

The sheet shows the item, its reference and how much is on hand, with two things you can do:

- **Add stock** — receive stock against it there and then. Choose the store, type the quantity,
  done. This is the quickest route for anything with a label you can read, and it does not use
  assisted capture at all.
- **Open item** — go to the item's record.

An archived item cannot take stock. Open it and bring it back into use first.

## When it is not recognised

If no code was found, or the code matches nothing in the catalogue, Office and Admin users are
offered assisted capture:

> **Let StockControl work out what it is** — choosing this sends the photo to StockControl to be
> identified.

**This is a choice, and it is off until you make it.** Attaching a photo never sends it. The panel
tells you exactly how many photos will go and what happens next, and the button says what pressing
it does. Add up to five photos before you decide — extra angles, and a close-up of a label, improve
the result. There is no required background or frame.

Choose it, and the photos are sent and you are taken to the delivery you are booking in.

## The delivery

**Add stock** in the sidebar is the delivery you have open: what has already gone into stock, what
is still being identified, and what is waiting for you to check. A batch is one delivery.

Set **Where this delivery is going** once. Every item in the batch starts from that store, and you
can still change it for any single item. Leave it blank to choose per item.

**Photograph an item** on this page opens the same scan sheet, wired to this delivery: anything you
send from there joins this batch instead of starting another one.

## Check the suggestion

StockControl shows up to five suggestions. The one it considers most likely is marked **Best
match**.

- **Strong** — the evidence points clearly at this item.
- **Possible** — it matches, but check it before confirming.
- **Weak** — a long shot; check it carefully.

Each suggestion lists what it was based on, such as a barcode or the text on a label. **Show
analysis details** lists everything that was checked, for every photograph.

Select the correct suggestion. If none is right, select **None are correct** and type the item in
yourself.

An archived item is shown but cannot receive stock. Use **Open this item** to bring it back into
use first.

You do not have to wait: select **Cancel this item** to return to the batch, or simply start the
next item. Work already sent keeps running.

## Confirm the receipt

The confirmation screen shows the item, its reference, how it is counted, and how much is on hand
now. Enter the quantity and check the store, then read the summary line before selecting **Confirm
receipt**.

Success shows the item's reference and its new balance, with a link to the item. The batch then
lists everything added so far.

## Finish

Select **Finish this batch** when the delivery is done. A finished batch cannot take more items —
start another batch for the next delivery.

## When something goes wrong

- **The photos could not be sent** — they are still on screen. **Send them again** retries with the
  same photos; **Discard these photographs** throws them away.
- **This item was not recognised** — photograph it again, or add it from inventory without
  photographs. This appears when the recognition service is unavailable, which your administrator
  can confirm.
- **This item expired** — it waited too long and its photographs were cleared away. Photograph it
  again.
- **StockControl cannot reach the server** — nothing has been lost. Check your connection; the page
  keeps trying, and **Check now** retries immediately.
- Closing the page or refreshing is safe. The batch reopens where you left it.
