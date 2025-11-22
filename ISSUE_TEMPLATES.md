# Quick Issue Creation Template

This file provides templates for quickly creating all issues. Copy the markdown for each issue and paste into GitHub's "New Issue" form.

---

## M1.1: Initialize Backend Project Structure (Python/FastAPI)

**Milestone:** Foundation & Infrastructure Setup  
**Labels:** backend, setup, priority:critical  
**Assignees:** (backend developer)

### Description

Set up the Python/FastAPI backend with proper module structure to support the modular architecture described in the requirements.

**Documentation:**
- `/docs/SystemRequirementsSpecification.md` Section 6.2
- `/docs/openapi.yml`

**Steps:**
1. Create backend directory with module structure
2. Install FastAPI, SQLAlchemy, Pydantic, Alembic
3. Set up configuration management
4. Create health check endpoint

**Acceptance:**
- [ ] Backend starts with `uvicorn app.main:app`
- [ ] Health check returns 200
- [ ] All modules have `__init__.py`

---

## M1.2: Initialize Frontend Project Structure (React/TypeScript)

**Milestone:** Foundation & Infrastructure Setup  
**Labels:** frontend, setup, priority:critical  
**Assignees:** (frontend developer)

### Description

Set up React/TypeScript frontend with TailwindCSS and React Query.

**Documentation:**
- `/docs/SystemRequirementsSpecification.md` Section 6.1

**Steps:**
1. Create Vite + React + TypeScript project
2. Install TailwindCSS, React Query, React Router, Axios, zxing-js
3. Set up directory structure
4. Configure API client

**Acceptance:**
- [ ] Frontend runs with `npm run dev`
- [ ] No TypeScript errors
- [ ] TailwindCSS working

---

## M1.3: Set Up PostgreSQL Database

**Milestone:** Foundation & Infrastructure Setup  
**Labels:** backend, database, setup, priority:critical

### Description

Configure PostgreSQL with SQLAlchemy and Alembic migrations.

**Documentation:**
- `/docs/SystemRequirementsSpecification.md` Section 6.2

**Steps:**
1. Create docker-compose.yml with PostgreSQL
2. Configure SQLAlchemy engine
3. Set up Alembic
4. Create base model class

**Acceptance:**
- [ ] PostgreSQL starts with docker-compose
- [ ] SQLAlchemy connects
- [ ] Alembic can create migrations

---

## M1.4: Configure Redis for Caching

**Milestone:** Foundation & Infrastructure Setup  
**Labels:** backend, setup, priority:high

### Description

Set up Redis for caching and notification queues.

**Documentation:**
- `/docs/SystemRequirementsSpecification.md` Section 6.2, 5.1

**Steps:**
1. Add Redis to docker-compose
2. Install Python Redis client
3. Create cache utilities
4. Add health check

**Acceptance:**
- [ ] Redis starts with docker-compose
- [ ] Cache utilities work
- [ ] Health check includes Redis

---

## M1.5: Set Up CI/CD Pipeline

**Milestone:** Foundation & Infrastructure Setup  
**Labels:** devops, setup, priority:high

### Description

Establish automated testing and deployment pipeline.

**Documentation:**
- `/docs/SystemRequirementsSpecification.md` Section 5

**Steps:**
1. Create `.github/workflows/ci.yml`
2. Configure linting, testing, building
3. Set up Dependabot
4. Create PR template

**Acceptance:**
- [ ] CI runs on every PR
- [ ] Tests must pass before merge
- [ ] Coverage reports generated

---

## M1.6: Create Docker Development Environment

**Milestone:** Foundation & Infrastructure Setup  
**Labels:** devops, setup, priority:high

### Description

Provide complete containerized development environment.

**Documentation:**
- `/docs/SystemRequirementsSpecification.md` Section 6

**Steps:**
1. Create Dockerfiles for backend and frontend
2. Update docker-compose with all services
3. Configure hot-reloading
4. Create Makefile with commands
5. Document in README

