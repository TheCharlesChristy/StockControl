# Stock requests

Stock requests let an Engineer ask for stock without directly changing the catalogue balance. Office
and Admin users review the queue.

## Create a request — all roles with an item page, normally Engineers

From [Item details](item-details.md), select **Request stock** and:

1. Enter **Quantity** in the item’s unit.
2. Choose an open job in **Where will you use it?**, or keep **General stock request** selected.
3. Add an optional **Note**.
4. Select **Send request**.

The request starts as **Waiting** and does not reduce availability. Naming a job tells the reviewer
that approval should reserve the stock for that job.

## Track or withdraw your request

Engineers can see their requests on Overview under **Your stock requests**. On a pending request you
created, select **Withdraw request** and confirm if it is no longer needed. Withdrawal removes it
from the review queue but preserves the withdrawal in the item history.

## Review the queue — Office and Admin

Open **Stock requests** from navigation. The default **Status** filter is **Waiting**. Change it to
Approved, Rejected, Withdrawn, or All requests to review past decisions.

Each request shows its status, item, requested quantity, requester, date, optional note, and named
job when present.

### Approve

1. Select **Approve**.
2. Check or amend **Quantity to approve**.
3. Add an optional decision note.
4. Select **Approve**.

For a job-specific request, approval reserves the approved quantity against that job. For a general
stock request, approval records the decision without creating a reservation. Approval still must
respect current available stock.

### Reject

1. Select **Reject**.
2. Enter **Why reject this request?**
3. Select **Reject**.

A rejection reason is required and is shown with the decision-maker’s name.

## Status meanings

- **Waiting** — submitted and awaiting a decision.
- **Approved** — approved by Office or Admin; a named job may also have a reservation.
- **Rejected** — declined with a decision reason.
- **Withdrawn** — cancelled by the requester.

Related: [Overview](overview.md), [Item details](item-details.md), [Job details](job-details.md),
[Transactions](transactions.md).
