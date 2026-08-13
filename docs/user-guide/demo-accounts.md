# Demo accounts — local demonstrations only

Do not use these credentials for a deployed or production environment. They are created by
`pnpm db:seed` for the local demo dataset, and every account uses the shared password
`demo-password`.

| Username       | Role     | Best for demonstrating                                                                          |
| -------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `admin.owner`  | Admin    | Everything, including Team & access and map editing                                             |
| `office.desk`  | Office   | Catalogue, stock, jobs, request review, and the full audit log                                  |
| `engineer.one` | Engineer | Personal stock, assigned jobs, reservations, collection, and requests                           |
| `engineer.two` | Engineer | An account with no email address, and comparing one Engineer's personal activity with another's |

The seed data includes catalogue items, maps, locations, jobs, requests, and transaction history.
Re-seeding clears business data and rebuilds the demo dataset.

For normal onboarding, use the account and password supplied by your StockControl administrator.
