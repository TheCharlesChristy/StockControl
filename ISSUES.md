# Stock Management System - Detailed Issues

This document contains all implementation-ready issues for the Stock Management & Location Tracking System.

---

## Table of Contents

- [Milestone 1: Foundation & Infrastructure Setup](#milestone-1-foundation--infrastructure-setup)
- [Milestone 2: User Management & Authentication](#milestone-2-user-management--authentication)
- [Milestone 3: Stock Item Management](#milestone-3-stock-item-management)
- [Milestone 4: Location Management](#milestone-4-location-management)
- [Milestone 5: Maps & Visual Navigation](#milestone-5-maps--visual-navigation)
- [Milestone 6: Stock Movements](#milestone-6-stock-movements)
- [Milestone 7: Stock Requests](#milestone-7-stock-requests-van-to-warehouse)
- [Milestone 8: Notifications System](#milestone-8-notifications-system)
- [Milestone 9: Reporting & Analytics](#milestone-9-reporting--analytics)
- [Milestone 10: Security & Performance](#milestone-10-security--performance-optimization)

---

# Milestone 1: Foundation & Infrastructure Setup

## Issue 1.1: Initialize Backend Project Structure (Python/FastAPI)

### Context

Set up the Python/FastAPI backend with proper module structure to support the modular architecture described in the requirements. This foundation will enable all other backend development.

### Documentation References

- `/docs/SystemRequirementsSpecification.md` Section 6.2: Backend requirements
- `/docs/openapi.yml`: Full API specification

### Implementation Steps

1. Create root backend directory `/backend`
2. Initialize Python virtual environment and requirements.txt
3. Install core dependencies:
   - FastAPI
   - Uvicorn
   - SQLAlchemy
   - Pydantic
   - Alembic (migrations)
   - python-jose[cryptography] (JWT)
   - passlib[bcrypt] (password hashing)
   - python-multipart (file uploads)
4. Create module structure:
   ```
   backend/
   ├── app/
   │   ├── __init__.py
   │   ├── main.py
   │   ├── config.py
   │   ├── database.py
   │   ├── dependencies.py
   │   ├── modules/
   │   │   ├── __init__.py
   │   │   ├── auth/
   │   │   ├── users/
   │   │   ├── roles/
   │   │   ├── items/
   │   │   ├── locations/
   │   │   ├── maps/
   │   │   ├── movements/
   │   │   ├── stock_requests/
   │   │   └── notifications/
   │   └── common/
   │       ├── __init__.py
   │       ├── schemas.py
   │       └── utils.py
   ├── tests/
   ├── alembic/
   └── requirements.txt
   ```
5. Create main.py with basic FastAPI app setup
6. Configure CORS, logging, and error handlers
7. Set up configuration management (environment variables)
8. Create a health check endpoint at `/api/v1/health`

### Acceptance Criteria

- [ ] Backend directory structure matches specification
- [ ] All core dependencies are installed and documented
- [ ] FastAPI app starts successfully with `uvicorn app.main:app`
- [ ] Health check endpoint returns 200 OK
- [ ] Configuration loads from environment variables
- [ ] Module directories are created with __init__.py files

### Testing Methods

**Manual Testing:**
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
curl http://localhost:8000/api/v1/health
```

**Expected Output:** `{"status": "ok", "version": "1.0.0"}`

---

## Issue 1.2: Initialize Frontend Project Structure (React/TypeScript)

### Context

Set up the React/TypeScript frontend with TailwindCSS and React Query to provide a responsive, type-safe user interface.

### Documentation References

- `/docs/SystemRequirementsSpecification.md` Section 6.1: Frontend requirements

### Implementation Steps

1. Initialize React project with Vite + TypeScript template:
   ```bash
   npm create vite@latest frontend -- --template react-ts
   ```
2. Install core dependencies:
   - React Router DOM
   - @tanstack/react-query
   - TailwindCSS
   - Axios
   - zxing-js (barcode/QR scanning)
   - react-konva or fabric (map editor - choose one)
3. Configure TailwindCSS with PostCSS
4. Create directory structure:
   ```
   frontend/
   ├── src/
   │   ├── components/
   │   │   ├── common/
   │   │   ├── auth/
   │   │   ├── items/
   │   │   ├── locations/
   │   │   ├── maps/
   │   │   ├── movements/
   │   │   └── notifications/
   │   ├── pages/
   │   ├── hooks/
   │   ├── services/
   │   │   └── api.ts
   │   ├── types/
   │   ├── utils/
   │   ├── App.tsx
   │   └── main.tsx
   ├── public/
   └── package.json
   ```
5. Set up React Query provider in App.tsx
6. Configure API base URL from environment
7. Create API client with Axios
8. Set up React Router with basic routes
9. Configure ESLint and Prettier
10. Create basic layout component

### Acceptance Criteria

- [ ] Frontend runs with `npm run dev`
- [ ] TypeScript compilation has no errors
- [ ] TailwindCSS is configured and working
- [ ] React Query provider is set up
- [ ] API client is configured with base URL
- [ ] Basic routing is functional
- [ ] ESLint and Prettier are configured

### Testing Methods

**Manual Testing:**
```bash
cd frontend
npm install
npm run dev
```

Visit http://localhost:5173 and verify:
- App loads without errors
- TailwindCSS styles are applied
- No console errors

---

## Issue 1.3: Set Up PostgreSQL Database

### Context

Configure PostgreSQL as the primary data store with proper schema initialization and connection pooling.

### Documentation References

- `/docs/SystemRequirementsSpecification.md` Section 6.2: Backend architecture
- `/docs/openapi.yml`: All schema definitions

### Implementation Steps

1. Create docker-compose.yml in project root:
   ```yaml
   version: '3.8'
   services:
     postgres:
       image: postgres:15
       environment:
         POSTGRES_DB: stockcontrol
         POSTGRES_USER: stockuser
         POSTGRES_PASSWORD: stockpass
       ports:
         - "5432:5432"
       volumes:
         - postgres_data:/var/lib/postgresql/data
   volumes:
     postgres_data:
   ```
2. Create database configuration in backend/app/database.py
3. Configure SQLAlchemy engine with connection pooling
4. Create base model class with common fields (id, created_at, updated_at)
5. Set up session management with dependency injection
6. Initialize Alembic for migrations:
   ```bash
   alembic init alembic
   ```
7. Configure alembic.ini with database URL
8. Create initial migration structure
9. Document database setup in README

### Acceptance Criteria

- [ ] PostgreSQL starts with docker-compose
- [ ] SQLAlchemy connects successfully
- [ ] Base model class is created with common fields
- [ ] Alembic is configured and can create migrations
- [ ] Connection pooling is configured
- [ ] Database connection is testable via health check

### Testing Methods

**Unit Tests:**
```python
def test_database_connection():
    from app.database import engine
    with engine.connect() as conn:
        result = conn.execute("SELECT 1")
        assert result.fetchone()[0] == 1
```

**Manual Testing:**
```bash
docker-compose up -d postgres
cd backend
alembic revision --autogenerate -m "Initial"
alembic upgrade head
```

---

## Issue 1.4: Configure Redis for Caching

### Context

Set up Redis for caching and notification queue management to improve performance and enable real-time features.

### Documentation References

- `/docs/SystemRequirementsSpecification.md` Section 6.2: Backend requirements
- Section 5.1: Performance requirements

### Implementation Steps

1. Add Redis to docker-compose.yml:
   ```yaml
   redis:
     image: redis:7-alpine
     ports:
       - "6379:6379"
     volumes:
       - redis_data:/data
   ```
2. Install Python Redis client: `redis[hiredis]`
3. Create Redis configuration in backend/app/config.py
4. Create Redis connection manager in backend/app/cache.py
5. Implement basic caching utilities:
   - get_cached()
   - set_cached()
   - invalidate_cache()
6. Create Redis health check
7. Document cache key naming conventions
8. Add cache configuration to environment variables

### Acceptance Criteria

- [ ] Redis starts with docker-compose
- [ ] Python Redis client connects successfully
- [ ] Cache utilities work correctly
- [ ] Redis connection is included in health check
- [ ] Cache key naming conventions are documented
- [ ] Environment variables control cache TTL settings

### Testing Methods

**Unit Tests:**
```python
def test_redis_cache():
    from app.cache import get_cached, set_cached
    
    set_cached("test_key", {"value": "test"}, ttl=60)
    result = get_cached("test_key")
    assert result == {"value": "test"}
```

**Manual Testing:**
```bash
docker-compose up -d redis
redis-cli ping  # Should return PONG
```

---

## Issue 1.5: Set Up CI/CD Pipeline

### Context

Establish automated testing and deployment pipeline to ensure code quality and streamline releases.

### Documentation References

- `/docs/SystemRequirementsSpecification.md` Section 5: Non-functional requirements

### Implementation Steps

1. Create `.github/workflows/ci.yml`:
   - Run on push to main and pull requests
   - Set up Python and Node.js environments
   - Install dependencies
   - Run linters (flake8, ESLint)
   - Run backend tests with pytest
   - Run frontend tests with Vitest
   - Check TypeScript compilation
   - Build Docker images
2. Create `.github/workflows/cd.yml` for deployments:
   - Deploy to staging on merge to main
   - Deploy to production on release tags
3. Configure test coverage reporting
4. Set up automated security scanning (Dependabot)
5. Create PR template with checklist
6. Document CI/CD process in CONTRIBUTING.md

### Acceptance Criteria

- [ ] CI pipeline runs on every PR
- [ ] All tests must pass before merge
- [ ] Linters run automatically
- [ ] Coverage reports are generated
- [ ] Security scanning is enabled
- [ ] PR template guides contributors

### Testing Methods

**Manual Testing:**
- Create a test PR and verify:
  - CI pipeline triggers
  - All checks pass/fail appropriately
  - Status is visible in PR

---

## Issue 1.6: Create Docker Development Environment

### Context

Provide a complete containerized development environment for easy onboarding and consistent development setup.

### Documentation References

- `/docs/SystemRequirementsSpecification.md` Section 6: System Architecture

### Implementation Steps

1. Create backend Dockerfile:
   ```dockerfile
   FROM python:3.11-slim
   WORKDIR /app
   COPY requirements.txt .
   RUN pip install -r requirements.txt
   COPY . .
   CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--reload"]
   ```
2. Create frontend Dockerfile:
   ```dockerfile
   FROM node:18-alpine
   WORKDIR /app
   COPY package*.json .
   RUN npm install
   COPY . .
   CMD ["npm", "run", "dev", "--", "--host"]
   ```
3. Update docker-compose.yml with all services:
   - backend (FastAPI)
   - frontend (Vite)
   - postgres
   - redis
   - nginx (reverse proxy)
4. Create nginx configuration for routing
5. Configure hot-reloading for development
6. Create .env.example with all required variables
7. Document setup in README.md
8. Create Makefile with common commands:
   - make up (start all services)
   - make down (stop all services)
   - make logs (view logs)
   - make test (run tests)
   - make migrate (run migrations)

### Acceptance Criteria

- [ ] `docker-compose up` starts all services
- [ ] Backend is accessible at http://localhost:8000
- [ ] Frontend is accessible at http://localhost:3000
- [ ] Hot-reloading works for both frontend and backend
- [ ] Services can communicate with each other
- [ ] README documents the setup process clearly

### Testing Methods

**Manual Testing:**
```bash
cp .env.example .env
docker-compose up
# Verify all services start without errors
# Make a code change and verify hot-reload works
```

---

## Issue 1.7: Set Up Database Migration System

### Context

Establish a robust database migration system using Alembic to manage schema changes safely across environments.

### Documentation References

- `/docs/SystemRequirementsSpecification.md` Section 7: Data Model

### Implementation Steps

1. Configure Alembic in backend/alembic/:
   - Update env.py to use SQLAlchemy models
   - Configure autogenerate to detect model changes
2. Create migration script template with:
   - Data migration support
   - Rollback instructions
   - Version checking
3. Create make commands:
   - `make migrate-create MSG="message"`
   - `make migrate-up`
   - `make migrate-down`
4. Document migration workflow in CONTRIBUTING.md:
   - When to create migrations
   - How to test migrations
   - How to handle data migrations
5. Create initial migration with base tables structure
6. Add migration testing to CI pipeline
7. Create database seeding script for development data

### Acceptance Criteria

- [ ] Alembic can detect model changes automatically
- [ ] Migrations can be applied and rolled back
- [ ] Migration history is tracked correctly
- [ ] Make commands simplify migration workflow
- [ ] Initial migration creates base structure
- [ ] Seed script populates development data
- [ ] Documentation covers common scenarios

### Testing Methods

**Unit Tests:**
```python
def test_migration_up_down():
    from alembic import command
    from alembic.config import Config
    
    config = Config("alembic.ini")
    command.upgrade(config, "head")
    # Verify tables exist
    command.downgrade(config, "base")
    # Verify tables removed
```

**Manual Testing:**
```bash
make migrate-create MSG="test migration"
make migrate-up
make migrate-down
```

---

# Milestone 2: User Management & Authentication

## Issue 2.1: Implement User Model and Database Schema

### Context

Create the User model with all required fields to support authentication, role assignment, and van assignments per the requirements.

### Documentation References

- `/docs/SystemRequirementsSpecification.md` Section 4.1.1-4.1.3: User requirements
- `/docs/openapi.yml`: User, UserCreate, UserUpdate schemas

### Implementation Steps

1. Create backend/app/modules/users/models.py:
   ```python
   class User(Base):
       __tablename__ = "users"
       
       id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
       username = Column(String, unique=True, nullable=False, index=True)
       display_name = Column(String, nullable=False)
       hashed_password = Column(String, nullable=False)
       active = Column(Boolean, default=True, nullable=False)
       created_at = Column(DateTime(timezone=True), server_default=func.now())
       updated_at = Column(DateTime(timezone=True), onupdate=func.now())
       
       # Relationships
       roles = relationship("UserRole", back_populates="user")
       assigned_vans = relationship("UserVan", back_populates="user")
   ```
2. Create UserRole association table for many-to-many relationship
3. Create UserVan association table for van assignments
4. Create Pydantic schemas in schemas.py:
   - UserBase
   - UserCreate (with password)
   - UserUpdate
   - UserResponse (without password)
5. Add password hashing utilities with bcrypt
6. Create Alembic migration for users table
7. Add indexes for performance:
   - username (unique)
   - active status
   - role lookups

### Acceptance Criteria

- [ ] User model matches OpenAPI User schema
- [ ] Password is hashed with bcrypt (never stored plain)
- [ ] Username is unique and indexed
- [ ] Relationships to roles and vans are defined
- [ ] Pydantic schemas validate data correctly
- [ ] Migration creates users table successfully
- [ ] Soft delete is supported via active field

### Testing Methods

**Unit Tests:**
```python
def test_user_creation():
    user = User(
        username="testuser",
        display_name="Test User",
        hashed_password=hash_password("password123")
    )
    db.add(user)
    db.commit()
    
    assert user.id is not None
    assert user.username == "testuser"
    assert user.active == True
    
def test_password_hashing():
    hashed = hash_password("secret")
    assert verify_password("secret", hashed) == True
    assert verify_password("wrong", hashed) == False
```

---

## Issue 2.2: Implement Role and Permission Models

### Context

Create Role and Permission models to support the RBAC system with granular permissions as specified.

### Documentation References

- `/docs/SystemRequirementsSpecification.md` Section 4.1.2: Roles & Permissions
- `/docs/openapi.yml`: Role, Permission schemas

### Implementation Steps

1. Define all permissions as enums in models/permissions.py:
   ```python
   class Permission(str, Enum):
       VIEW_STOCK = "view_stock"
       EDIT_ITEMS = "edit_items"
       ADJUST_QUANTITIES = "adjust_quantities"
       MANAGE_USERS = "manage_users"
       MANAGE_ROLES = "manage_roles"
       MANAGE_LOCATIONS = "manage_locations"
       MANAGE_MAPS = "manage_maps"
       CREATE_MOVEMENTS = "create_movements"
       APPROVE_STOCK_REQUESTS = "approve_stock_requests"
       VIEW_COST_VALUES = "view_cost_values"
       # ... (add all from requirements)
   ```
2. Create Role model in models.py:
   ```python
   class Role(Base):
       __tablename__ = "roles"
       
       id = Column(UUID(as_uuid=True), primary_key=True)
       name = Column(String, unique=True, nullable=False)
       description = Column(String)
       is_system = Column(Boolean, default=False)  # Admin role
       created_at = Column(DateTime(timezone=True))
       
       permissions = relationship("RolePermission")
   ```
3. Create RolePermission association table
4. Create Pydantic schemas for Role
5. Create migration for roles and permissions tables
6. Create seed data for default roles:
   - Admin (all permissions)
   - Warehouse Manager
   - Engineer (van user)
   - Viewer (read-only)
7. Add permission checking utilities

### Acceptance Criteria

- [ ] All permissions from requirements are defined
- [ ] Role model supports multiple permissions
- [ ] System roles (like Admin) cannot be deleted
- [ ] Pydantic schemas validate role data
- [ ] Migration creates roles and permissions tables
- [ ] Seed data creates default roles
- [ ] Permission utilities enable easy checks

### Testing Methods

**Unit Tests:**
```python
def test_role_creation():
    role = Role(name="Test Role")
    role.permissions.append(
        RolePermission(permission=Permission.VIEW_STOCK)
    )
    db.add(role)
    db.commit()
    
    assert len(role.permissions) == 1
    assert role.permissions[0].permission == Permission.VIEW_STOCK

def test_admin_role_has_all_permissions():
    admin = db.query(Role).filter(Role.name == "Admin").first()
    all_perms = list(Permission)
    assert len(admin.permissions) == len(all_perms)
```

---

## Issue 2.3: Create JWT Authentication System

### Context

Implement JWT-based authentication with access and refresh tokens for secure API access.

### Documentation References

- `/docs/SystemRequirementsSpecification.md` Section 4.1.1: Login requirements
- `/docs/openapi.yml`: AuthTokenResponse schema

### Implementation Steps

1. Install dependencies: `python-jose[cryptography]`
2. Create backend/app/modules/auth/jwt.py:
   - create_access_token(data, expires_delta)
   - create_refresh_token(data)
   - verify_token(token)
   - decode_token(token)
3. Configure JWT settings in config.py:
   - SECRET_KEY (from environment)
   - ALGORITHM = "HS256"
   - ACCESS_TOKEN_EXPIRE_MINUTES = 30
   - REFRESH_TOKEN_EXPIRE_DAYS = 7
4. Create TokenData Pydantic model
5. Create get_current_user dependency:
   ```python
   async def get_current_user(
       token: str = Depends(oauth2_scheme),
       db: Session = Depends(get_db)
   ) -> User:
       # Verify token, load user, check if active
   ```
6. Create get_current_active_user wrapper
7. Add token blacklist support using Redis
8. Create refresh token endpoint logic
9. Document authentication flow

### Acceptance Criteria

- [ ] Access tokens expire after 30 minutes
- [ ] Refresh tokens expire after 7 days
- [ ] Tokens contain user ID and username
- [ ] Invalid tokens return 401 Unauthorized
- [ ] Expired tokens can be refreshed
- [ ] Token blacklist prevents reuse after logout
- [ ] get_current_user dependency works correctly

### Testing Methods

**Unit Tests:**
```python
def test_create_and_verify_token():
    token_data = {"sub": str(user_id)}
    token = create_access_token(token_data)
    
    decoded = decode_token(token)
    assert decoded["sub"] == str(user_id)

def test_expired_token_rejected():
    token = create_access_token(
        {"sub": str(user_id)},
        expires_delta=timedelta(seconds=-1)
    )
    
    with pytest.raises(JWTError):
        decode_token(token)
```

---

## Issue 2.4: Build Login and Token Refresh Endpoints

### Context

Create API endpoints for user login and token refresh according to the OpenAPI specification.

### Documentation References

- `/docs/openapi.yml`: /auth/login and /auth/refresh endpoints
- `/docs/SystemRequirementsSpecification.md` Section 4.1.1

### Implementation Steps

1. Create backend/app/modules/auth/router.py
2. Implement POST /api/v1/auth/login:
   ```python
   @router.post("/login", response_model=AuthTokenResponse)
   async def login(
       credentials: AuthLoginRequest,
       db: Session = Depends(get_db)
   ):
       # 1. Fetch user by username
       # 2. Verify password
       # 3. Check if user is active
       # 4. Generate access and refresh tokens
       # 5. Return tokens with expiry
   ```
3. Implement POST /api/v1/auth/refresh:
   ```python
   @router.post("/refresh", response_model=AuthTokenResponse)
   async def refresh(
       request: AuthRefreshRequest
   ):
       # 1. Verify refresh token
       # 2. Check token not blacklisted
       # 3. Generate new access token
       # 4. Optionally rotate refresh token
       # 5. Return new tokens
   ```
4. Implement POST /api/v1/auth/logout:
   - Add tokens to blacklist
   - Return success message
5. Add rate limiting to login endpoint (prevent brute force)
6. Add audit logging for auth events
7. Add comprehensive error handling:
   - Invalid credentials -> 401
   - Inactive user -> 403
   - Missing fields -> 422

### Acceptance Criteria

- [ ] Login returns access and refresh tokens for valid credentials
- [ ] Login returns 401 for invalid credentials
- [ ] Login returns 403 for inactive users
- [ ] Refresh returns new access token for valid refresh token
- [ ] Logout blacklists both tokens
- [ ] Rate limiting prevents brute force attacks
- [ ] All auth events are logged

### Testing Methods

**Integration Tests:**
```python
def test_login_success(client, test_user):
    response = client.post("/api/v1/auth/login", json={
        "username": "testuser",
        "password": "password123"
    })
    
    assert response.status_code == 200
    data = response.json()
    assert "accessToken" in data
    assert "refreshToken" in data
    assert data["expiresIn"] == 1800  # 30 minutes

def test_login_invalid_credentials(client):
    response = client.post("/api/v1/auth/login", json={
        "username": "testuser",
        "password": "wrongpassword"
    })
    
    assert response.status_code == 401
```

---

## Issue 2.5: Create User CRUD API Endpoints

### Context

Implement complete CRUD operations for user management with proper permission checking.

### Documentation References

- `/docs/openapi.yml`: /users/* endpoints
- `/docs/SystemRequirementsSpecification.md` Section 4.1

### Implementation Steps

1. Create backend/app/modules/users/router.py
2. Implement GET /api/v1/users (list users with pagination):
   - Requires "manage_users" permission
   - Support filtering by active status
   - Support search by username/display name
   - Return paginated results with metadata
3. Implement GET /api/v1/users/{id} (get single user):
   - Requires "manage_users" permission
   - Return 404 if user not found
   - Include assigned roles and vans
4. Implement POST /api/v1/users (create user):
   - Requires "manage_users" permission
   - Validate username uniqueness
   - Hash password before storing
   - Validate password complexity (configurable)
   - Assign default role if not specified
5. Implement PATCH /api/v1/users/{id} (update user):
   - Requires "manage_users" permission
   - Support partial updates
   - Re-hash password if changed
   - Cannot deactivate admin user
6. Implement DELETE /api/v1/users/{id} (soft delete):
   - Requires "manage_users" permission
   - Set active = False
   - Cannot delete admin user
7. Implement GET /api/v1/users/me (current user profile):
   - Requires valid authentication only
8. Add input validation for all endpoints
9. Add audit logging for all user changes

### Acceptance Criteria

- [ ] All endpoints match OpenAPI specification
- [ ] Only users with "manage_users" permission can access
- [ ] Username uniqueness is enforced
- [ ] Passwords are hashed and never returned
- [ ] Admin user cannot be deleted or deactivated
- [ ] Pagination works correctly
- [ ] All user changes are audit logged
- [ ] Input validation provides clear error messages

### Testing Methods

**Integration Tests:**
```python
def test_create_user(client, admin_token):
    response = client.post(
        "/api/v1/users",
        json={
            "username": "newuser",
            "password": "SecurePass123",
            "displayName": "New User",
            "roleIds": []
        },
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    assert response.status_code == 201
    data = response.json()
    assert data["username"] == "newuser"
    assert "password" not in data

def test_create_user_without_permission(client, user_token):
    response = client.post(
        "/api/v1/users",
        json={"username": "test", "password": "pass"},
        headers={"Authorization": f"Bearer {user_token}"}
    )
    
    assert response.status_code == 403
```

---

## Issue 2.6: Create Role Management API Endpoints

### Context

Implement CRUD operations for role management with permission assignment.

### Documentation References

- `/docs/openapi.yml`: /roles/* endpoints
- `/docs/SystemRequirementsSpecification.md` Section 4.1.2

### Implementation Steps

1. Create backend/app/modules/roles/router.py
2. Implement GET /api/v1/roles (list all roles):
   - Requires "manage_roles" permission
   - Include permission count in response
3. Implement GET /api/v1/roles/{id} (get single role):
   - Requires "manage_roles" permission
   - Include full permission list
   - Return 404 if role not found
4. Implement POST /api/v1/roles (create role):
   - Requires "manage_roles" permission
   - Validate role name uniqueness
   - Validate all permissions exist
   - Cannot create system roles
5. Implement PATCH /api/v1/roles/{id} (update role):
   - Requires "manage_roles" permission
   - Cannot modify system roles (Admin)
   - Support adding/removing permissions
6. Implement DELETE /api/v1/roles/{id} (delete role):
   - Requires "manage_roles" permission
   - Cannot delete system roles
   - Check if role is assigned to users
   - Return error if role is in use
7. Implement GET /api/v1/permissions (list all permissions):
   - Requires authentication
   - Return permission key and description
8. Add audit logging for role changes

### Acceptance Criteria

- [ ] All endpoints match OpenAPI specification
- [ ] Only users with "manage_roles" permission can access
- [ ] System roles (Admin) cannot be modified or deleted
- [ ] Roles in use cannot be deleted
- [ ] Permission validation works correctly
- [ ] All role changes are audit logged
- [ ] Clear error messages for validation failures

### Testing Methods

**Integration Tests:**
```python
def test_create_role(client, admin_token):
    response = client.post(
        "/api/v1/roles",
        json={
            "name": "Warehouse Staff",
            "permissions": ["view_stock", "create_movements"]
        },
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Warehouse Staff"
    assert len(data["permissions"]) == 2

def test_cannot_delete_system_role(client, admin_token):
    admin_role = # ... fetch admin role
    response = client.delete(
        f"/api/v1/roles/{admin_role.id}",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    assert response.status_code == 403
```

---

## Issue 2.7: Implement Permission Checking Middleware

### Context

Create reusable permission checking decorators and dependencies to enforce RBAC across all endpoints.

### Documentation References

- `/docs/SystemRequirementsSpecification.md` Section 4.1.2: Permission enforcement

### Implementation Steps

1. Create backend/app/common/permissions.py
2. Implement permission checker dependency:
   ```python
   def require_permission(permission: Permission):
       async def permission_checker(
           current_user: User = Depends(get_current_user)
       ):
           if not has_permission(current_user, permission):
               raise HTTPException(
                   status_code=403,
                   detail="Insufficient permissions"
               )
           return current_user
       return permission_checker
   ```
3. Implement has_permission utility:
   ```python
   def has_permission(user: User, permission: Permission) -> bool:
       # Admin always has all permissions
       # Check user's roles for the permission
       # Support permission overrides per user
   ```
4. Implement require_any_permission (OR logic)
5. Implement require_all_permissions (AND logic)
6. Create permission caching (Redis) to avoid repeated DB queries
7. Add permission checking to all protected endpoints
8. Document permission requirements in API documentation
9. Create permission testing utilities

### Acceptance Criteria

- [ ] require_permission dependency works correctly
- [ ] Admin users always pass permission checks
- [ ] Users without permission get 403 Forbidden
- [ ] Permission checks are cached for performance
- [ ] Multiple permission requirements (AND/OR) are supported
- [ ] All protected endpoints use permission checks
- [ ] Permission requirements are documented

### Testing Methods

**Unit Tests:**
```python
def test_admin_has_all_permissions():
    admin = User(...)  # Admin user
    for perm in Permission:
        assert has_permission(admin, perm) == True

def test_user_permission_check():
    user = User(...)  # User with VIEW_STOCK only
    assert has_permission(user, Permission.VIEW_STOCK) == True
    assert has_permission(user, Permission.MANAGE_USERS) == False

@pytest.mark.asyncio
async def test_permission_middleware():
    checker = require_permission(Permission.MANAGE_USERS)
    
    with pytest.raises(HTTPException) as exc:
        await checker(current_user=regular_user)
    
    assert exc.value.status_code == 403
```

---

## Issue 2.8: Build User Management UI Components

### Context

Create React components for user list, creation, and editing in the admin interface.

### Documentation References

- `/docs/SystemRequirementsSpecification.md` Section 4.1

### Implementation Steps

1. Create `frontend/src/components/users/UserList.tsx`:
   - Display users in a table with columns: username, display name, roles, status, actions
   - Support pagination
   - Support filtering by active status
   - Support search by username/name
   - Add "Create User" button
2. Create `frontend/src/components/users/UserForm.tsx`:
   - Form for create/edit with fields:
     - Username (disabled when editing)
     - Display Name
     - Password (only for create, optional for edit)
     - Role selection (multi-select)
     - Van assignment (multi-select)
     - Active checkbox
   - Validation:
     - Required fields
     - Username format
     - Password complexity
   - Submit with React Query mutation
3. Create `frontend/src/components/users/UserDetail.tsx`:
   - Display full user information
   - Show assigned roles with permissions
   - Show assigned vans
   - Edit and delete buttons (with confirmation)
4. Create `frontend/src/pages/UsersPage.tsx`:
   - Layout with UserList
   - Modal for create/edit UserForm
5. Set up React Query hooks:
   - useUsers() for list
   - useUser(id) for details
   - useCreateUser()
   - useUpdateUser()
   - useDeleteUser()
6. Add permission-based UI visibility
7. Style with TailwindCSS
8. Add loading states and error handling

### Acceptance Criteria

- [ ] User list displays with pagination
- [ ] Search and filtering work correctly
- [ ] Create user form validates input
- [ ] Edit user form pre-fills current data
- [ ] Password field is optional for updates
- [ ] Delete requires confirmation
- [ ] Only users with permission see admin features
- [ ] Loading and error states are user-friendly
- [ ] UI is responsive on mobile and desktop

### Testing Methods

**Component Tests (Vitest + React Testing Library):**
```typescript
describe('UserList', () => {
  it('renders users', async () => {
    const { getByText } = render(<UserList />);
    await waitFor(() => {
      expect(getByText('testuser')).toBeInTheDocument();
    });
  });
  
  it('opens create modal', () => {
    const { getByText, getByRole } = render(<UserList />);
    fireEvent.click(getByText('Create User'));
    expect(getByRole('dialog')).toBeInTheDocument();
  });
});
```

**Manual Testing:**
- Navigate to /users
- Verify list loads
- Create a new user
- Edit an existing user
- Delete a user
- Test on mobile viewport

---

## Issue 2.9: Build Login/Logout UI

### Context

Create user-facing login form and session management UI.

### Documentation References

- `/docs/SystemRequirementsSpecification.md` Section 4.1.1

### Implementation Steps

1. Create `frontend/src/components/auth/LoginForm.tsx`:
   - Username input
   - Password input (with show/hide toggle)
   - Remember me checkbox (optional)
   - Submit button
   - Loading state during authentication
   - Error display for failed login
   - Validation (required fields)
2. Create `frontend/src/pages/LoginPage.tsx`:
   - Center the LoginForm
   - Add branding/logo
   - Responsive layout
3. Create auth context `frontend/src/contexts/AuthContext.tsx`:
   - Store access token in memory
   - Store refresh token in httpOnly cookie or localStorage
   - Provide login(), logout(), isAuthenticated
   - Auto-refresh tokens before expiry
   - Redirect to login on 401 responses
4. Create `frontend/src/components/layout/Header.tsx`:
   - Display logged-in user name
   - Logout button
   - Navigation menu (permission-based)
5. Set up protected routes:
   - Redirect to /login if not authenticated
   - Redirect to / after successful login
6. Configure Axios interceptors:
   - Add Authorization header
   - Handle 401 with token refresh
   - Logout on refresh failure
7. Style with TailwindCSS
8. Add "forgot password" placeholder (implement later)

### Acceptance Criteria

- [ ] Login form validates input
- [ ] Successful login redirects to dashboard
- [ ] Failed login shows error message
- [ ] Token is stored securely
- [ ] Auth state persists across page reloads
- [ ] Logout clears tokens and redirects to login
- [ ] Protected routes require authentication
- [ ] Expired tokens are refreshed automatically
- [ ] UI is responsive and accessible

### Testing Methods

**Component Tests:**
```typescript
describe('LoginForm', () => {
  it('submits credentials', async () => {
    const { getByLabelText, getByText } = render(<LoginForm />);
    
    fireEvent.change(getByLabelText('Username'), {
      target: { value: 'testuser' }
    });
    fireEvent.change(getByLabelText('Password'), {
      target: { value: 'password123' }
    });
    fireEvent.click(getByText('Login'));
    
    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('testuser', 'password123');
    });
  });
});
```

**Manual Testing:**
- Navigate to /login
- Submit with invalid credentials -> see error
- Submit with valid credentials -> redirect to dashboard
- Logout -> redirect to login
- Refresh page while logged in -> remain authenticated

---

## Issue 2.10: Create Admin User Initialization Script

### Context

Provide a script to create the initial admin user for system bootstrapping.

### Documentation References

- `/docs/SystemRequirementsSpecification.md` Section 4.1.3: Admin requirements

### Implementation Steps

1. Create `backend/scripts/init_admin.py`:
   ```python
   def create_admin_user(
       username: str,
       password: str,
       display_name: str = "System Administrator"
   ):
       # 1. Check if admin user already exists
       # 2. Hash password
       # 3. Create admin role if not exists (all permissions)
       # 4. Create admin user
       # 5. Assign admin role
       # 6. Mark role as system role (cannot be deleted)
       # 7. Print credentials (only once)
   ```
2. Add command-line interface:
   ```bash
   python -m scripts.init_admin \
       --username admin \
       --password <secure-password>
   ```
3. Add to docker entrypoint (run once on first startup)
4. Add environment variable support:
   - ADMIN_USERNAME (default: admin)
   - ADMIN_PASSWORD (required on first run)
5. Add validation:
   - Password complexity requirements
   - Username format
6. Log admin creation to audit log
7. Document in README.md setup section
8. Add to Makefile: `make init-admin`

### Acceptance Criteria

- [ ] Script creates admin user successfully
- [ ] Admin user has all permissions
- [ ] Admin role cannot be deleted or modified
- [ ] Script is idempotent (safe to run multiple times)
- [ ] Password complexity is validated
- [ ] Script can run from command line or Docker
- [ ] Environment variables are supported
- [ ] Creation is audit logged

### Testing Methods

**Integration Tests:**
```python
def test_create_admin_user():
    create_admin_user("admin", "SecureP@ss123")
    
    admin = db.query(User).filter(
        User.username == "admin"
    ).first()
    
    assert admin is not None
    assert admin.active == True
    
    admin_role = db.query(Role).filter(
        Role.name == "Admin"
    ).first()
    
    assert admin_role.is_system == True
    assert len(admin_role.permissions) == len(list(Permission))
```

**Manual Testing:**
```bash
# From backend directory
python -m scripts.init_admin --username admin --password "MySecurePass123!"

# Verify in database
docker-compose exec postgres psql -U stockuser -d stockcontrol -c "SELECT username, display_name FROM users WHERE username='admin';"

# Try to login via API
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"MySecurePass123!"}'
```

---

# Milestone 3: Stock Item Management

## Issue 3.1: Implement Item Model and Database Schema

### Context

Create the Item model with all required fields for comprehensive stock item tracking including multi-code support and supplier relationships.

### Documentation References

- `/docs/SystemRequirementsSpecification.md` Section 4.2: Items & Stock
- `/docs/openapi.yml`: Item, ItemCreate, ItemUpdate schemas

### Implementation Steps

1. Create `backend/app/modules/items/models.py`:
   ```python
   class Item(Base):
       __tablename__ = "items"
       
       id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
       name = Column(String, nullable=False, index=True)
       sku = Column(String, unique=True, nullable=False, index=True)
       description = Column(Text)
       category = Column(String, index=True)
       photo_url = Column(String)
       unit_type = Column(Enum('unit', 'meter', 'kg', 'litre', 'box', 'flexi'), nullable=False)
       minimum_level = Column(Numeric(precision=10, scale=2))
       length = Column(Numeric(precision=10, scale=2))
       width = Column(Numeric(precision=10, scale=2))
       height = Column(Numeric(precision=10, scale=2))
       weight = Column(Numeric(precision=10, scale=2))
       active = Column(Boolean, default=True, nullable=False)
       created_at = Column(DateTime(timezone=True), server_default=func.now())
       updated_at = Column(DateTime(timezone=True), onupdate=func.now())
       
       # Relationships
       codes = relationship("ItemCode", back_populates="item", cascade="all, delete-orphan")
       suppliers = relationship("ItemSupplier", back_populates="item", cascade="all, delete-orphan")
       movements = relationship("Movement", back_populates="item")
   ```
2. Create UnitType enum
3. Create Pydantic schemas:
   - ItemBase with all fields
   - ItemCreate (without id)
   - ItemUpdate (all fields optional)
   - ItemResponse (with timestamps)
   - DimensionsSchema (nested)
4. Add full-text search support for name and description
5. Create database indexes:
   - sku (unique)
   - name (for search)
   - category (for filtering)
   - active status
6. Create Alembic migration for items table
7. Add constraints:
   - Check minimum_level >= 0
   - Check dimensions > 0 if present

### Acceptance Criteria

- [ ] Item model matches OpenAPI Item schema exactly
- [ ] SKU is unique and indexed
- [ ] All unit types from requirements are supported
- [ ] Dimensions are optional
- [ ] Relationships to codes and suppliers are defined
- [ ] Pydantic schemas validate all fields correctly
- [ ] Migration creates items table with all constraints
- [ ] Soft delete is supported via active field
- [ ] Full-text search is configured

### Testing Methods

**Unit Tests:**
```python
def test_item_creation():
    item = Item(
        name="Test Widget",
        sku="WID-001",
        unit_type="unit",
        category="Widgets"
    )
    db.add(item)
    db.commit()
    
    assert item.id is not None
    assert item.active == True
    assert item.sku == "WID-001"

def test_sku_uniqueness():
    item1 = Item(name="Item 1", sku="DUP-001", unit_type="unit")
    db.add(item1)
    db.commit()
    
    item2 = Item(name="Item 2", sku="DUP-001", unit_type="unit")
    db.add(item2)
    
    with pytest.raises(IntegrityError):
        db.commit()
```

---

## Issue 3.2: Implement ItemCode Model (Barcodes and QR Codes)

### Context

Create ItemCode model to support multiple barcodes and QR codes per item for flexible identification.

### Documentation References

- `/docs/SystemRequirementsSpecification.md` Section 4.2.2: Multi-Code Identification
- `/docs/openapi.yml`: ItemCode, ItemCodeCreate schemas

### Implementation Steps

1. Create ItemCode model in models.py:
   ```python
   class ItemCode(Base):
       __tablename__ = "item_codes"
       
       id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
       item_id = Column(UUID(as_uuid=True), ForeignKey("items.id"), nullable=False)
       code = Column(String, nullable=False, index=True)
       code_type = Column(Enum('barcode', 'qr'), nullable=False)
       is_primary = Column(Boolean, default=False)
       created_at = Column(DateTime(timezone=True), server_default=func.now())
       
       # Relationships
       item = relationship("Item", back_populates="codes")
       
       __table_args__ = (
           UniqueConstraint('code', 'code_type', name='unique_code_type'),
           Index('idx_code_lookup', 'code', 'code_type'),
       )
   ```
2. Create CodeType enum ('barcode', 'qr')
3. Create Pydantic schemas:
   - ItemCodeBase
   - ItemCodeCreate
   - ItemCodeResponse
4. Add code validation:
   - Barcode format validation (UPC, EAN, Code128, etc.)
   - QR code format validation
5. Create unique constraint: (code, code_type) must be unique
6. Create fast lookup index for scanning
7. Create Alembic migration
8. Add business logic:
   - Only one primary code per item per type
   - Auto-set first code as primary

### Acceptance Criteria

- [ ] ItemCode model supports barcodes and QR codes
- [ ] Code + type combination is unique
- [ ] Fast lookup by code is possible
- [ ] Primary code logic works correctly
- [ ] Pydantic schemas validate code format
- [ ] Migration creates item_codes table
- [ ] Relationships to Item work correctly

### Testing Methods

**Unit Tests:**
```python
def test_item_code_creation():
    item = create_test_item()
    code = ItemCode(
        item_id=item.id,
        code="1234567890128",
        code_type="barcode",
        is_primary=True
    )
    db.add(code)
    db.commit()
    
    assert code.id is not None
    assert code.item.name == item.name

def test_code_uniqueness():
    item = create_test_item()
    code1 = ItemCode(item_id=item.id, code="12345", code_type="barcode")
    db.add(code1)
    db.commit()
    
    code2 = ItemCode(item_id=item.id, code="12345", code_type="barcode")
    db.add(code2)
    
    with pytest.raises(IntegrityError):
        db.commit()
```

---

## Issue 3.3: Implement ItemSupplier Model and Schema

### Context

Create ItemSupplier model to track supplier information and ordering links for each item.

### Documentation References

- `/docs/SystemRequirementsSpecification.md` Section 4.2.1: Item Creation with supplier list
- `/docs/openapi.yml`: ItemSupplier, ItemSupplierCreate, ItemSupplierUpdate schemas

### Implementation Steps

1. Create ItemSupplier model in models.py:
   ```python
   class ItemSupplier(Base):
       __tablename__ = "item_suppliers"
       
       id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
       item_id = Column(UUID(as_uuid=True), ForeignKey("items.id"), nullable=False)
       supplier_name = Column(String, nullable=False)
       supplier_sku = Column(String)
       unit_cost = Column(Numeric(precision=10, scale=2))
       currency = Column(String(3), default="GBP")
       ordering_url = Column(String)
       lead_time_days = Column(Integer)
       minimum_order_quantity = Column(Numeric(precision=10, scale=2))
       is_preferred = Column(Boolean, default=False)
       active = Column(Boolean, default=True)
       notes = Column(Text)
       created_at = Column(DateTime(timezone=True), server_default=func.now())
       updated_at = Column(DateTime(timezone=True), onupdate=func.now())
       
       # Relationships
       item = relationship("Item", back_populates="suppliers")
   ```
2. Create Pydantic schemas:
   - ItemSupplierBase
   - ItemSupplierCreate
   - ItemSupplierUpdate
   - ItemSupplierResponse
3. Add indexes:
   - item_id (for lookup)
   - supplier_name (for search)
4. Create Alembic migration
5. Add business logic:
   - Only one preferred supplier per item
   - Cost and currency validation
6. Add supplier cost history tracking (optional extension)

### Acceptance Criteria

- [ ] ItemSupplier model has all required fields
- [ ] Cost is stored with appropriate precision
- [ ] Currency defaults to GBP
- [ ] Preferred supplier logic works correctly
- [ ] Pydantic schemas validate data
- [ ] Migration creates item_suppliers table
- [ ] Relationships work correctly
- [ ] Soft delete via active field

### Testing Methods

**Unit Tests:**
```python
def test_item_supplier_creation():
    item = create_test_item()
    supplier = ItemSupplier(
        item_id=item.id,
        supplier_name="Acme Corp",
        supplier_sku="AC-12345",
        unit_cost=Decimal("15.99"),
        is_preferred=True
    )
    db.add(supplier)
    db.commit()
    
    assert supplier.id is not None
    assert supplier.currency == "GBP"
    assert item.suppliers[0].supplier_name == "Acme Corp"

def test_preferred_supplier_logic():
    item = create_test_item()
    
    supplier1 = ItemSupplier(item_id=item.id, supplier_name="S1", is_preferred=True)
    db.add(supplier1)
    db.commit()
    
    supplier2 = ItemSupplier(item_id=item.id, supplier_name="S2", is_preferred=True)
    # Business logic should set supplier1.is_preferred = False
```

---

## Issue 3.4: Create Item CRUD API Endpoints

### Context

Implement complete CRUD operations for items with proper permission checking and validation.

### Documentation References

- `/docs/openapi.yml`: /items/* endpoints
- `/docs/SystemRequirementsSpecification.md` Section 4.2.1

### Implementation Steps

1. Create `backend/app/modules/items/router.py`
2. Implement GET /api/v1/items (list items with pagination):
   - Requires "view_stock" permission
   - Support pagination (limit, offset)
   - Support filtering:
     - category
     - unit_type
     - active status
     - minimum_level threshold
   - Support search (name, SKU, description)
   - Support sorting (name, sku, category, created_at)
   - Return with pagination metadata
3. Implement GET /api/v1/items/{id} (get single item):
   - Requires "view_stock" permission
   - Include all item details
   - Include codes and suppliers
   - Include current stock summary
   - Return 404 if not found
4. Implement POST /api/v1/items (create item):
   - Requires "edit_items" permission
   - Validate SKU uniqueness
   - Validate required fields
   - Validate unit_type enum
   - Return created item with 201 status
5. Implement PATCH /api/v1/items/{id} (update item):
   - Requires "edit_items" permission
   - Support partial updates
   - Validate SKU uniqueness if changed
   - Cannot modify if item has movements (optional constraint)
6. Implement DELETE /api/v1/items/{id} (soft delete):
   - Requires "edit_items" permission
   - Set active = False
   - Return 204 No Content
7. Add comprehensive input validation
8. Add audit logging for all item changes
9. Implement caching for frequently accessed items

### Acceptance Criteria

- [ ] All endpoints match OpenAPI specification
- [ ] Permission checking works correctly
- [ ] SKU uniqueness is enforced
- [ ] Pagination works correctly
- [ ] Search and filtering return correct results
- [ ] Validation provides clear error messages
- [ ] All item changes are audit logged
- [ ] Soft delete preserves data
- [ ] Caching improves performance

### Testing Methods

**Integration Tests:**
```python
def test_create_item(client, auth_token):
    response = client.post(
        "/api/v1/items",
        json={
            "name": "Widget Pro",
            "sku": "WP-001",
            "unitType": "unit",
            "category": "Widgets",
            "minimumLevel": 10
        },
        headers={"Authorization": f"Bearer {auth_token}"}
    )
    
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Widget Pro"
    assert data["sku"] == "WP-001"
    assert "id" in data

def test_list_items_with_filter(client, auth_token):
    response = client.get(
        "/api/v1/items?category=Widgets&limit=10",
        headers={"Authorization": f"Bearer {auth_token}"}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert "meta" in data
    assert all(item["category"] == "Widgets" for item in data["items"])
```

---

Due to character limits, I'll create this comprehensive issues document that continues with all remaining issues. Let me create the full document now:

<function_calls>
<invoke name="bash">
<parameter name="command">wc -c /home/runner/work/StockControl/StockControl/ISSUES.md