**Acceptance:**
- [ ] `docker-compose up` starts all services
- [ ] Hot-reloading works
- [ ] README documents setup

---

## M1.7: Set Up Database Migration System

**Milestone:** Foundation & Infrastructure Setup  
**Labels:** backend, database, setup, priority:high

### Description

Establish robust database migration system using Alembic.

**Documentation:**
- `/docs/SystemRequirementsSpecification.md` Section 7

**Steps:**
1. Configure Alembic with autogenerate
2. Create migration script template
3. Create make commands
4. Document workflow
5. Create seeding script

**Acceptance:**
- [ ] Migrations can be applied and rolled back
- [ ] Seed script populates development data
- [ ] Documentation covers common scenarios

---

## M2.1: Implement User Model and Database Schema

**Milestone:** User Management & Authentication  
**Labels:** backend, database, auth, priority:critical

### Description

Create User model with authentication support, role assignment, and van assignments.

**Documentation:**
- `/docs/SystemRequirementsSpecification.md` Section 4.1
- `/docs/openapi.yml` User schemas

**Steps:**
1. Create User model with all fields
2. Create UserRole and UserVan association tables
3. Create Pydantic schemas
4. Add password hashing utilities
5. Create migration

**Acceptance:**
- [ ] User model matches OpenAPI schema
- [ ] Password hashed with bcrypt
- [ ] Username unique and indexed
- [ ] Relationships defined

---

## M2.2: Implement Role and Permission Models

**Milestone:** User Management & Authentication  
**Labels:** backend, database, auth, priority:critical

### Description

Create Role and Permission models for RBAC system.

**Documentation:**
- `/docs/SystemRequirementsSpecification.md` Section 4.1.2
- `/docs/openapi.yml` Role, Permission schemas

**Steps:**
1. Define all permissions as enums
2. Create Role model
3. Create RolePermission association
4. Create Pydantic schemas
5. Create seed data for default roles

**Acceptance:**
- [ ] All permissions defined
- [ ] System roles cannot be deleted
- [ ] Seed data creates defaults

---

## M2.3: Create JWT Authentication System

**Milestone:** User Management & Authentication  
**Labels:** backend, auth, priority:critical

### Description

Implement JWT-based authentication with access and refresh tokens.

**Documentation:**
- `/docs/SystemRequirementsSpecification.md` Section 4.1.1
- `/docs/openapi.yml` AuthTokenResponse

**Steps:**
1. Install python-jose
2. Create JWT utilities
3. Configure JWT settings
4. Create get_current_user dependency
5. Add token blacklist (Redis)

**Acceptance:**
- [ ] Tokens expire correctly
- [ ] Invalid tokens return 401
- [ ] Blacklist prevents reuse

---

## M2.4: Build Login and Token Refresh Endpoints

**Milestone:** User Management & Authentication  
**Labels:** backend, auth, API, priority:critical

### Description

Create API endpoints for login and token refresh.

**Documentation:**
- `/docs/openapi.yml` /auth/login, /auth/refresh

**Steps:**
1. Implement POST /api/v1/auth/login
2. Implement POST /api/v1/auth/refresh
3. Implement POST /api/v1/auth/logout
4. Add rate limiting
5. Add audit logging

**Acceptance:**
- [ ] Login returns tokens for valid credentials
- [ ] Login returns 401 for invalid credentials
- [ ] Refresh returns new access token
- [ ] Rate limiting prevents brute force

---

## M2.5: Create User CRUD API Endpoints

**Milestone:** User Management & Authentication  
**Labels:** backend, API, priority:high

### Description

Implement complete CRUD operations for user management.

