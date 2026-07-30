# PostgreSQL credential rotation

Use this runbook only for an existing customer installation. A new empty
PostgreSQL volume creates its roles from the bootstrap environment; PostgreSQL
does not re-run that bootstrap when the volume already contains data.

The deployment playbook compares the installed bootstrap environment with the
encrypted variables before it renders replacements. A mismatch stops the
deployment unless an operator explicitly acknowledges that the live roles were
already rotated. The acknowledgement does not change PostgreSQL passwords.

## Prepare

1. Open an approved change record and identify the exact installation, volume,
   current release, current encrypted-vault revision, and rollback owner.
2. Confirm a recent backup and successful restore rehearsal. Take and verify an
   on-demand pre-change backup.
3. Generate four independent replacement passwords of at least 32 characters
   from the RFC 3986 unreserved set. Keep the current and replacement values in
   the approved secret store until verification is complete.
4. Schedule a maintenance window. Password rotation briefly stops application
   writes; it is not an emergency background task.

## Rotate the live roles

From `/opt/stockcontrol` on the confirmed host:

1. Stop `proxy`, `api`, and `worker`. Leave PostgreSQL running and do not remove
   containers or volumes.
2. Open an interactive `psql` session inside the PostgreSQL container as
   `stockcontrol_admin`. Do not put a password in a command argument, shell
   history, terminal capture, Ansible output, or a temporary world-readable
   file.
3. Use the interactive `\password ROLE_NAME` command to rotate, in order,
   `stockcontrol_app`, `stockcontrol_backup`, `stockcontrol_migrator`, and
   `stockcontrol_admin`. Record only whether each role succeeded, never its
   value.
4. In separate interactive password-prompted connections over TCP, prove that:

   - `stockcontrol_app` can connect and run `SELECT 1`;
   - `stockcontrol_backup` can connect and perform a schema-only dump;
   - `stockcontrol_migrator` can connect to the target database;
   - `stockcontrol_admin` can connect after it is rotated.

If any verification fails, keep application services stopped. Correct that
specific live role using the still-valid administrator session or the
documented incident process. Never delete or recreate the volume to repair a
credential mismatch.

## Reconcile and activate

1. Replace all four values in the encrypted Ansible Vault and have the change
   reviewed.
2. Set `stockcontrol_acknowledge_database_passwords_rotated: true` for one
   controlled playbook run. This allows the already-verified live credentials
   and the rendered environment files to converge.
3. Apply the playbook. It runs migrations, starts the services, and waits for
   API, worker, web, and PostgreSQL health.
4. Verify external readiness, sign-in, a read-only inventory request, worker
   readiness, and the next backup.
5. Immediately restore
   `stockcontrol_acknowledge_database_passwords_rotated: false`. A check-mode
   run must now pass the credential guard without acknowledgement.
6. Revoke access to the previous values according to the secret-store policy,
   record evidence without secrets, and close the change after the observation
   window.

The same guard also stops when the installed bootstrap environment is missing
for an existing volume. Treat that as an incident requiring evidence and
credential verification, not permission to recreate state.
