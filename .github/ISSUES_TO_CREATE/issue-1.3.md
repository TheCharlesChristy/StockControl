## Issue 1.3: Set Up PostgreSQL Database

### Context
Configure PostgreSQL as the primary data store with proper schema initialization and connection pooling.

### Implementation Steps
1. Create docker-compose.yml for Postgres
2. Create database config in backend/app/database.py
3. Configure SQLAlchemy and session management with dependency injection
4. Initialize Alembic for migrations

### Acceptance Criteria
- Postgres starts with docker-compose
- SQLAlchemy connects successfully
- Alembic is configured and can create migrations

### Testing Methods
Manual: `docker-compose up -d postgres` and `alembic upgrade head`
