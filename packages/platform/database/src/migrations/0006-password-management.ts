import { createChecksummedMigration, type CanonicalMigrationDefinition } from "./integrity";

/**
 * Until now a password could only be set when the account was created, by the
 * Admin creating it. That leaves the Admin holding everyone's credentials and
 * leaves anyone who forgets theirs with no way back in — the account cannot
 * even be recreated, because an account with stock history must not be deleted.
 *
 * `must_change_password` marks an account whose password somebody else chose,
 * so the application can insist on a new one before it is used for anything.
 * `password_changed_at` records when it last happened.
 *
 * Existing rows are left false rather than backfilled true. Every account an
 * Admin created is arguably in this state, but so is the first Admin, who chose
 * their own password at a hidden prompt and is the one person nobody else's
 * password was ever known to. A migration cannot tell those apart, and locking
 * the operator out of a live installation to make a point is the wrong trade.
 * The Admin reset endpoint sets the flag deliberately instead; the deployment
 * runbook says to use it on any account whose password an Admin typed.
 */
export const passwordManagementMigrationDefinition = Object.freeze({
  name: "0006_password_management",
  version: 6,
  upStatements: Object.freeze([
    `
      alter table stockcontrol.users
        add column must_change_password boolean not null default false,
        add column password_changed_at timestamptz
    `,
  ]),
  downStatements: Object.freeze([
    `
      alter table stockcontrol.users
        drop column if exists password_changed_at,
        drop column if exists must_change_password
    `,
  ]),
} satisfies CanonicalMigrationDefinition);

const passwordManagement = createChecksummedMigration(passwordManagementMigrationDefinition);

export const passwordManagementMigration = passwordManagement.migration;
export const passwordManagementMigrationIntegrity = passwordManagement.descriptor;
