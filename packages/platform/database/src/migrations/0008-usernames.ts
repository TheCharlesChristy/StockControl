import { createChecksummedMigration, type CanonicalMigrationDefinition } from "./integrity";

/**
 * An email address used to be the account: the sign-in identifier, the rate
 * limiter's key, and the only way the operator CLIs could find anybody. That
 * obliged every engineer to hold a mailbox before they could be given a job,
 * for a product that sends no email at all. `username` becomes the identifier
 * and the address becomes optional contact information.
 *
 * The backfill loops rather than numbering with a window function. The obvious
 * `base || row_number()` is wrong: `sam` and `sam1@example.com` both want
 * `sam1`, and a second pass would be needed to notice. Re-checking each
 * candidate makes uniqueness a property of the algorithm instead of a hope.
 * Rows not yet reached hold NULL, so they never match the existence check, and
 * ordering by `created_at` makes the result reproducible enough to assert.
 *
 * Two constraints the address already had are left alone deliberately. A plain
 * unique index treats NULLs as distinct, so `users_email_key` already permits
 * any number of accounts with no address; and a CHECK fails only on false, so
 * `users_email_lowercase` already passes when the address is NULL. Only the NOT
 * NULL has to go. `users_email_present` is new, because the application now has
 * a path that clears an address and the difference between NULL and '' should
 * never become something anybody has to think about.
 *
 * Rolling back restores the NOT NULL, which fails if any account has since been
 * saved without an address. That is the honest outcome: the alternatives are
 * inventing addresses or deleting accounts, and a dozen audit tables reference
 * users with `on delete restrict` precisely so that cannot happen quietly.
 */
export const usernamesMigrationDefinition = Object.freeze({
  name: "0008_usernames",
  version: 8,
  upStatements: Object.freeze([
    "alter table stockcontrol.users add column username varchar(32)",
    `
      do $$
      declare
        account record;
        base text;
        candidate text;
        suffix integer;
      begin
        for account in
          select id, email from stockcontrol.users order by created_at, id
        loop
          base := regexp_replace(lower(split_part(account.email, '@', 1)), '[^a-z0-9._-]', '', 'g');
          base := regexp_replace(base, '^[._-]+', '');
          base := left(base, 28);
          /* After the truncation, not before: cutting a long address mid-word
             can leave a trailing separator that the application's own username
             rule would then refuse. */
          base := regexp_replace(base, '[._-]+$', '');

          if length(base) < 3 then
            base := 'user';
          end if;

          candidate := base;
          suffix := 1;

          while exists (select 1 from stockcontrol.users where username = candidate) loop
            suffix := suffix + 1;
            candidate := base || suffix::text;
          end loop;

          update stockcontrol.users set username = candidate where id = account.id;
        end loop;
      end
      $$
    `,
    "alter table stockcontrol.users alter column username set not null",
    `
      alter table stockcontrol.users
        add constraint users_username_lowercase check (username = lower(username))
    `,
    "create unique index users_username_key on stockcontrol.users (username)",
    "alter table stockcontrol.users alter column email drop not null",
    `
      alter table stockcontrol.users
        add constraint users_email_present check (email is null or length(email) > 0)
    `,
  ]),
  downStatements: Object.freeze([
    "alter table stockcontrol.users drop constraint if exists users_email_present",
    "alter table stockcontrol.users alter column email set not null",
    "drop index if exists stockcontrol.users_username_key",
    "alter table stockcontrol.users drop constraint if exists users_username_lowercase",
    "alter table stockcontrol.users drop column if exists username",
  ]),
} satisfies CanonicalMigrationDefinition);

const usernames = createChecksummedMigration(usernamesMigrationDefinition);

export const usernamesMigration = usernames.migration;
export const usernamesMigrationIntegrity = usernames.descriptor;
