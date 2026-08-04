# GitHub security and branch configuration

The workflows in this repository provide enforceable checks, but repository settings must also be configured in GitHub. Treat this file as the configuration checklist for `Settings`.

## Code security

Enable all features available for the repository:

- Dependency graph
- Dependabot alerts
- Dependabot security updates
- Private vulnerability reporting
- Secret scanning
- Push protection for secrets
- Code scanning alerts

This repository uses advanced CodeQL setup in `.github/workflows/codeql.yml`. Do not enable CodeQL default setup at the same time.

## Required checks for `develop`

Create a ruleset targeting `develop` and require:

- `quality`
- `container image (api)`
- `container image (web)`
- `integration`
- `demo-journey`
- `dependency-review`
- `codeql (javascript-typescript)`
- `codeql (actions)`

Also require a pull request, at least one approval, dismissal of stale approvals, approval after the latest reviewable push, resolved conversations, and block force pushes and deletion. Do not grant routine administrator bypass.

## Required checks for `main`

Require the same checks as `develop`, plus:

- `promotion-policy`
- successful staging deployment checks from Railway

Only merge `develop` into `main`. Use a merge commit for this promotion so the tested commit ancestry is retained. Do not squash or rebase the production promotion PR.

## GitHub Actions policy

- Default workflow token permissions should be read-only.
- Do not allow GitHub Actions to create or approve pull requests unless a documented workflow requires it.
- Restrict third-party actions and keep every action pinned to a full commit SHA.
- Require review for changes under `.github/workflows/`.

## Deployment environments

Create separate GitHub environments named `staging` and `production`.

- `staging` may deploy only from `develop`.
- `production` may deploy only from `main` or protected release tags.
- Require a reviewer for production and prevent self-review.
- Do not allow administrators to bypass production environment protection.
- Keep environment secrets isolated; staging must never inherit production credentials.