**Documentation:**
- `/docs/openapi.yml` /users/* endpoints

**Steps:**
1. Implement GET /api/v1/users (list with pagination)
2. Implement GET /api/v1/users/{id}
3. Implement POST /api/v1/users (create)
4. Implement PATCH /api/v1/users/{id}
5. Implement DELETE /api/v1/users/{id}
6. Implement GET /api/v1/users/me

**Acceptance:**
- [ ] All endpoints match OpenAPI spec
- [ ] Permission checking works
- [ ] Passwords never returned
- [ ] Admin cannot be deleted

---

## M2.6: Create Role Management API Endpoints

**Milestone:** User Management & Authentication  
**Labels:** backend, API, priority:high

### Description

Implement CRUD operations for role management.

**Documentation:**
- `/docs/openapi.yml` /roles/* endpoints

**Steps:**
1. Implement GET /api/v1/roles
2. Implement GET /api/v1/roles/{id}
3. Implement POST /api/v1/roles
4. Implement PATCH /api/v1/roles/{id}
5. Implement DELETE /api/v1/roles/{id}
6. Implement GET /api/v1/permissions

**Acceptance:**
- [ ] System roles cannot be modified
- [ ] Roles in use cannot be deleted
- [ ] Permission validation works

---

## M2.7: Implement Permission Checking Middleware

**Milestone:** User Management & Authentication  
**Labels:** backend, auth, priority:critical

### Description

Create reusable permission checking decorators for RBAC enforcement.

**Documentation:**
- `/docs/SystemRequirementsSpecification.md` Section 4.1.2

**Steps:**
1. Create require_permission dependency
2. Implement has_permission utility
3. Implement require_any_permission
4. Implement require_all_permissions
5. Create permission caching

**Acceptance:**
- [ ] Permission checks work correctly
- [ ] Admin always passes checks
- [ ] Permissions are cached
- [ ] All protected endpoints use checks

---

## M2.8: Build User Management UI Components

**Milestone:** User Management & Authentication  
**Labels:** frontend, UI, priority:high

### Description

Create React components for user management.

**Steps:**
1. Create UserList component
2. Create UserForm component
3. Create UserDetail component
4. Create UsersPage
5. Set up React Query hooks
6. Style with TailwindCSS

**Acceptance:**
- [ ] User list displays with pagination
- [ ] Create/edit forms validate
- [ ] Delete requires confirmation
- [ ] UI is responsive

---

## M2.9: Build Login/Logout UI

**Milestone:** User Management & Authentication  
**Labels:** frontend, UI, auth, priority:critical

### Description

Create login form and session management UI.

**Steps:**
1. Create LoginForm component
2. Create LoginPage
3. Create auth context
4. Create Header with logout
5. Set up protected routes
6. Configure Axios interceptors

**Acceptance:**
- [ ] Login validates input
- [ ] Successful login redirects
- [ ] Token stored securely
- [ ] Auth persists across reloads
- [ ] Expired tokens refreshed automatically

---

## M2.10: Create Admin User Initialization Script

**Milestone:** User Management & Authentication  
**Labels:** backend, setup, priority:critical

### Description

Provide script to create initial admin user.

**Documentation:**
- `/docs/SystemRequirementsSpecification.md` Section 4.1.3

**Steps:**
1. Create scripts/init_admin.py
2. Add command-line interface
3. Add to docker entrypoint
4. Add environment variable support
5. Document in README

**Acceptance:**
- [ ] Script creates admin user
- [ ] Admin has all permissions
- [ ] Script is idempotent
- [ ] Password complexity validated

---

_Continue with similar templates for all remaining issues from Milestones 3-10..._

**Note:** This template shows the format for the first 17 issues. The complete set would continue with:
- Milestone 3: Stock Item Management (14 issues)
- Milestone 4: Location Management (10 issues)
- Milestone 5: Maps & Visual Navigation (10 issues)
- Milestone 6: Stock Movements (16 issues)
- Milestone 7: Stock Requests (10 issues)
- Milestone 8: Notifications System (10 issues)
- Milestone 9: Reporting & Analytics (11 issues)
- Milestone 10: Security & Performance (12 issues)

See `ISSUES.md` for complete detailed specifications of all issues.
