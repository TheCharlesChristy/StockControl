# Scanning items

The scanner is the fastest way to open an item while standing in front of its label. It is available
to every role on the working pages and supports a camera, a QR code, a barcode, typed text, and a
handheld scanner that behaves like a keyboard.

## Use the camera

1. Select **Find an item by scanning** in the bottom-right corner.
2. Allow camera access if your browser asks.
3. Point the camera at the item’s QR code or barcode.
4. Wait for the item page to open.

On a phone, StockControl prefers the rear-facing camera. If no camera is available, the dialog
switches to the manual field.

## Type or use a handheld scanner

1. Open the scanner dialog.
2. Enter an item reference, barcode, or manufacturer part number in **Item code or barcode**.
3. Select **Find item**.

A handheld scanner can type directly into the same field. If no catalogue item matches, the dialog
shows a warning and leaves the field available for another attempt.

## Scan while signed out

An item QR code contains the item’s own StockControl URL. If you scan it while signed out, StockControl
opens Sign in first and returns you to that item after successful authentication. Scanning never grants
extra permission: the controls on the item page still match your role.

Related: [Sign in and navigation](sign-in-and-navigation.md), [Item details](item-details.md).
