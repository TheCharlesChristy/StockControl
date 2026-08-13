# StockControl user guide

StockControl records what stock exists, where it is, what is committed to a job, and who changed
it. This guide is for people using the web app day to day. It describes the controls currently
available to each role.

## Start here

1. Read [Sign in and navigation](sign-in-and-navigation.md).
2. Read the guide for your role below.
3. Follow the page links when you need to complete a task.

### Engineer

Start with [Overview](overview.md), then read [Item details](item-details.md), [Jobs](jobs.md),
[Job details](job-details.md), [Stock requests](stock-requests.md), and [Scanning items](scan-an-item.md).
Engineers can view stock, issue it, reserve and collect it for jobs, and ask Office users for stock.
Their activity views show their own actions.

### Office

Start with [Overview](overview.md), then read [Inventory](inventory.md), [Item details](item-details.md),
[Jobs](jobs.md), [Job details](job-details.md), [Stock requests](stock-requests.md), and
[Transactions](transactions.md). Office users operate the catalogue, stock, jobs, request queue,
and full audit history.

### Admin

Read the Office path first, then [Locations](locations.md), [Team & access](team-and-access.md),
and [User details](user-details.md). Admins also manage accounts and edit the map layout.

## Pages and shared workflows

| Guide                                               | What it covers                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| [Sign in and navigation](sign-in-and-navigation.md) | Signing in, signing out, navigation, mobile navigation, and your profile link |
| [Overview](overview.md)                             | The role-specific home page                                                   |
| [Inventory](inventory.md)                           | Searching the catalogue, location breakdowns, CSV export, and creating items  |
| [Item details](item-details.md)                     | Stock figures, direct stock operations, item maintenance, labels, and history |
| [Jobs](jobs.md)                                     | Finding, filtering, and creating jobs                                         |
| [Job details](job-details.md)                       | Assignments, reservations, collection, release, job-site stock, and closing   |
| [Stock requests](stock-requests.md)                 | Asking for stock, reviewing requests, approving, rejecting, and withdrawing   |
| [Transactions](transactions.md)                     | Filtering and exporting the append-only stock history                         |
| [Locations](locations.md)                           | Finding locations and editing maps as an Admin                                |
| [Team & access](team-and-access.md)                 | Creating users and changing role or account status                            |
| [User details](user-details.md)                     | Editing one user and reviewing their activity                                 |
| [Profile](profile.md)                               | Managing your profile photo                                                   |
| [Scanning items](scan-an-item.md)                   | Camera, QR code, barcode, and handheld scanner workflows                      |
| [Adding stock from photographs](add-stock.md)       | Assisted stock capture: photographing a delivery and confirming what arrived  |
| [Reporting an issue](report-an-issue.md)            | Sending a problem report from any signed-in page                              |
| [Troubleshooting](troubleshooting.md)               | Loading, error, access, not-found, validation, and stock-rule messages        |

For local demonstrations only, see [Demo accounts](demo-accounts.md). In a normal deployment,
use the account and password supplied by your StockControl administrator.

## Stock figures in plain language

- **Total in stock** is the item quantity across every location.
- **In stores** is stock currently held in store locations.
- **At job sites** is stock already collected to job-site locations.
- **Committed to jobs** is stock promised to open job reservations but not yet fully collected.
- **Committed for you** is the part of the reserved quantity associated with your own activity.
- **Ready to use** is store stock minus open reservations. Stock at a job site is never counted as
  ready to use.

Stock quantities cannot go below zero. A reservation or issue that is too large is refused without
writing a partial change. Transactions cannot be edited or deleted; correct a mistake with a new
adjustment and a reason.

## Role summary

| Capability                                        | Engineer | Office | Admin |
| ------------------------------------------------- | :------: | :----: | :---: |
| View stock, jobs, and transactions                |   Yes    |  Yes   |  Yes  |
| Take stock out, reserve stock, and collect stock  |   Yes    |  Yes   |  Yes  |
| Receive, transfer, and adjust stock               |    No    |  Yes   |  Yes  |
| Create and edit catalogue items                   |    No    |  Yes   |  Yes  |
| Create, assign, release, and close jobs           |    No    |  Yes   |  Yes  |
| Review stock requests and see everyone’s activity |    No    |  Yes   |  Yes  |
| View locations and maps                           |   Yes    |  Yes   |  Yes  |
| Edit maps and locations                           |    No    |   No   |  Yes  |
| Manage users                                      |    No    |   No   |  Yes  |

Controls are hidden when a role cannot use them, and the server checks the same permission again.
