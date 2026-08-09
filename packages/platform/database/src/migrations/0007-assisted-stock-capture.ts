import { createChecksummedMigration, type CanonicalMigrationDefinition } from "./integrity";

/*
 * Assisted stock capture, specification section 11.
 *
 * Two shapes here are worth explaining before anybody extends them.
 *
 * Recognition evidence is operational state, not a business record. Sessions,
 * images, candidates and their reasons are deleted thirty days after the
 * session finishes; the stock transaction stays forever and remains the only
 * record of what was received. That is why nothing in the stock ledger
 * references a candidate: the ledger must survive the evidence being purged.
 *
 * `stock_recognition_jobs` is the durable queue ADR 0004 describes and nothing
 * had yet built. It is deliberately named for recognition rather than added to
 * the existing `jobs` table, which is the customer work-order entity and has
 * nothing to do with background work.
 */
export const assistedStockCaptureMigrationDefinition = Object.freeze({
  name: "0007_assisted_stock_capture",
  version: 7,
  upStatements: Object.freeze([
    `
      create table stockcontrol.stock_capture_batches (
        id uuid primary key,
        actor_user_id uuid not null references stockcontrol.users (id) on delete restrict,
        default_location_id uuid references stockcontrol.locations (id) on delete restrict,
        request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
        status varchar(20) not null default 'Open'
          check (status in ('Open', 'Completed', 'Cancelled')),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        closed_at timestamptz,
        constraint stock_capture_batches_closed_state check (
          (status = 'Open' and closed_at is null)
          or (status <> 'Open' and closed_at is not null)
        )
      )
    `,
    "create index stock_capture_batches_actor_idx on stockcontrol.stock_capture_batches (actor_user_id, created_at desc)",

    `
      create table stockcontrol.stock_recognition_sessions (
        id uuid primary key,
        batch_id uuid not null references stockcontrol.stock_capture_batches (id) on delete restrict,
        actor_user_id uuid not null references stockcontrol.users (id) on delete restrict,
        request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
        status varchar(32) not null default 'AwaitingUpload'
          check (status in (
            'AwaitingUpload', 'Queued', 'ProcessingBarcode', 'ProcessingImages',
            'Enriching', 'Fusing', 'ReviewReady', 'Committed', 'Failed',
            'Cancelled', 'Expired'
          )),
        photo_count smallint not null check (photo_count between 0 and 5),
        local_codes jsonb not null default '[]'::jsonb,
        model_manifest jsonb not null default '{}'::jsonb,
        selected_candidate_id uuid,
        committed_item_id uuid references stockcontrol.items (id) on delete restrict,
        failure_code varchar(80),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        expires_at timestamptz not null
      )
    `,
    "create index stock_recognition_sessions_batch_idx on stockcontrol.stock_recognition_sessions (batch_id, created_at)",
    "create index stock_recognition_sessions_expiry_idx on stockcontrol.stock_recognition_sessions (expires_at) where status not in ('Committed', 'Cancelled', 'Expired')",

    `
      create table stockcontrol.stock_recognition_images (
        id uuid primary key,
        session_id uuid not null references stockcontrol.stock_recognition_sessions (id) on delete restrict,
        ordinal smallint not null check (ordinal between 1 and 5),
        object_key varchar(512) not null,
        sha256 char(64) not null check (sha256 ~ '^[0-9a-f]{64}$'),
        media_type varchar(40) not null check (media_type in ('image/jpeg', 'image/webp')),
        byte_length bigint not null check (byte_length > 0),
        width integer not null check (width > 0),
        height integer not null check (height > 0),
        status varchar(24) not null default 'Pending'
          check (status in ('Pending', 'Verified', 'Rejected', 'Deleted')),
        embedding bytea,
        embedding_model varchar(120),
        crop_metadata jsonb not null default '{}'::jsonb,
        delete_after timestamptz not null,
        deleted_at timestamptz,
        created_at timestamptz not null default now()
      )
    `,
    "create unique index stock_recognition_images_session_ordinal on stockcontrol.stock_recognition_images (session_id, ordinal)",
    "create unique index stock_recognition_images_object_key on stockcontrol.stock_recognition_images (object_key)",
    /*
     * The janitor's query. Partial, because a tombstoned row is never claimed
     * again and there will be far more of those than live ones.
     */
    "create index stock_recognition_images_deletion_idx on stockcontrol.stock_recognition_images (delete_after) where deleted_at is null",

    `
      create table stockcontrol.stock_recognition_candidates (
        id uuid primary key,
        session_id uuid not null references stockcontrol.stock_recognition_sessions (id) on delete restrict,
        rank smallint not null check (rank between 1 and 5),
        kind varchar(20) not null check (kind in ('InternalItem', 'ExternalDraft')),
        item_id uuid references stockcontrol.items (id) on delete restrict,
        identity jsonb not null default '{}'::jsonb,
        confidence_band varchar(16) not null check (confidence_band in ('Strong', 'Possible', 'Weak')),
        fusion_score double precision not null,
        evidence jsonb not null default '[]'::jsonb,
        model_manifest jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        constraint stock_recognition_candidates_kind_item check (
          (kind = 'InternalItem' and item_id is not null)
          or (kind = 'ExternalDraft' and item_id is null)
        )
      )
    `,
    "create unique index stock_recognition_candidates_session_rank on stockcontrol.stock_recognition_candidates (session_id, rank)",

    `
      create table stockcontrol.stock_recognition_jobs (
        id uuid primary key,
        session_id uuid references stockcontrol.stock_recognition_sessions (id) on delete restrict,
        job_type varchar(40) not null
          check (job_type in ('Recognize', 'BuildExemplars', 'DeleteObjects')),
        payload_version smallint not null check (payload_version > 0),
        payload jsonb not null default '{}'::jsonb,
        status varchar(16) not null default 'Ready'
          check (status in ('Ready', 'Running', 'Succeeded', 'Retry', 'Failed')),
        deduplication_key varchar(200) not null,
        attempt_count smallint not null default 0 check (attempt_count >= 0),
        max_attempts smallint not null check (max_attempts > 0),
        available_at timestamptz not null default now(),
        lease_owner varchar(120),
        leased_until timestamptz,
        last_error_code varchar(80),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        completed_at timestamptz,
        constraint stock_recognition_jobs_lease_pairing check (
          (lease_owner is null and leased_until is null)
          or (lease_owner is not null and leased_until is not null)
        )
      )
    `,
    /*
     * The deduplication key is what makes enqueueing idempotent, so it is
     * unique across the whole table rather than per session — a cleanup job for
     * an object must not be queued twice by two different sessions.
     */
    "create unique index stock_recognition_jobs_deduplication_key on stockcontrol.stock_recognition_jobs (deduplication_key)",
    /*
     * The claim query, and the only index it may use: ordered by when work
     * became available, restricted to work that is actually claimable. Running
     * rows are included because an expired lease is reclaimed by the same query.
     */
    "create index stock_recognition_jobs_claim_idx on stockcontrol.stock_recognition_jobs (available_at, id) where status in ('Ready', 'Retry', 'Running')",
    "create index stock_recognition_jobs_session_idx on stockcontrol.stock_recognition_jobs (session_id)",

    `
      create table stockcontrol.item_visual_examples (
        id uuid primary key,
        item_id uuid not null references stockcontrol.items (id) on delete restrict,
        embedding bytea not null,
        embedding_model varchar(120) not null,
        crop_object_key varchar(512),
        source_session_id uuid references stockcontrol.stock_recognition_sessions (id) on delete set null,
        source_image_id uuid references stockcontrol.stock_recognition_images (id) on delete set null,
        verified_by_user_id uuid not null references stockcontrol.users (id) on delete restrict,
        quality_score real not null check (quality_score >= 0 and quality_score <= 1),
        created_at timestamptz not null default now(),
        retired_at timestamptz
      )
    `,
    /*
     * The retrieval index only ever reads live examples for the deployed model
     * revision, because an embedding produced by a different revision is not
     * comparable and a retired one is deliberately excluded.
     */
    "create index item_visual_examples_active_idx on stockcontrol.item_visual_examples (embedding_model, item_id) where retired_at is null",
    "create unique index item_visual_examples_crop_object_key on stockcontrol.item_visual_examples (crop_object_key) where crop_object_key is not null",

    `
      create table stockcontrol.stock_capture_entries (
        id uuid primary key,
        batch_id uuid not null references stockcontrol.stock_capture_batches (id) on delete restrict,
        session_id uuid not null references stockcontrol.stock_recognition_sessions (id) on delete restrict,
        actor_user_id uuid not null references stockcontrol.users (id) on delete restrict,
        request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
        status varchar(20) not null default 'Pending' check (status in ('Pending', 'Committed')),
        item_id uuid references stockcontrol.items (id) on delete restrict,
        transaction_id uuid references stockcontrol.transactions (id) on delete restrict,
        created_item boolean,
        created_at timestamptz not null default now(),
        committed_at timestamptz,
        constraint stock_capture_entries_result_state check (
          (status = 'Pending'
            and item_id is null and transaction_id is null
            and created_item is null and committed_at is null)
          or (status = 'Committed'
            and item_id is not null and transaction_id is not null
            and created_item is not null and committed_at is not null)
        )
      )
    `,
    /* One receipt per recognised item: a session can be committed exactly once. */
    "create unique index stock_capture_entries_session_key on stockcontrol.stock_capture_entries (session_id)",
    "create unique index stock_capture_entries_transaction_key on stockcontrol.stock_capture_entries (transaction_id) where transaction_id is not null",
    "create index stock_capture_entries_batch_idx on stockcontrol.stock_capture_entries (batch_id, created_at)",

    `
      create table stockcontrol.recognition_feedback (
        id uuid primary key,
        session_id uuid not null references stockcontrol.stock_recognition_sessions (id) on delete restrict,
        actor_user_id uuid not null references stockcontrol.users (id) on delete restrict,
        outcome varchar(16) not null check (outcome in ('Accepted', 'Edited', 'RejectedAll')),
        selected_rank smallint check (selected_rank between 1 and 5),
        final_item_id uuid references stockcontrol.items (id) on delete restrict,
        corrected_fields jsonb not null default '[]'::jsonb,
        shown_candidate_ids jsonb not null default '[]'::jsonb,
        stage_availability jsonb not null default '{}'::jsonb,
        timings jsonb not null default '{}'::jsonb,
        model_manifest jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      )
    `,
    "create unique index recognition_feedback_session_key on stockcontrol.recognition_feedback (session_id)",
  ]),
  downStatements: Object.freeze([
    "drop table if exists stockcontrol.recognition_feedback",
    "drop table if exists stockcontrol.stock_capture_entries",
    "drop table if exists stockcontrol.item_visual_examples",
    "drop table if exists stockcontrol.stock_recognition_jobs",
    "drop table if exists stockcontrol.stock_recognition_candidates",
    "drop table if exists stockcontrol.stock_recognition_images",
    "drop table if exists stockcontrol.stock_recognition_sessions",
    "drop table if exists stockcontrol.stock_capture_batches",
  ]),
} satisfies CanonicalMigrationDefinition);

const assistedStockCapture = createChecksummedMigration(assistedStockCaptureMigrationDefinition);

export const assistedStockCaptureMigration = assistedStockCapture.migration;
export const assistedStockCaptureMigrationIntegrity = assistedStockCapture.descriptor;
