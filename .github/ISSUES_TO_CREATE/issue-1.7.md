## Issue 1.7: Set Up Database Migration System

### Context
Establish a robust database migration system using Alembic to manage schema changes safely across environments.

### Implementation Steps
1. Configure Alembic and autogenerate models
2. Create migration scripts, make migration commands, and test
3. Document migration workflow in CONTRIBUTING.md

### Acceptance Criteria
- Alembic can detect model changes automatically
- Migrations can be applied and rolled back
- Make commands simplify migration workflow

### Testing Methods
Manual: `make migrate-create MSG="test"`, `make migrate-up`, `make migrate-down`
