# Demo accounts — local demonstrations only

Do not use these credentials for a deployed or production environment. They are created by
`pnpm db:seed` for the local demo dataset, and every account uses the shared password
`demo-password`.

| Email                      | Role     | Best for demonstrating                                                |
| -------------------------- | -------- | --------------------------------------------------------------------- |
| `admin.owner@example.com`  | Admin    | Everything, including Team & access and map editing                   |
| `office.desk@example.com`  | Office   | Catalogue, stock, jobs, request review, and the full audit log        |
| `engineer.one@example.com` | Engineer | Personal stock, assigned jobs, reservations, collection, and requests |
| `engineer.two@example.com` | Engineer | Comparing one Engineer’s personal activity with another’s             |

The seed data includes catalogue items, maps, locations, jobs, requests, and transaction history.
Re-seeding clears business data and rebuilds the demo dataset.

For normal onboarding, use the account and password supplied by your StockControl administrator.
