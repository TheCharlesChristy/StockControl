# StockControl

StockControl is an inventory-management product for small businesses with substantial stock
holdings. The approved MVP baseline is in
[`docs/product-requirements.md`](docs/product-requirements.md).

## Development status

The runtime foundation, identity/security primitives, catalogue and inventory domain, and
locations/maps domain are under active implementation. Product behaviour must remain traceable to
the approved requirements and preserve stock integrity, auditability, accessibility, and
server-side authorisation.

The detailed delivery sequence, bounded work packets, and test-writing guidance are in the
[`docs/implementation-playbook.md`](docs/implementation-playbook.md) implementation playbook.

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
