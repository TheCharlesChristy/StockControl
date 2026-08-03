# Job details

Job details connects stock commitments to a job site. All roles can reserve stock and collect open
reservations. Office and Admin users can assign people, release reservations, and close jobs.

## Read the page

- **Status** shows whether the job is Open or Closed.
- **Open commitments** counts reservations with stock still outstanding.
- **Items at site** counts item/location balances currently at the job site.
- **Assignees** are the people whose Overview includes the job.
- **Reservations** shows each item’s Committed, At site, Remaining, status, and who committed it.
- **Stock at the job site** shows stock already collected. Closing the job does not move this stock.
- **Job activity** shows recent related transactions.

## Assign people — Office and Admin

1. In **Assignees**, select **Assign someone**.
2. Choose an active user in **Add someone**.
3. Confirm the selection.

Remove an assignee from the same panel. Assignment changes what appears on that person’s Overview;
it does not move stock.

## Reserve for a job — all roles

1. On an open job, select **Reserve for this job**.
2. Search for and select an **Item**.
3. Enter **Quantity**.
4. Select **Reserve for job**.

Reservation reduces the item’s **Ready to use** quantity, but does not move stock yet. The quantity
must not exceed the item’s current ready-to-use stock. An over-reservation is refused with that
figure and writes nothing.

## Collect stock to site — all roles

1. Find an Open reservation with an outstanding quantity.
2. Select **Collect to site**.
3. Choose a store in **Take from store**.
4. Enter **Quantity**; the dialog defaults to the outstanding amount.
5. Select **Collect to site**.

Collection can be partial and repeated. It moves the collected quantity from the chosen store to the
job-site location. The reservation remains Open until its outstanding quantity reaches zero.

## Release remaining stock — Office and Admin

1. Select **Release remaining** on an open reservation.
2. Enter the required **Reason**.
3. Select **Release remaining**.

The uncollected remainder is cancelled and becomes available again. Collected stock at the job site
is not moved by releasing the remainder.

## Close a job — Office and Admin

1. Select **Close job**.
2. Read the confirmation, including any warning about stock already at the job site.
3. Confirm **Close job**.

Closing releases every uncollected reservation on the job. Stock already at the job site stays there
and remains visible in the job-site stock table. A closed job cannot accept new reservations or
normal job management actions.

Related: [Jobs](jobs.md), [Item details](item-details.md), [Overview](overview.md),
[Transactions](transactions.md).
