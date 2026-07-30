import { createChecksummedMigration, type CanonicalMigrationDefinition } from "./integrity";

const capabilities = [
  "inventory.view",
  "inventory.take",
  "inventory.catalogue.manage",
  "inventory.receive",
  "inventory.transfer",
  "inventory.adjust",
  "inventory.condition.report",
  "inventory.condition.resolve",
  "inventory.writeoff.request",
  "inventory.writeoff.approve",
  "inventory.labels.print",
  "jobs.view",
  "jobs.create",
  "jobs.reservations.request",
  "jobs.reservations.manage",
  "jobs.reservations.collect",
  "jobs.reconciliation.submit",
  "jobs.reconciliation.approve",
  "jobs.override",
  "custody.view.own",
  "custody.view.all",
  "custody.allocations.manage",
  "custody.collect",
  "custody.transfers.request",
  "custody.transfers.approve",
  "custody.accept.on-behalf",
  "custody.override",
  "purchasing.request",
  "purchasing.view",
  "purchasing.process",
  "purchasing.buyer.approve-request",
  "purchasing.buyer.approve-order",
  "purchasing.receive",
  "purchasing.invoices.manage",
  "purchasing.payments.record",
  "purchasing.settings.manage",
  "purchasing.override",
  "locations.view",
  "locations.use",
  "locations.manage",
  "stocktakes.start",
  "stocktakes.enter",
  "stocktakes.recount",
  "stocktakes.variance.approve",
  "stocktakes.adjustment.post",
  "reports.inventory",
  "reports.operational",
  "reports.financial",
  "reports.export",
  "audit.view.own",
  "audit.view.operational",
  "audit.view.all",
  "audit.export",
  "users.view",
  "users.invite",
  "users.manage",
  "users.permissions.manage",
  "users.sessions.revoke",
  "users.mfa-recovery.approve",
  "administration.organisation.manage",
  "administration.safeguards.manage",
] as const;

const quotedCapabilities = capabilities.map((capability) => `'${capability}'`).join(", ");

