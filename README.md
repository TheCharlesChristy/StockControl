# StockControl

StockControl is an inventory-management application for small businesses with substantial stock
holdings. The current baseline is a **demonstrable MVP that runs on a local machine**, defined in
[`docs/product-requirements.md`](docs/product-requirements.md).

## Development status

The baseline was reduced from a full commercial product specification to a demo MVP, and the source
tree was trimmed to match. The full specification, its playbook, and its traceability matrix are
preserved in [`docs/archive/`](docs/archive/README.md) for when scope is added back.

- Build order: [`docs/implementation-playbook.md`](docs/implementation-playbook.md) — nine packets.
- What was removed and what remains optional:
  [`docs/demo-mvp-removal-candidates.md`](docs/demo-mvp-removal-candidates.md).

What exists today is the runtime foundation: an API with health and version endpoints, a responsive
web shell with placeholder sections, a worker heartbeat, and the database foundation migration. The
inventory domain, authentication, and API routes are packets D2 onwards.

## Prerequisites

- Node.js 24 LTS
- pnpm 11
- Docker with Compose

## Local setup

1. Copy `.env.example` to `.env`.
2. Start PostgreSQL with `pnpm services:up`.
3. Install dependencies with `pnpm install --frozen-lockfile`.
4. Apply the database migrations with `pnpm db:migrate`.
5. Run development processes with `pnpm dev`.

PostgreSQL listens on `localhost:5432`. It is the only service the demo needs.

To browse the web shell before authentication exists, set `VITE_ENABLE_AUTH_PREVIEW=true` in `.env`.
The preview accepts any password and derives a role from the email local part (`admin…`,
`engineer…`, anything else is Office). It performs no verification and is development-only.

## Quality checks

```text
pnpm quality
pnpm test
pnpm test:integration
pnpm test:e2e
```

`test:integration` and `test:e2e` need the database running.
