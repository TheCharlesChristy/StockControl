import { createChecksummedMigration, type CanonicalMigrationDefinition } from "./integrity";

/**
 * What the stock schema could not express: who a job belongs to, and demand
 * that has been asked for but not yet committed.
 *
 * `job_assignments` is a plain join table because several people work one job.
 * `stock_requests` is demand only — it changes no stock level and writes no
 * transaction. Approving one calls the same reserve operation a person would,
 * so availability arithmetic and the ledger keep their single path, and the
 * resulting reservation is linked back here for the audit trail.
 */
export const collaborationMigrationDefinition = Object.freeze({
  name: "0003_collaboration",
  version: 3,
  upStatements: Object.freeze([
    `
      create table stockcontrol.job_assignments (
        job_id uuid not null references stockcontrol.jobs (id) on delete restrict,
        user_id uuid not null references stockcontrol.users (id) on delete restrict,
        assigned_by_user_id uuid not null references stockcontrol.users (id) on delete restrict,
        assigned_at timestamptz not null default now(),
        primary key (job_id, user_id)
      )
    `,
    "create index job_assignments_user_id_idx on stockcontrol.job_assignments (user_id)",
    `
      create table stockcontrol.stock_requests (
        id uuid primary key,
        reference varchar(40) not null,
        item_id uuid not null references stockcontrol.items (id) on delete restrict,
        job_id uuid references stockcontrol.jobs (id) on delete restrict,
        quantity numeric(18, 3) not null check (quantity > 0),
        note text,
        status varchar(20) not null default 'Pending' check (
          status in ('Pending', 'Approved', 'Rejected', 'Cancelled')
        ),
        requested_by_user_id uuid not null references stockcontrol.users (id) on delete restrict,
        decided_by_user_id uuid references stockcontrol.users (id) on delete restrict,
        decided_at timestamptz,
        decision_note text,
        reservation_id uuid references stockcontrol.reservations (id) on delete restrict,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint stock_requests_decision_matches_status check (
          (status = 'Pending') = (decided_at is null)
        )
      )
    `,
    "create unique index stock_requests_reference_key on stockcontrol.stock_requests (reference)",
    `create index stock_requests_status_idx
       on stockcontrol.stock_requests (status, created_at desc)`,
    `create index stock_requests_requested_by_idx
       on stockcontrol.stock_requests (requested_by_user_id, created_at desc)`,
    "create index stock_requests_item_id_idx on stockcontrol.stock_requests (item_id)",
    `create index reservations_created_by_open_idx
       on stockcontrol.reservations (created_by_user_id) where status = 'Open'`,
  ]),
  downStatements: Object.freeze([
    "drop index if exists stockcontrol.reservations_created_by_open_idx",
    "drop table if exists stockcontrol.stock_requests",
    "drop table if exists stockcontrol.job_assignments",
  ]),
} satisfies CanonicalMigrationDefinition);

const collaboration = createChecksummedMigration(collaborationMigrationDefinition);

export const collaborationMigration = collaboration.migration;
export const collaborationMigrationIntegrity = collaboration.descriptor;
