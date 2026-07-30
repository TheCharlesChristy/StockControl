import { createChecksummedMigration, type CanonicalMigrationDefinition } from "./integrity";

/**
 * The demo MVP stock schema: who is using the system, what the catalogue holds,
 * where stock sits, what is committed to a job, and an append-only record of
 * every change. See docs/product-requirements.md sections 2 to 4.
 *
 * Quantities are numeric(18,3) so fractional units behave exactly. The
 * non-negative check on stock_levels is defence in depth behind the application
 * rule, not a substitute for it.
 *
 * `transactions` is append-only. That is enforced by withholding update and
 * delete from the runtime role in RUNTIME_TABLE_PRIVILEGES rather than by a
 * rule or trigger, so an attempted write fails loudly instead of silently
 * doing nothing.
 */
export const stockMigrationDefinition = Object.freeze({
  name: "0002_stock",
  version: 2,
  upStatements: Object.freeze([
    `
      create table stockcontrol.users (
        id uuid primary key,
        email varchar(320) not null,
        display_name varchar(200) not null,
        role varchar(20) not null check (role in ('Engineer', 'Office', 'Admin')),
        password_hash text not null,
        is_active boolean not null default true,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint users_email_lowercase check (email = lower(email))
      )
    `,
    "create unique index users_email_key on stockcontrol.users (email)",
    `
      create table stockcontrol.sessions (
        id uuid primary key,
        user_id uuid not null references stockcontrol.users (id) on delete cascade,
        issued_at timestamptz not null default now(),
        expires_at timestamptz not null,
        constraint sessions_expire_after_issue check (expires_at > issued_at)
      )
    `,
    "create index sessions_user_id_idx on stockcontrol.sessions (user_id)",
    "create index sessions_expires_at_idx on stockcontrol.sessions (expires_at)",
    `
      create table stockcontrol.jobs (
        id uuid primary key,
        number varchar(40) not null,
        name varchar(200) not null,
        customer varchar(200) not null,
        status varchar(20) not null default 'Open' check (status in ('Open', 'Closed')),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        closed_at timestamptz,
        constraint jobs_closed_at_matches_status check (
          (status = 'Closed') = (closed_at is not null)
        )
      )
    `,
    "create unique index jobs_number_key on stockcontrol.jobs (number)",
    "create index jobs_status_idx on stockcontrol.jobs (status)",
    `
      create table stockcontrol.locations (
        id uuid primary key,
        code varchar(40) not null,
        name varchar(200) not null,
        kind varchar(20) not null check (kind in ('Store', 'JobSite')),
        job_id uuid references stockcontrol.jobs (id) on delete restrict,
        is_active boolean not null default true,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint locations_job_site_has_job check ((kind = 'JobSite') = (job_id is not null))
      )
    `,
    "create unique index locations_code_key on stockcontrol.locations (code)",
    "create unique index locations_job_id_key on stockcontrol.locations (job_id) where job_id is not null",
    "create index locations_kind_idx on stockcontrol.locations (kind)",
    `
      create table stockcontrol.items (
        id uuid primary key,
        reference varchar(40) not null,
        name varchar(200) not null,
        unit varchar(20) not null,
        barcode varchar(80),
        part_number varchar(80),
        low_stock_threshold numeric(18, 3) check (low_stock_threshold >= 0),
        is_active boolean not null default true,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `,
    "create unique index items_reference_key on stockcontrol.items (reference)",
    "create unique index items_barcode_key on stockcontrol.items (barcode) where barcode is not null",
    "create index items_name_idx on stockcontrol.items (lower(name))",
    `
      create table stockcontrol.stock_levels (
        id uuid primary key,
        item_id uuid not null references stockcontrol.items (id) on delete restrict,
        location_id uuid not null references stockcontrol.locations (id) on delete restrict,
        quantity numeric(18, 3) not null default 0,
        updated_at timestamptz not null default now(),
        constraint stock_levels_quantity_not_negative check (quantity >= 0)
      )
    `,
    "create unique index stock_levels_item_location_key on stockcontrol.stock_levels (item_id, location_id)",
    "create index stock_levels_location_id_idx on stockcontrol.stock_levels (location_id)",
    `
      create table stockcontrol.reservations (
        id uuid primary key,
        job_id uuid not null references stockcontrol.jobs (id) on delete restrict,
        item_id uuid not null references stockcontrol.items (id) on delete restrict,
        quantity_reserved numeric(18, 3) not null check (quantity_reserved > 0),
        quantity_collected numeric(18, 3) not null default 0 check (quantity_collected >= 0),
        status varchar(20) not null default 'Open'
          check (status in ('Open', 'Fulfilled', 'Released')),
        created_by_user_id uuid not null references stockcontrol.users (id) on delete restrict,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint reservations_collected_within_reserved
          check (quantity_collected <= quantity_reserved)
      )
    `,
    "create index reservations_job_id_idx on stockcontrol.reservations (job_id)",
    "create index reservations_open_item_idx on stockcontrol.reservations (item_id) where status = 'Open'",
    `
      create table stockcontrol.transactions (
        id uuid primary key,
        kind varchar(20) not null check (
          kind in ('Receive', 'Issue', 'Transfer', 'Adjust', 'Reserve', 'Collect', 'Release')
        ),
        item_id uuid not null references stockcontrol.items (id) on delete restrict,
        quantity numeric(18, 3) not null check (quantity > 0),
        from_location_id uuid references stockcontrol.locations (id) on delete restrict,
        to_location_id uuid references stockcontrol.locations (id) on delete restrict,
        job_id uuid references stockcontrol.jobs (id) on delete restrict,
        reservation_id uuid references stockcontrol.reservations (id) on delete restrict,
        reason text,
        actor_user_id uuid not null references stockcontrol.users (id) on delete restrict,
        occurred_at timestamptz not null default now()
      )
    `,
    "create index transactions_occurred_at_idx on stockcontrol.transactions (occurred_at desc)",
    "create index transactions_item_id_idx on stockcontrol.transactions (item_id, occurred_at desc)",
    "create index transactions_job_id_idx on stockcontrol.transactions (job_id) where job_id is not null",
    "create index transactions_actor_user_id_idx on stockcontrol.transactions (actor_user_id)",
  ]),
  downStatements: Object.freeze([
    "drop table if exists stockcontrol.transactions",
    "drop table if exists stockcontrol.reservations",
    "drop table if exists stockcontrol.stock_levels",
    "drop table if exists stockcontrol.items",
    "drop table if exists stockcontrol.locations",
    "drop table if exists stockcontrol.jobs",
    "drop table if exists stockcontrol.sessions",
    "drop table if exists stockcontrol.users",
  ]),
} satisfies CanonicalMigrationDefinition);

const stock = createChecksummedMigration(stockMigrationDefinition);

export const stockMigration = stock.migration;
export const stockMigrationIntegrity = stock.descriptor;
