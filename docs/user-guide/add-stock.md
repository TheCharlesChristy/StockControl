# Adding stock from photographs

## Who can use this feature?

Office and Admin users, and only when your administrator has turned assisted stock capture on.
When it is off, **Review queue** does not appear in navigation or on the inventory page, and the
camera never offers to identify a photo.

Nothing you do here changes stock until you select **Confirm receipt**.

## The scan button opens a camera

The round button in the bottom-right corner of every screen opens the camera. Point it at the item.

- **Hold a barcode or QR code in the frame** and StockControl reads it as soon as it catches it.
- **Press the shutter** to take a photo, and it reads that instead. Use this when the code will not
  catch, or when there is no code at all.
- **The two icons at the edges** are for a photo you already have (bottom left) and for typing a
  code (top right).

**On a device with no camera** — most office desktops — the same button opens a plain **Find an
item** box instead, with the cursor already in it. A handheld scanner types into that box like a
keyboard. **Use a photo of the item** is underneath, and everything after that works the same way.

Whatever you use, StockControl reads it **on your device**. Nothing is sent anywhere to do that.

## When it recognises the item

You go straight to the item's page. There is no screen in between to read or dismiss — that page is
where the stock summary, the location breakdown and **Receive stock** already live.

## When it does not

You get one question instead:

> **Not recognised.** Is it something new? StockControl can read your photo to work out what it is.

Office and Admin users can answer it with **Add this as a new item**. That is the point at which the
photo is sent, and it is the only thing that sends it — taking a photo never does. The panel says how
many photos will go before you choose.

Before answering you can:

- **Another angle** — take up to five photos of the same item. Extra angles, and a close-up of a
  label, improve the result. There is no required background or frame.
- **Start again** — throw the shots away and go back to the camera.

Answer yes and you are taken to the delivery you are booking in, where the photos are sent and read.
StockControl may still come back with an item already in the catalogue; you are not committed to
creating a new one.

Anyone else sees **Try again**, and can ask an office user to add the item.

## The review queue

**Review queue** in the sidebar is where photographed items wait. Anything StockControl recognised
on its own never appears here — it went straight to the item.

The queue is grouped by what it needs from you:

- **Waiting for you** — finished being read. Select **Review**.
- **Still being read** — working away, whether or not this page is open. They move up on their own.
- **Could not be read** — photograph them again, or **Remove** them.

**Remove** is on every row, so nothing has to be opened just to be cleared out.

**Photograph another item** here opens the same camera, wired to this delivery: anything you send
from it joins this queue instead of starting a second one.

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

You do not have to wait: select **Cancel this item** to return to the queue, or simply photograph
the next one. Work already sent keeps running.

## Confirm the receipt

The confirmation screen shows the item, its reference, how it is counted, and how much is on hand
now. Enter the quantity and check the store, then read the summary line before selecting **Confirm
receipt**.

Success shows the item's reference and its new balance, with a link to the item. The queue then
lists everything added so far under **Added to stock**.

## Finish the delivery

At the bottom of the queue, **Where it is going** sets the store once for the whole delivery; every
item starts from there and you can still change it per item.

Select **Finish this delivery** when it is done. The next one opens straight away, so there is
nothing else to press. You cannot finish while anything is still queued — review or remove it
first.

## When something goes wrong

- **The photos could not be sent** — they are still on screen. **Send them again** retries with the
  same photos; **Discard these photos** throws them away.
- **This item was not recognised** — photograph it again, or add it from inventory without
  photographs. This appears when the recognition service is unavailable, which your administrator
  can confirm.
- **This item expired** — it waited too long and its photographs were cleared away. Photograph it
  again.
- **StockControl cannot reach the server** — nothing has been lost. Check your connection; the page
  keeps trying, and **Check now** retries immediately.
- Closing the page or refreshing is safe. The queue reopens where you left it.
