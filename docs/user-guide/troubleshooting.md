# Troubleshooting and status messages

## Loading

StockControl shows a loading state while a page or dialog is fetching data. Wait for the page to
finish. Do not submit the same operation repeatedly while a button says **Working…**, **Saving…**,
or **Submitting…**.

If a list remains loading, use the available retry action or return to Overview and open the page
again.

## Error and retry

An error banner means the requested data or action did not complete. Read the message, correct any
field highlighted in the dialog, and retry once. If the message indicates the service cannot be
reached, check your connection or contact your administrator.

## Validation errors

Required fields must be completed before the submit button becomes available. Common requirements
include:

- valid work email for sign-in or user creation;
- a positive quantity in the item’s unit;
- a reason for adjustments, reservation releases, and rejected requests;
- a job number/name/customer when creating a job;
- PNG or JPEG for photos and floor plans.

Forms keep recoverable input while an error is displayed. Correct the highlighted field and submit
again.

## Stock-rule refusals

- You cannot take more stock than the selected location holds.
- You cannot reserve more than the item’s Ready to use/Available quantity.
- A transfer must have different valid source and destination stores.
- An adjustment sets the complete new count; it does not add to the old count.
- A refused operation writes no partial change.

Check the current figures on the item or job page before retrying. If the value was changed by
someone else, reload the page first.

## Access restricted

The server checks permission for every request. A control may be hidden, or an action may return an
access warning if your role cannot perform it. Ask an Admin to confirm your role; do not ask someone
else to sign in for you.

## Page not found

**Page not found** means the address is incorrect or the record no longer exists. Your inventory has
not been changed. Return to Overview and search again.

## Map save conflict

When another Admin saves the same map first, the Locations page preserves your unsaved draft and
shows a conflict. Select **Reload latest**, compare the current map with your intended edits, then
apply and save again.

Related: [Sign in and navigation](sign-in-and-navigation.md), [Locations](locations.md),
[Report an issue](report-an-issue.md).
