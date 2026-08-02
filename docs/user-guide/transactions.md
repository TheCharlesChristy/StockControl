# Transactions

Transactions are the append-only record of stock changes. They show what happened, when, where,
against which job, and who performed the action when that information is available to your role.

## Who can see what?

- **Engineer:** sees **Your activity** only. The actor filter and Who column are not available.
- **Office and Admin:** see **Every change, and who made it**, including the Who filter and actor
  column.

An item’s **See the full log** link opens this page with the item filter already set. A user detail
page can similarly open the log filtered to one person.

## Filter the log

- **Item:** enter an item reference, such as `ITM-0001`.
- **Action:** choose Receive, Issue, Transfer, Adjust, Reserve, Collect, or Release.
- **Who:** Office and Admin users can choose a person.
- **From date** and **To date:** enter dates as `dd/mm/yyyy`.
- Use the quick date buttons for today, the last seven days, or all dates.
- Use pagination to move through the filtered result.

The table includes When, Action, Item, Quantity, From, To, Job, Who when permitted, and Reason.
Select an item reference to return to that item’s detail page.

## Export the filtered view

1. Apply the filters you need.
2. Select **Export CSV**.

The export contains the filtered transaction set, including the visible audit fields. It is useful
for sharing a focused item, job, date, or actor history.

## Correcting a mistake

Transactions cannot be edited or deleted. If a count or movement is wrong, use [Item details](item-details.md)
to make a new correction or movement with the appropriate reason. The original entry remains in the
log so the history stays accountable.

Related: [Item details](item-details.md), [User details](user-details.md), [Troubleshooting](troubleshooting.md).
