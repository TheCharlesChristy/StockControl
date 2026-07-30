# Identity and Permissions domain

This package owns StockControl's framework-independent user, role-template, and
effective-permission rules.

The V1 permission catalogue and the three standard role templates are immutable
domain definitions. Per-user settings use `UseRoleDefault`, `Allow`, or `Deny`;
resolution always applies explicit Deny, then explicit Allow, then the role
default. Contextual item, job, van, approval-limit, separation-of-duties, and
reasoned-override checks belong to their owning modules and run after this
capability decision.

The access-mutation and final-capable-Admin policies accept transaction
projections rather than performing persistence. An application service should
lock the affected users, build the projected post-change roster, evaluate both
policies, write the change and audit record, and commit as one transaction.

Authentication cryptography, TOTP, invitations, sessions, and persistence are
intentionally outside this first domain slice.
