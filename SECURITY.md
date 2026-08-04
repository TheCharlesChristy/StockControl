# Security policy

StockControl holds a customer's inventory, their locations, and the record of
who moved what. Please tell us about a weakness before you tell anyone else.

## Reporting a vulnerability

Report privately through
[GitHub's advisory form](https://github.com/TheCharlesChristy/StockControl/security/advisories/new).
It is not public, and it gives us a place to work with you on a fix.

Please do not open a public issue for a security problem, and do not use the
in-app **Report an issue** button — it files a public GitHub issue.

Tell us what you can: what you did, what happened, and what an attacker could
reach with it. A rough note that arrives is worth more than a polished one that
does not. If you are not sure whether something counts, send it.

You will get an acknowledgement within three working days. We will tell you what
we found, whether we are fixing it, and when — and we will credit you in the
advisory unless you would rather we did not.

Please give us a reasonable chance to ship a fix before publishing. Test only
against your own installation: never against a live customer deployment, and
never against data that is not yours.

## What is in scope

The application in this repository — the API, the browser client, the database
layer, the container images, and the deployment configuration under `infra/`.

`infra/terraform/` and `infra/ansible/` describe a superseded AWS installation
and are kept for reference only. They are not deployed. A finding there is
still welcome, but it is not a live exposure.

## Supported versions

The `main` branch, and whatever a customer installation is currently running.
There are no long-term support branches; fixes ship forward.

## Known accepted risk

Advisories that are known and deliberately carried, with the reasoning and a
review trigger for each, are recorded in
[`docs/security/dependency-risk-register.md`](docs/security/dependency-risk-register.md).
`pnpm audit --audit-level high` runs in CI, so anything above that line has to
be fixed or recorded rather than merged quietly.

## What we already do

Worth knowing before you spend time on it:

- Authentication is default-closed. A route is authenticated unless it carries
  an explicit `@Public()` decorator.
- Authorisation goes through one gate, `requireCapability`, on the server. The
  browser hides what a role cannot use, but the server never trusts that.
- Sessions are random 32-byte tokens stored as a digest, in an `HttpOnly`,
  `SameSite=Lax`, `Secure`, `__Host-` prefixed cookie on an HTTPS deployment.
- State-changing requests are checked against a single configured browser
  origin.
- Passwords are scrypt-hashed. An unknown email still pays for a verification,
  so timing does not distinguish it from a wrong password.
- Sign-in is throttled per account, per source, and globally.
- The API runs with a restricted database role that cannot change the schema.
- Uploaded images are validated by magic bytes and dimensions, stored
  privately, and verified against a recorded digest when read back.