export const identityMigrationDefinition = Object.freeze({
  name: "0002_identity",
  version: 1,
  upStatements: Object.freeze([
    `
      create table stockcontrol.identity_users (
        id uuid primary key,
        normalised_email varchar(254) not null unique,
        display_name varchar(200) not null,
        role varchar(20) not null,
        status varchar(20) not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        version integer not null default 1,
        constraint identity_users_email_normalised
          check (
            normalised_email = lower(btrim(normalised_email))
            and normalised_email ~ '^[^@[:space:]]+@[^@[:space:]]+$'
          ),
        constraint identity_users_display_name_valid
          check (
            display_name = btrim(display_name)
            and char_length(display_name) between 1 and 200
          ),
        constraint identity_users_role_valid
          check (role in ('Engineer', 'Office', 'Admin')),
        constraint identity_users_status_valid
          check (status in ('Invited', 'Active', 'Disabled')),
        constraint identity_users_version_positive check (version > 0)
      )
    `,
    `
      create table stockcontrol.identity_password_credentials (
        user_id uuid primary key
          references stockcontrol.identity_users(id) on delete restrict,
        password_hash varchar(500) not null,
        password_changed_at timestamptz not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        version integer not null default 1,
        constraint identity_password_hash_nonempty
          check (char_length(password_hash) between 20 and 500),
        constraint identity_password_version_positive check (version > 0)
      )
    `,
    `
      create table stockcontrol.identity_totp_credentials (
        id uuid primary key,
        user_id uuid not null
          references stockcontrol.identity_users(id) on delete restrict,
        status varchar(20) not null,
        secret_encryption_version smallint not null,
        secret_key_id varchar(100) not null,
        secret_nonce bytea not null,
        secret_ciphertext bytea not null,
        secret_auth_tag bytea not null,
        last_accepted_counter bigint,
        verified_at timestamptz,
        recovery_codes_acknowledged_at timestamptz,
        revoked_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        version integer not null default 1,
        constraint identity_totp_status_valid
          check (status in ('Pending', 'Active', 'Revoked')),
        constraint identity_totp_secret_key_nonempty
          check (char_length(btrim(secret_key_id)) between 1 and 100),
        constraint identity_totp_encryption_version
          check (secret_encryption_version = 1),
        constraint identity_totp_nonce_length check (octet_length(secret_nonce) = 12),
        constraint identity_totp_ciphertext_length check (octet_length(secret_ciphertext) = 32),
        constraint identity_totp_auth_tag_length check (octet_length(secret_auth_tag) = 16),
        constraint identity_totp_counter_nonnegative
          check (last_accepted_counter is null or last_accepted_counter >= 0),
        constraint identity_totp_lifecycle_consistent
          check (
            (
              status = 'Pending'
              and last_accepted_counter is null
              and verified_at is null
              and recovery_codes_acknowledged_at is null
              and revoked_at is null
            )
            or (
              status = 'Active'
              and last_accepted_counter is not null
              and verified_at is not null
              and recovery_codes_acknowledged_at is not null
              and revoked_at is null
            )
            or (status = 'Revoked' and revoked_at is not null)
          ),
        constraint identity_totp_timestamps_consistent
          check (
            updated_at >= created_at
            and (verified_at is null or verified_at >= created_at)
            and (
              recovery_codes_acknowledged_at is null
              or (
                verified_at is not null
                and recovery_codes_acknowledged_at >= verified_at
              )
            )
            and (revoked_at is null or revoked_at >= created_at)
          ),
        unique (id, user_id),
        constraint identity_totp_version_positive check (version > 0)
      )
    `,
    `
      create unique index identity_totp_one_active_per_user
      on stockcontrol.identity_totp_credentials(user_id)
      where status = 'Active'
    `,
    `
      create table stockcontrol.identity_recovery_codes (
        id uuid primary key,
        user_id uuid not null
          references stockcontrol.identity_users(id) on delete restrict,
        totp_credential_id uuid not null,
        code_hash bytea not null,
        created_at timestamptz not null default now(),
        used_at timestamptz,
        revoked_at timestamptz,
        constraint identity_recovery_code_totp_owner
          foreign key (totp_credential_id, user_id)
          references stockcontrol.identity_totp_credentials(id, user_id)
          on delete restrict,
        constraint identity_recovery_code_hash_length
          check (octet_length(code_hash) = 32),
        constraint identity_recovery_code_terminal_state
          check (
            (used_at is null or revoked_at is null)
            and (used_at is null or used_at >= created_at)
            and (revoked_at is null or revoked_at >= created_at)
          ),
        unique (user_id, code_hash)
      )
    `,
    `
      create index identity_recovery_codes_available
      on stockcontrol.identity_recovery_codes(user_id)
      where used_at is null and revoked_at is null
    `,
    `
      create table stockcontrol.identity_permission_overrides (
        user_id uuid not null
          references stockcontrol.identity_users(id) on delete restrict,
        capability varchar(100) not null,
        setting varchar(20) not null,
        catalogue_version integer not null,
        updated_by_user_id uuid not null
          references stockcontrol.identity_users(id) on delete restrict,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        primary key (user_id, capability),
        constraint identity_permission_capability_valid
          check (capability in (${quotedCapabilities})),
        constraint identity_permission_setting_valid
          check (setting in ('Allow', 'Deny')),
        constraint identity_permission_catalogue_version_valid
          check (catalogue_version = 1)
      )
    `,
    `
      create table stockcontrol.identity_sessions (
        id uuid primary key,
        user_id uuid not null
          references stockcontrol.identity_users(id) on delete restrict,
        token_hash bytea not null unique,
        authentication_method varchar(40) not null,
        assurance_level varchar(20) not null,
        issued_at timestamptz not null,
        last_seen_at timestamptz not null,
        idle_expires_at timestamptz not null,
        absolute_expires_at timestamptz not null,
        reauthenticated_at timestamptz,
        revoked_at timestamptz,
        revoke_reason varchar(200),
        created_ip_hash bytea,
        user_agent varchar(500),
        version integer not null default 1,
        constraint identity_session_token_hash_length
          check (octet_length(token_hash) = 32),
        constraint identity_session_authentication_method_valid
          check (
            authentication_method in (
              'Password',
              'PasswordAndTotp',
              'PasswordAndRecoveryCode'
            )
          ),
        constraint identity_session_assurance_valid
          check (
            (authentication_method = 'Password' and assurance_level = 'SingleFactor')
            or (
              authentication_method in ('PasswordAndTotp', 'PasswordAndRecoveryCode')
              and assurance_level = 'MultiFactor'
            )
          ),
        constraint identity_session_ip_hash_length
          check (created_ip_hash is null or octet_length(created_ip_hash) = 32),
        constraint identity_session_expiry_order
          check (
            issued_at <= last_seen_at
            and last_seen_at <= idle_expires_at
            and idle_expires_at <= absolute_expires_at
            and absolute_expires_at <= issued_at + interval '12 hours'
            and idle_expires_at <= last_seen_at + interval '2 hours'
            and (
              reauthenticated_at is null
              or reauthenticated_at between issued_at and last_seen_at
            )
          ),
        constraint identity_session_revocation_consistent
          check (
            (revoked_at is null and revoke_reason is null)
            or (
              revoked_at is not null
              and revoked_at >= issued_at
              and revoke_reason is not null
              and char_length(btrim(revoke_reason)) between 1 and 200
            )
          ),
        constraint identity_session_version_positive check (version > 0)
      )
    `,
    `
      create index identity_sessions_active_by_user
      on stockcontrol.identity_sessions(user_id, absolute_expires_at)
      where revoked_at is null
    `,
    `
      create table stockcontrol.identity_auth_challenges (
        id uuid primary key,
        user_id uuid not null
          references stockcontrol.identity_users(id) on delete restrict,
        purpose varchar(40) not null,
        token_hash bytea not null unique,
        context jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        expires_at timestamptz not null,
        consumed_at timestamptz,
        attempt_count integer not null default 0,
        maximum_attempts integer not null,
        version integer not null default 1,
        constraint identity_auth_challenge_purpose_valid
          check (purpose in ('BootstrapMfa', 'SignInMfa', 'Reauthenticate')),
        constraint identity_auth_challenge_token_hash_length
          check (octet_length(token_hash) = 32),
        constraint identity_auth_challenge_expiry_valid
          check (
            expires_at > created_at
            and expires_at <= created_at + interval '1 hour'
          ),
        constraint identity_auth_challenge_attempts_valid
          check (
            attempt_count >= 0
            and maximum_attempts between 1 and 100
            and attempt_count <= maximum_attempts
          ),
        constraint identity_auth_challenge_consumption_valid
          check (
            consumed_at is null
            or consumed_at between created_at and expires_at
          ),
        constraint identity_auth_challenge_version_positive check (version > 0)
      )
    `,
    `
      create index identity_auth_challenges_open
      on stockcontrol.identity_auth_challenges(user_id, purpose, expires_at)
      where consumed_at is null
    `,
    `
      create table stockcontrol.identity_invitations (
        id uuid primary key,
        user_id uuid not null
          references stockcontrol.identity_users(id) on delete restrict,
        invited_by_user_id uuid not null
          references stockcontrol.identity_users(id) on delete restrict,
        token_hash bytea not null unique,
        created_at timestamptz not null default now(),
        expires_at timestamptz not null,
        accepted_at timestamptz,
        revoked_at timestamptz,
        version integer not null default 1,
        constraint identity_invitation_token_hash_length
          check (octet_length(token_hash) = 32),
        constraint identity_invitation_expiry_valid
          check (
            expires_at > created_at
            and expires_at <= created_at + interval '3 days'
          ),
        constraint identity_invitation_terminal_state
          check (
            (accepted_at is null or revoked_at is null)
            and (accepted_at is null or accepted_at between created_at and expires_at)
            and (revoked_at is null or revoked_at >= created_at)
          ),
        constraint identity_invitation_version_positive check (version > 0)
      )
    `,
    `
      create unique index identity_invitations_one_open_per_user
      on stockcontrol.identity_invitations(user_id)
      where accepted_at is null and revoked_at is null
    `,
    `
      create table stockcontrol.identity_password_resets (
        id uuid primary key,
        user_id uuid not null
          references stockcontrol.identity_users(id) on delete restrict,
        token_hash bytea not null unique,
        requested_at timestamptz not null,
        expires_at timestamptz not null,
        completed_at timestamptz,
        revoked_at timestamptz,
        version integer not null default 1,
        constraint identity_password_reset_token_hash_length
          check (octet_length(token_hash) = 32),
        constraint identity_password_reset_expiry_valid
          check (
            expires_at > requested_at
            and expires_at <= requested_at + interval '1 hour'
          ),
        constraint identity_password_reset_terminal_state
          check (
            (completed_at is null or revoked_at is null)
            and (
              completed_at is null
              or completed_at between requested_at and expires_at
            )
            and (revoked_at is null or revoked_at >= requested_at)
          ),
        constraint identity_password_reset_version_positive check (version > 0)
      )
    `,
    `
      create index identity_password_resets_open
      on stockcontrol.identity_password_resets(user_id, expires_at)
      where completed_at is null and revoked_at is null
    `,
    `
      create table stockcontrol.identity_rate_limit_buckets (
        bucket_key_hash bytea not null,
        scope varchar(50) not null,
        window_started_at timestamptz not null,
        expires_at timestamptz not null,
        attempt_count integer not null default 0,
        blocked_until timestamptz,
        updated_at timestamptz not null default now(),
        version integer not null default 1,
        primary key (bucket_key_hash, scope),
        constraint identity_rate_limit_key_hash_length
          check (octet_length(bucket_key_hash) = 32),
        constraint identity_rate_limit_scope_nonempty
          check (char_length(btrim(scope)) between 1 and 50),
        constraint identity_rate_limit_window_valid check (expires_at > window_started_at),
        constraint identity_rate_limit_block_valid
          check (blocked_until is null or blocked_until >= window_started_at),
        constraint identity_rate_limit_attempts_valid check (attempt_count >= 0),
        constraint identity_rate_limit_version_positive check (version > 0)
      )
    `,
    `
      create index identity_rate_limit_expiry
      on stockcontrol.identity_rate_limit_buckets(expires_at)
    `,
    `
      create table stockcontrol.identity_security_policy (
        singleton_key smallint primary key default 1,
        password_minimum_length integer not null default 12,
        password_maximum_length integer not null default 128,
        admin_mfa_required boolean not null default true,
        standard_session_idle_seconds integer not null default 7200,
        admin_session_idle_seconds integer not null default 1800,
        session_absolute_seconds integer not null default 43200,
        recent_authentication_seconds integer not null default 900,
        auth_challenge_seconds integer not null default 600,
        invitation_seconds integer not null default 259200,
        password_reset_seconds integer not null default 3600,
        permission_catalogue_version integer not null default 1,
        updated_at timestamptz not null default now(),
        version integer not null default 1,
        constraint identity_security_policy_singleton check (singleton_key = 1),
        constraint identity_security_policy_password_lengths
          check (
            password_minimum_length >= 12
            and password_maximum_length >= password_minimum_length
            and password_maximum_length <= 1024
          ),
        constraint identity_security_policy_admin_mfa_required check (admin_mfa_required),
        constraint identity_security_policy_session_limits
          check (
            standard_session_idle_seconds between 60 and 7200
            and admin_session_idle_seconds between 60 and 1800
            and admin_session_idle_seconds <= standard_session_idle_seconds
            and session_absolute_seconds between standard_session_idle_seconds and 43200
            and recent_authentication_seconds between 60 and 3600
          ),
        constraint identity_security_policy_token_lifetimes
          check (
            auth_challenge_seconds between 60 and 3600
            and invitation_seconds between 300 and 259200
            and password_reset_seconds between 300 and 3600
          ),
        constraint identity_security_policy_catalogue_version
          check (permission_catalogue_version = 1),
        constraint identity_security_policy_version_positive check (version > 0)
      )
    `,
    `
      insert into stockcontrol.identity_security_policy (singleton_key)
      values (1)
    `,
    `
      create table stockcontrol.identity_mfa_recovery_requests (
        id uuid primary key,
        subject_user_id uuid not null
          references stockcontrol.identity_users(id) on delete restrict,
        requested_by_user_id uuid not null
          references stockcontrol.identity_users(id) on delete restrict,
        approval_method varchar(30),
        approved_by_user_id uuid
          references stockcontrol.identity_users(id) on delete restrict,
        vendor_case_reference varchar(200),
        status varchar(20) not null,
        reason varchar(1000) not null,
        requested_at timestamptz not null default now(),
        expires_at timestamptz not null,
        resolved_at timestamptz,
        completed_at timestamptz,
        version integer not null default 1,
        constraint identity_mfa_recovery_status_valid
          check (status in ('Pending', 'Approved', 'Rejected', 'Cancelled', 'Completed', 'Expired')),
        constraint identity_mfa_recovery_reason_nonempty
          check (char_length(btrim(reason)) between 1 and 1000),
        constraint identity_mfa_recovery_expiry_valid
          check (
            expires_at > requested_at
            and expires_at <= requested_at + interval '7 days'
          ),
        constraint identity_mfa_recovery_separation
          check (
            approved_by_user_id is null
            or (
              approved_by_user_id <> requested_by_user_id
              and approved_by_user_id <> subject_user_id
            )
          ),
        constraint identity_mfa_recovery_approval_valid
          check (
            (
              (
                approval_method is null
                and approved_by_user_id is null
                and vendor_case_reference is null
              )
              or (
                approval_method = 'ActiveAdmin'
                and approved_by_user_id is not null
                and vendor_case_reference is null
              )
              or (
                approval_method = 'VendorVerification'
                and approved_by_user_id is null
                and vendor_case_reference is not null
                and vendor_case_reference = btrim(vendor_case_reference)
                and char_length(vendor_case_reference) between 1 and 200
              )
            ) is true
          ),
        constraint identity_mfa_recovery_lifecycle
          check (
            (status = 'Pending' and approval_method is null and resolved_at is null and completed_at is null)
            or (status = 'Approved' and approval_method is not null and resolved_at is not null and completed_at is null)
            or (status = 'Completed' and approval_method is not null and resolved_at is not null and completed_at is not null)
            or (status in ('Rejected', 'Cancelled', 'Expired') and resolved_at is not null and completed_at is null)
          ),
        constraint identity_mfa_recovery_timestamps
          check (
            (resolved_at is null or resolved_at >= requested_at)
            and (completed_at is null or completed_at >= resolved_at)
          ),
        constraint identity_mfa_recovery_version_positive check (version > 0)
      )
    `,
    `
      create table stockcontrol.identity_bootstrap_state (
        singleton_key smallint primary key default 1,
        secret_hash bytea,
        expires_at timestamptz,
        completed_at timestamptz,
        completed_by_user_id uuid
          references stockcontrol.identity_users(id) on delete restrict,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        version integer not null default 1,
        constraint identity_bootstrap_singleton check (singleton_key = 1),
        constraint identity_bootstrap_secret_hash_length
          check (secret_hash is null or octet_length(secret_hash) = 32),
        constraint identity_bootstrap_lifecycle
          check (
            updated_at >= created_at
            and (
              (
                completed_at is null
                and completed_by_user_id is null
                and secret_hash is not null
                and expires_at is not null
                and expires_at > updated_at
                and expires_at <= updated_at + interval '1 hour'
              )
              or (
                completed_at is not null
                and completed_by_user_id is not null
                and secret_hash is null
                and expires_at is null
                and completed_at between created_at and updated_at
              )
            )
          ),
        constraint identity_bootstrap_version_positive check (version > 0)
      )
    `,
    `
      create table stockcontrol.identity_audit_events (
        id uuid primary key,
        sequence bigint not null unique,
        occurred_at timestamptz not null,
        event_type varchar(100) not null,
        outcome varchar(20) not null,
        actor_user_id uuid
          references stockcontrol.identity_users(id) on delete restrict,
        subject_user_id uuid
          references stockcontrol.identity_users(id) on delete restrict,
        session_id uuid
          references stockcontrol.identity_sessions(id) on delete restrict,
        correlation_id varchar(128) not null,
        remote_address_hash bytea,
        details jsonb not null default '{}'::jsonb,
        previous_event_hash bytea,
        integrity_version smallint not null,
        integrity_key_id varchar(100) not null,
        event_hash bytea not null unique,
        constraint identity_audit_event_type_nonempty
          check (char_length(btrim(event_type)) between 1 and 100),
        constraint identity_audit_correlation_id_valid
          check (correlation_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
        constraint identity_audit_outcome_valid
          check (outcome in ('Succeeded', 'Denied', 'Failed')),
        constraint identity_audit_remote_hash_length
          check (remote_address_hash is null or octet_length(remote_address_hash) = 32),
        constraint identity_audit_previous_hash_length
          check (previous_event_hash is null or octet_length(previous_event_hash) = 32),
        constraint identity_audit_integrity_version check (integrity_version = 1),
        constraint identity_audit_integrity_key_id_valid
          check (integrity_key_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
        constraint identity_audit_event_hash_length
          check (octet_length(event_hash) = 32),
        constraint identity_audit_chain_position
          check (
            (sequence = 1 and previous_event_hash is null)
            or (sequence > 1 and previous_event_hash is not null)
          )
      )
    `,
    `
      create table stockcontrol.identity_audit_chain_head (
        singleton_key smallint primary key default 1,
        last_sequence bigint not null default 0,
        last_event_id uuid,
        last_event_hash bytea,
        updated_at timestamptz not null default now(),
        constraint identity_audit_chain_head_singleton check (singleton_key = 1),
        constraint identity_audit_chain_head_position
          check (
            (
              last_sequence = 0
              and last_event_id is null
              and last_event_hash is null
            )
            or (
              last_sequence > 0
              and last_event_id is not null
              and last_event_hash is not null
              and octet_length(last_event_hash) = 32
            )
          )
      )
    `,
    `
      insert into stockcontrol.identity_audit_chain_head (singleton_key)
      values (1)
    `,
    `
      create index identity_audit_events_timeline
      on stockcontrol.identity_audit_events(sequence desc)
    `,
    `
      create function stockcontrol.prevent_identity_audit_event_mutation()
      returns trigger
      language plpgsql
      as $identity_audit_immutable$
      begin
        raise exception using
          errcode = '55000',
          message = 'Identity audit events are append-only.';
      end;
      $identity_audit_immutable$
    `,
    `
      create trigger identity_audit_events_append_only
      before update or delete on stockcontrol.identity_audit_events
      for each row execute function stockcontrol.prevent_identity_audit_event_mutation()
    `,
    `
      create function stockcontrol.enforce_identity_audit_event_chain_link()
      returns trigger
      language plpgsql
      as $identity_audit_chain_link$
      begin
        if (
          new.sequence > 1
          and not exists (
            select 1
            from stockcontrol.identity_audit_events as previous_event
            where previous_event.sequence = new.sequence - 1
              and previous_event.event_hash = new.previous_event_hash
          )
        ) or not exists (
          select 1
          from stockcontrol.identity_audit_chain_head
          where singleton_key = 1
            and last_sequence >= new.sequence
        ) then
          raise exception using
            errcode = '23514',
            constraint = 'identity_audit_chain_link_required',
            message = 'Identity audit events must extend the serialized audit chain.';
        end if;

        return null;
      end;
      $identity_audit_chain_link$
    `,
    `
      create constraint trigger identity_audit_event_chain_link
      after insert on stockcontrol.identity_audit_events
      deferrable initially deferred
      for each row execute function stockcontrol.enforce_identity_audit_event_chain_link()
    `,
    `
      create function stockcontrol.enforce_identity_audit_chain_head()
      returns trigger
      language plpgsql
      as $identity_audit_chain_head$
      begin
        if new.last_sequence <> old.last_sequence + 1
        or not exists (
          select 1
          from stockcontrol.identity_audit_events as appended_event
          where appended_event.sequence = new.last_sequence
            and appended_event.id = new.last_event_id
            and appended_event.event_hash = new.last_event_hash
        ) or (
          exists (
            select 1
            from stockcontrol.identity_audit_chain_head as current_head
            where current_head.singleton_key = 1
              and current_head.last_sequence = new.last_sequence
          )
          and exists (
            select 1
            from stockcontrol.identity_audit_events as later_event
            where later_event.sequence > new.last_sequence
          )
        ) then
          raise exception using
            errcode = '23514',
            constraint = 'identity_audit_chain_head_consistent',
            message = 'The identity audit chain head must reference its final event.';
        end if;

        return null;
      end;
      $identity_audit_chain_head$
    `,
    `
      create constraint trigger identity_audit_chain_head_consistent
      after update on stockcontrol.identity_audit_chain_head
      deferrable initially deferred
      for each row execute function stockcontrol.enforce_identity_audit_chain_head()
    `,
    `
      create function stockcontrol.enforce_identity_version_progression()
      returns trigger
      language plpgsql
      as $identity_version_progression$
      begin
        if TG_OP = 'INSERT' then
          if new.version <> 1 then
            raise exception using
              errcode = '55000',
              message = format('%I must start at version 1.', TG_TABLE_NAME);
          end if;
        elsif new.version <> old.version + 1 then
          raise exception using
            errcode = '55000',
            message = format('%I version must advance by exactly one.', TG_TABLE_NAME);
        end if;

        return new;
      end;
      $identity_version_progression$
    `,
    `
      create trigger identity_users_version_progression
      before insert or update on stockcontrol.identity_users
      for each row execute function stockcontrol.enforce_identity_version_progression()
    `,
    `
      create trigger identity_passwords_version_progression
      before insert or update on stockcontrol.identity_password_credentials
      for each row execute function stockcontrol.enforce_identity_version_progression()
    `,
    `
      create trigger identity_totp_version_progression
      before insert or update on stockcontrol.identity_totp_credentials
      for each row execute function stockcontrol.enforce_identity_version_progression()
    `,
    `
      create trigger identity_sessions_version_progression
      before insert or update on stockcontrol.identity_sessions
      for each row execute function stockcontrol.enforce_identity_version_progression()
    `,
    `
      create trigger identity_auth_challenges_version_progression
      before insert or update on stockcontrol.identity_auth_challenges
      for each row execute function stockcontrol.enforce_identity_version_progression()
    `,
    `
      create trigger identity_invitations_version_progression
      before insert or update on stockcontrol.identity_invitations
      for each row execute function stockcontrol.enforce_identity_version_progression()
    `,
    `
      create trigger identity_password_resets_version_progression
      before insert or update on stockcontrol.identity_password_resets
      for each row execute function stockcontrol.enforce_identity_version_progression()
    `,
    `
      create trigger identity_rate_limits_version_progression
      before insert or update on stockcontrol.identity_rate_limit_buckets
      for each row execute function stockcontrol.enforce_identity_version_progression()
    `,
    `
      create trigger identity_security_policy_version_progression
      before insert or update on stockcontrol.identity_security_policy
      for each row execute function stockcontrol.enforce_identity_version_progression()
    `,
    `
      create trigger identity_mfa_recovery_version_progression
      before insert or update on stockcontrol.identity_mfa_recovery_requests
      for each row execute function stockcontrol.enforce_identity_version_progression()
    `,
    `
      create trigger identity_bootstrap_version_progression
      before insert or update on stockcontrol.identity_bootstrap_state
      for each row execute function stockcontrol.enforce_identity_version_progression()
    `,
    `
      create function stockcontrol.prevent_identity_immutable_column_mutation()
      returns trigger
      language plpgsql
      as $identity_immutable_columns$
      declare
        immutable_column text;
      begin
        foreach immutable_column in array TG_ARGV loop
          if (to_jsonb(old) -> immutable_column)
            is distinct from (to_jsonb(new) -> immutable_column) then
            raise exception using
              errcode = '55000',
              message = format(
                'Immutable identity column %I.%I cannot be changed.',
                TG_TABLE_NAME,
                immutable_column
              );
          end if;
        end loop;

        return new;
      end;
      $identity_immutable_columns$
    `,
    `
      create trigger identity_users_immutable_columns
      before update on stockcontrol.identity_users
      for each row execute function
        stockcontrol.prevent_identity_immutable_column_mutation('id', 'created_at')
    `,
    `
      create trigger identity_passwords_immutable_columns
      before update on stockcontrol.identity_password_credentials
      for each row execute function
        stockcontrol.prevent_identity_immutable_column_mutation('user_id', 'created_at')
    `,
    `
      create trigger identity_totp_immutable_columns
      before update on stockcontrol.identity_totp_credentials
      for each row execute function
        stockcontrol.prevent_identity_immutable_column_mutation('id', 'user_id', 'created_at')
    `,
    `
      create trigger identity_recovery_codes_immutable_columns
      before update on stockcontrol.identity_recovery_codes
      for each row execute function
        stockcontrol.prevent_identity_immutable_column_mutation(
          'id',
          'user_id',
          'totp_credential_id',
          'code_hash',
          'created_at'
        )
    `,
    `
      create trigger identity_permissions_immutable_columns
      before update on stockcontrol.identity_permission_overrides
      for each row execute function
        stockcontrol.prevent_identity_immutable_column_mutation(
          'user_id',
          'capability',
          'catalogue_version',
          'created_at'
        )
    `,
    `
      create trigger identity_sessions_immutable_columns
      before update on stockcontrol.identity_sessions
      for each row execute function
        stockcontrol.prevent_identity_immutable_column_mutation(
          'id',
          'user_id',
          'token_hash',
          'authentication_method',
          'assurance_level',
          'issued_at',
          'absolute_expires_at',
          'created_ip_hash',
          'user_agent'
        )
    `,
    `
      create trigger identity_auth_challenges_immutable_columns
      before update on stockcontrol.identity_auth_challenges
      for each row execute function
        stockcontrol.prevent_identity_immutable_column_mutation(
          'id',
          'user_id',
          'purpose',
          'token_hash',
          'context',
          'created_at',
          'expires_at',
          'maximum_attempts'
        )
    `,
    `
      create trigger identity_invitations_immutable_columns
      before update on stockcontrol.identity_invitations
      for each row execute function
        stockcontrol.prevent_identity_immutable_column_mutation(
          'id',
          'user_id',
          'invited_by_user_id',
          'token_hash',
          'created_at',
          'expires_at'
        )
    `,
    `
      create trigger identity_password_resets_immutable_columns
      before update on stockcontrol.identity_password_resets
      for each row execute function
        stockcontrol.prevent_identity_immutable_column_mutation(
          'id',
          'user_id',
          'token_hash',
          'requested_at',
          'expires_at'
        )
    `,
    `
      create trigger identity_rate_limits_immutable_columns
      before update on stockcontrol.identity_rate_limit_buckets
      for each row execute function
        stockcontrol.prevent_identity_immutable_column_mutation('bucket_key_hash', 'scope')
    `,
    `
      create trigger identity_security_policy_immutable_columns
      before update on stockcontrol.identity_security_policy
      for each row execute function
        stockcontrol.prevent_identity_immutable_column_mutation('singleton_key')
    `,
    `
      create trigger identity_mfa_recovery_immutable_columns
      before update on stockcontrol.identity_mfa_recovery_requests
      for each row execute function
        stockcontrol.prevent_identity_immutable_column_mutation(
          'id',
          'subject_user_id',
          'requested_by_user_id',
          'reason',
          'requested_at',
          'expires_at'
        )
    `,
    `
      create trigger identity_bootstrap_immutable_columns
      before update on stockcontrol.identity_bootstrap_state
      for each row execute function
        stockcontrol.prevent_identity_immutable_column_mutation('singleton_key', 'created_at')
    `,
    `
      create function stockcontrol.enforce_identity_security_state_progression()
      returns trigger
      language plpgsql
      as $identity_security_state_progression$
      declare
        old_record jsonb := to_jsonb(old);
        new_record jsonb := to_jsonb(new);
      begin
        if (
          TG_TABLE_NAME = 'identity_totp_credentials'
          and (old_record ->> 'last_accepted_counter') is not null
          and (
            (new_record ->> 'last_accepted_counter') is null
            or (new_record ->> 'last_accepted_counter')::bigint
              < (old_record ->> 'last_accepted_counter')::bigint
          )
        ) or (
          TG_TABLE_NAME = 'identity_auth_challenges'
          and (new_record ->> 'attempt_count')::integer
            < (old_record ->> 'attempt_count')::integer
        ) or (
          TG_TABLE_NAME = 'identity_sessions'
          and (new_record ->> 'last_seen_at')::timestamptz
            < (old_record ->> 'last_seen_at')::timestamptz
        ) or (
          TG_TABLE_NAME = 'identity_rate_limit_buckets'
          and (
            (new_record ->> 'window_started_at')::timestamptz
              < (old_record ->> 'window_started_at')::timestamptz
            or (
              (new_record ->> 'window_started_at')::timestamptz
                = (old_record ->> 'window_started_at')::timestamptz
              and (
                (new_record ->> 'attempt_count')::integer
                  < (old_record ->> 'attempt_count')::integer
                or (
                  (old_record ->> 'blocked_until') is not null
                  and (
                    (new_record ->> 'blocked_until') is null
                    or (new_record ->> 'blocked_until')::timestamptz
                      < (old_record ->> 'blocked_until')::timestamptz
                  )
                )
              )
            )
          )
        ) then
          raise exception using
            errcode = '55000',
            message = format('%I security state cannot regress.', TG_TABLE_NAME);
        end if;

        return new;
      end;
      $identity_security_state_progression$
    `,
    `
      create trigger identity_totp_security_state_progression
      before update on stockcontrol.identity_totp_credentials
      for each row execute function stockcontrol.enforce_identity_security_state_progression()
    `,
    `
      create trigger identity_auth_challenges_security_state_progression
      before update on stockcontrol.identity_auth_challenges
      for each row execute function stockcontrol.enforce_identity_security_state_progression()
    `,
    `
      create trigger identity_sessions_security_state_progression
      before update on stockcontrol.identity_sessions
      for each row execute function stockcontrol.enforce_identity_security_state_progression()
    `,
    `
      create trigger identity_rate_limits_security_state_progression
      before update on stockcontrol.identity_rate_limit_buckets
      for each row execute function stockcontrol.enforce_identity_security_state_progression()
    `,
    `
      create function stockcontrol.prevent_identity_terminal_record_mutation()
      returns trigger
      language plpgsql
      as $identity_terminal_immutable$
      declare
        terminal_column text;
        terminal_value jsonb;
      begin
        foreach terminal_column in array TG_ARGV loop
          terminal_value := to_jsonb(old) -> terminal_column;
          if terminal_value is not null and terminal_value <> 'null'::jsonb then
            raise exception using
              errcode = '55000',
              message = format(
                'Terminal identity record in %I cannot be changed.',
                TG_TABLE_NAME
              );
          end if;
        end loop;

        return new;
      end;
      $identity_terminal_immutable$
    `,
    `
      create trigger identity_sessions_terminal_immutable
      before update on stockcontrol.identity_sessions
      for each row execute function
        stockcontrol.prevent_identity_terminal_record_mutation('revoked_at')
    `,
    `
      create trigger identity_auth_challenges_terminal_immutable
      before update on stockcontrol.identity_auth_challenges
      for each row execute function
        stockcontrol.prevent_identity_terminal_record_mutation('consumed_at')
    `,
    `
      create trigger identity_invitations_terminal_immutable
      before update on stockcontrol.identity_invitations
      for each row execute function
        stockcontrol.prevent_identity_terminal_record_mutation('accepted_at', 'revoked_at')
    `,
    `
      create trigger identity_password_resets_terminal_immutable
      before update on stockcontrol.identity_password_resets
      for each row execute function
        stockcontrol.prevent_identity_terminal_record_mutation('completed_at', 'revoked_at')
    `,
    `
      create trigger identity_recovery_codes_terminal_immutable
      before update on stockcontrol.identity_recovery_codes
      for each row execute function
        stockcontrol.prevent_identity_terminal_record_mutation('used_at', 'revoked_at')
    `,
    `
      create trigger identity_bootstrap_terminal_immutable
      before update on stockcontrol.identity_bootstrap_state
      for each row execute function
        stockcontrol.prevent_identity_terminal_record_mutation('completed_at')
    `,
    `
      create function stockcontrol.enforce_identity_lifecycle_transition()
      returns trigger
      language plpgsql
      as $identity_lifecycle_transition$
      begin
        if (
          TG_TABLE_NAME = 'identity_users'
          and old.status in ('Active', 'Disabled')
          and new.status = 'Invited'
        ) or (
          TG_TABLE_NAME = 'identity_totp_credentials'
          and (
            old.status = 'Revoked'
            or (old.status = 'Active' and new.status = 'Pending')
          )
        ) or (
          TG_TABLE_NAME = 'identity_mfa_recovery_requests'
          and (
            old.status in ('Rejected', 'Cancelled', 'Completed', 'Expired')
            or (old.status = 'Approved' and new.status = 'Pending')
          )
        ) then
          raise exception using
            errcode = '55000',
            message = format(
              'Identity lifecycle in %I cannot move from %s to %s.',
              TG_TABLE_NAME,
              old.status,
              new.status
            );
        end if;

        return new;
      end;
      $identity_lifecycle_transition$
    `,
    `
      create trigger identity_users_lifecycle_transition
      before update on stockcontrol.identity_users
      for each row execute function stockcontrol.enforce_identity_lifecycle_transition()
    `,
    `
      create trigger identity_totp_lifecycle_transition
      before update on stockcontrol.identity_totp_credentials
      for each row execute function stockcontrol.enforce_identity_lifecycle_transition()
    `,
    `
      create trigger identity_mfa_recovery_lifecycle_transition
      before update on stockcontrol.identity_mfa_recovery_requests
      for each row execute function stockcontrol.enforce_identity_lifecycle_transition()
    `,
    `
      create function stockcontrol.enforce_active_session_user()
      returns trigger
      language plpgsql
      as $identity_active_session_user$
      begin
        if exists (
          select 1
          from stockcontrol.identity_sessions as identity_session
          inner join stockcontrol.identity_users as identity_user
            on identity_user.id = identity_session.user_id
          where identity_user.status <> 'Active'
            and identity_session.revoked_at is null
            and identity_session.idle_expires_at > current_timestamp
            and identity_session.absolute_expires_at > current_timestamp
        ) then
          raise exception using
            errcode = '23514',
            constraint = 'identity_active_session_user_required',
            message = 'A live session requires an active user.';
        end if;

        return null;
      end;
      $identity_active_session_user$
    `,
    `
      create constraint trigger identity_sessions_active_user
      after insert or update or delete on stockcontrol.identity_sessions
      deferrable initially deferred
      for each row execute function stockcontrol.enforce_active_session_user()
    `,
    `
      create constraint trigger identity_users_active_session
      after insert or update or delete on stockcontrol.identity_users
      deferrable initially deferred
      for each row execute function stockcontrol.enforce_active_session_user()
    `,
    `
      create function stockcontrol.enforce_identity_session_role_security()
      returns trigger
      language plpgsql
      as $identity_session_role_security$
      begin
        if exists (
          select 1
          from stockcontrol.identity_sessions as identity_session
          inner join stockcontrol.identity_users as identity_user
            on identity_user.id = identity_session.user_id
          where identity_session.id = new.id
            and identity_session.revoked_at is null
            and (
              (
                identity_user.role = 'Admin'
                and identity_session.assurance_level <> 'MultiFactor'
              )
              or identity_session.idle_expires_at
                > identity_session.last_seen_at + (
                  case
                    when identity_user.role = 'Admin' then interval '30 minutes'
                    else interval '2 hours'
                  end
                )
            )
        ) then
          raise exception using
            errcode = '23514',
            constraint = 'identity_session_role_security_required',
            message = 'Identity sessions must satisfy role-specific assurance and lifetime limits.';
        end if;

        return null;
      end;
      $identity_session_role_security$
    `,
    `
      create constraint trigger identity_sessions_role_security
      after insert or update on stockcontrol.identity_sessions
      deferrable initially deferred
      for each row execute function stockcontrol.enforce_identity_session_role_security()
    `,
    `
      create function stockcontrol.enforce_active_totp_recovery_codes()
      returns trigger
      language plpgsql
      as $identity_active_totp_recovery_codes$
      begin
        if exists (
          select 1
          from stockcontrol.identity_totp_credentials as totp_credential
          where totp_credential.status = 'Active'
            and (
              totp_credential.recovery_codes_acknowledged_at is null
              or not exists (
                select 1
                from stockcontrol.identity_recovery_codes as recovery_code
                where recovery_code.user_id = totp_credential.user_id
                  and recovery_code.totp_credential_id = totp_credential.id
                  and recovery_code.created_at
                    <= totp_credential.recovery_codes_acknowledged_at
              )
            )
        ) then
          raise exception using
            errcode = '23514',
            constraint = 'identity_active_totp_recovery_codes_required',
            message = 'An active TOTP credential requires an acknowledged recovery-code set.';
        end if;

        return null;
      end;
      $identity_active_totp_recovery_codes$
    `,
    `
      create constraint trigger identity_totp_recovery_codes_required
      after insert or update or delete on stockcontrol.identity_totp_credentials
      deferrable initially deferred
      for each row execute function stockcontrol.enforce_active_totp_recovery_codes()
    `,
    `
      create constraint trigger identity_recovery_codes_totp_required
      after insert or update or delete on stockcontrol.identity_recovery_codes
      deferrable initially deferred
      for each row execute function stockcontrol.enforce_active_totp_recovery_codes()
    `,
    `
      create function stockcontrol.enforce_active_admin_security()
      returns trigger
      language plpgsql
      as $identity_active_admin_security$
      begin
        if exists (
          select 1
          from stockcontrol.identity_users as identity_user
          where identity_user.status = 'Active'
            and identity_user.role = 'Admin'
            and (
              not exists (
                select 1
                from stockcontrol.identity_password_credentials as password_credential
                where password_credential.user_id = identity_user.id
              )
              or not exists (
                select 1
                from stockcontrol.identity_totp_credentials as totp_credential
                where totp_credential.user_id = identity_user.id
                  and totp_credential.status = 'Active'
                  and totp_credential.verified_at is not null
                  and totp_credential.recovery_codes_acknowledged_at is not null
                  and exists (
                    select 1
                    from stockcontrol.identity_recovery_codes as recovery_code
                    where recovery_code.user_id = identity_user.id
                      and recovery_code.totp_credential_id = totp_credential.id
                      and recovery_code.created_at
                        <= totp_credential.recovery_codes_acknowledged_at
                  )
              )
              or exists (
                select 1
                from stockcontrol.identity_sessions as identity_session
                where identity_session.user_id = identity_user.id
                  and identity_session.revoked_at is null
                  and identity_session.idle_expires_at > current_timestamp
                  and identity_session.absolute_expires_at > current_timestamp
                  and (
                    identity_session.assurance_level <> 'MultiFactor'
                    or identity_session.idle_expires_at
                      > identity_session.last_seen_at + interval '30 minutes'
                  )
              )
            )
        ) then
          raise exception using
            errcode = '23514',
            constraint = 'identity_active_admin_security_required',
            message = 'Every active Admin requires a password, acknowledged active MFA, and secure sessions.';
        end if;

        return null;
      end;
      $identity_active_admin_security$
    `,
    `
      create constraint trigger identity_users_active_admin_security
      after insert or update or delete on stockcontrol.identity_users
      deferrable initially deferred
      for each row execute function stockcontrol.enforce_active_admin_security()
    `,
    `
      create constraint trigger identity_passwords_active_admin_security
      after insert or update or delete on stockcontrol.identity_password_credentials
      deferrable initially deferred
      for each row execute function stockcontrol.enforce_active_admin_security()
    `,
    `
      create constraint trigger identity_totp_active_admin_security
      after insert or update or delete on stockcontrol.identity_totp_credentials
      deferrable initially deferred
      for each row execute function stockcontrol.enforce_active_admin_security()
    `,
    `
      create function stockcontrol.enforce_final_capable_admin()
      returns trigger
      language plpgsql
      as $identity_final_admin$
      begin
        if exists (
          select 1
          from stockcontrol.identity_bootstrap_state
          where singleton_key = 1 and completed_at is not null
        ) and not exists (
          select 1
          from stockcontrol.identity_users as identity_user
          where identity_user.status = 'Active'
            and identity_user.role = 'Admin'
            and not exists (
              select 1
              from stockcontrol.identity_permission_overrides as permission_override
              where permission_override.user_id = identity_user.id
                and permission_override.capability in ('users.manage', 'users.permissions.manage')
                and permission_override.setting = 'Deny'
            )
        ) then
          raise exception using
            errcode = '23514',
            constraint = 'identity_final_capable_admin_required',
            message = 'A completed StockControl installation requires an active capable Admin.';
        end if;

        return null;
      end;
      $identity_final_admin$
    `,
    `
      create constraint trigger identity_users_final_capable_admin
      after insert or update or delete on stockcontrol.identity_users
      deferrable initially deferred
      for each row execute function stockcontrol.enforce_final_capable_admin()
    `,
    `
      create constraint trigger identity_permissions_final_capable_admin
      after insert or update or delete on stockcontrol.identity_permission_overrides
      deferrable initially deferred
      for each row execute function stockcontrol.enforce_final_capable_admin()
    `,
    `
      create constraint trigger identity_bootstrap_final_capable_admin
      after insert or update or delete on stockcontrol.identity_bootstrap_state
      deferrable initially deferred
      for each row execute function stockcontrol.enforce_final_capable_admin()
    `,
  ]),
  downStatements: Object.freeze([
    "drop trigger identity_bootstrap_final_capable_admin on stockcontrol.identity_bootstrap_state",
    "drop trigger identity_permissions_final_capable_admin on stockcontrol.identity_permission_overrides",
    "drop trigger identity_users_final_capable_admin on stockcontrol.identity_users",
    "drop function stockcontrol.enforce_final_capable_admin()",
    "drop trigger identity_totp_active_admin_security on stockcontrol.identity_totp_credentials",
    "drop trigger identity_passwords_active_admin_security on stockcontrol.identity_password_credentials",
    "drop trigger identity_users_active_admin_security on stockcontrol.identity_users",
    "drop function stockcontrol.enforce_active_admin_security()",
    "drop trigger identity_recovery_codes_totp_required on stockcontrol.identity_recovery_codes",
    "drop trigger identity_totp_recovery_codes_required on stockcontrol.identity_totp_credentials",
    "drop function stockcontrol.enforce_active_totp_recovery_codes()",
    "drop trigger identity_sessions_role_security on stockcontrol.identity_sessions",
    "drop function stockcontrol.enforce_identity_session_role_security()",
    "drop trigger identity_users_active_session on stockcontrol.identity_users",
    "drop trigger identity_sessions_active_user on stockcontrol.identity_sessions",
    "drop function stockcontrol.enforce_active_session_user()",
    "drop trigger identity_bootstrap_terminal_immutable on stockcontrol.identity_bootstrap_state",
    "drop trigger identity_recovery_codes_terminal_immutable on stockcontrol.identity_recovery_codes",
    "drop trigger identity_password_resets_terminal_immutable on stockcontrol.identity_password_resets",
    "drop trigger identity_invitations_terminal_immutable on stockcontrol.identity_invitations",
    "drop trigger identity_auth_challenges_terminal_immutable on stockcontrol.identity_auth_challenges",
    "drop trigger identity_sessions_terminal_immutable on stockcontrol.identity_sessions",
    "drop function stockcontrol.prevent_identity_terminal_record_mutation()",
    "drop trigger identity_mfa_recovery_lifecycle_transition on stockcontrol.identity_mfa_recovery_requests",
    "drop trigger identity_totp_lifecycle_transition on stockcontrol.identity_totp_credentials",
    "drop trigger identity_users_lifecycle_transition on stockcontrol.identity_users",
    "drop function stockcontrol.enforce_identity_lifecycle_transition()",
    "drop trigger identity_rate_limits_security_state_progression on stockcontrol.identity_rate_limit_buckets",
    "drop trigger identity_sessions_security_state_progression on stockcontrol.identity_sessions",
    "drop trigger identity_auth_challenges_security_state_progression on stockcontrol.identity_auth_challenges",
    "drop trigger identity_totp_security_state_progression on stockcontrol.identity_totp_credentials",
    "drop function stockcontrol.enforce_identity_security_state_progression()",
    "drop trigger identity_bootstrap_immutable_columns on stockcontrol.identity_bootstrap_state",
    "drop trigger identity_mfa_recovery_immutable_columns on stockcontrol.identity_mfa_recovery_requests",
    "drop trigger identity_security_policy_immutable_columns on stockcontrol.identity_security_policy",
    "drop trigger identity_rate_limits_immutable_columns on stockcontrol.identity_rate_limit_buckets",
    "drop trigger identity_password_resets_immutable_columns on stockcontrol.identity_password_resets",
    "drop trigger identity_invitations_immutable_columns on stockcontrol.identity_invitations",
    "drop trigger identity_auth_challenges_immutable_columns on stockcontrol.identity_auth_challenges",
    "drop trigger identity_sessions_immutable_columns on stockcontrol.identity_sessions",
    "drop trigger identity_permissions_immutable_columns on stockcontrol.identity_permission_overrides",
    "drop trigger identity_recovery_codes_immutable_columns on stockcontrol.identity_recovery_codes",
    "drop trigger identity_totp_immutable_columns on stockcontrol.identity_totp_credentials",
    "drop trigger identity_passwords_immutable_columns on stockcontrol.identity_password_credentials",
    "drop trigger identity_users_immutable_columns on stockcontrol.identity_users",
    "drop function stockcontrol.prevent_identity_immutable_column_mutation()",
    "drop trigger identity_bootstrap_version_progression on stockcontrol.identity_bootstrap_state",
    "drop trigger identity_mfa_recovery_version_progression on stockcontrol.identity_mfa_recovery_requests",
    "drop trigger identity_security_policy_version_progression on stockcontrol.identity_security_policy",
    "drop trigger identity_rate_limits_version_progression on stockcontrol.identity_rate_limit_buckets",
    "drop trigger identity_password_resets_version_progression on stockcontrol.identity_password_resets",
    "drop trigger identity_invitations_version_progression on stockcontrol.identity_invitations",
    "drop trigger identity_auth_challenges_version_progression on stockcontrol.identity_auth_challenges",
    "drop trigger identity_sessions_version_progression on stockcontrol.identity_sessions",
    "drop trigger identity_totp_version_progression on stockcontrol.identity_totp_credentials",
    "drop trigger identity_passwords_version_progression on stockcontrol.identity_password_credentials",
    "drop trigger identity_users_version_progression on stockcontrol.identity_users",
    "drop function stockcontrol.enforce_identity_version_progression()",
    "drop trigger identity_audit_chain_head_consistent on stockcontrol.identity_audit_chain_head",
    "drop function stockcontrol.enforce_identity_audit_chain_head()",
    "drop trigger identity_audit_event_chain_link on stockcontrol.identity_audit_events",
    "drop function stockcontrol.enforce_identity_audit_event_chain_link()",
    "drop trigger identity_audit_events_append_only on stockcontrol.identity_audit_events",
    "drop function stockcontrol.prevent_identity_audit_event_mutation()",
    "drop table stockcontrol.identity_audit_events",
    "drop table stockcontrol.identity_audit_chain_head",
    "drop table stockcontrol.identity_bootstrap_state",
    "drop table stockcontrol.identity_mfa_recovery_requests",
    "drop table stockcontrol.identity_security_policy",
    "drop table stockcontrol.identity_rate_limit_buckets",
    "drop table stockcontrol.identity_password_resets",
    "drop table stockcontrol.identity_invitations",
    "drop table stockcontrol.identity_auth_challenges",
    "drop table stockcontrol.identity_sessions",
    "drop table stockcontrol.identity_permission_overrides",
    "drop table stockcontrol.identity_recovery_codes",
    "drop table stockcontrol.identity_totp_credentials",
    "drop table stockcontrol.identity_password_credentials",
    "drop table stockcontrol.identity_users",
  ]),
} satisfies CanonicalMigrationDefinition);

const identity = createChecksummedMigration(identityMigrationDefinition);

export const identityMigration = identity.migration;
export const identityMigrationIntegrity = identity.descriptor;
