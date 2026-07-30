# StockControl

StockControl is an inventory-management application for small businesses with substantial stock
holdings. The current baseline is a **demonstrable MVP that runs on a local machine**, defined in
[`docs/product-requirements.md`](docs/product-requirements.md).

## Development status

The baseline was reduced from a full commercial product specification to a demo MVP. The full
specification, its playbook, and its traceability matrix are preserved in
[`docs/archive/`](docs/archive/README.md) for when scope is added back.

- Build order: [`docs/implementation-playbook.md`](docs/implementation-playbook.md) — nine packets.
- Existing code outside the demo scope:
  [`docs/demo-mvp-removal-candidates.md`](docs/demo-mvp-removal-candidates.md).

The setup steps below describe the repository as it stands today, before packet D1 trims it. MinIO
and Mailpit are removal candidates; once D1 lands, local setup is Postgres only.

## Prerequisites

- Node.js 24 LTS
- pnpm 11
- Docker with Compose

## Local setup

1. Copy `.env.example` to `.env`.
2. Start PostgreSQL, MinIO, and Mailpit with `pnpm services:up`.
3. Install dependencies with `pnpm install --frozen-lockfile`.
4. Apply the database migrations with `pnpm db:migrate`.
5. Run development processes with `pnpm dev`.

Local service endpoints:

- PostgreSQL: `localhost:5432`
- MinIO API: `http://localhost:9000`
- MinIO console: `http://localhost:9001`
- Mailpit: `http://localhost:8025`

## Quality checks

```text
pnpm quality
pnpm test
pnpm test:integration
pnpm test:e2e
```

Every production change must pass the required GitHub Actions workflows before merge.
