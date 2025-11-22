# Stock Management API - Backend

FastAPI-based backend for the Stock Management & Location Tracking System.

## Prerequisites

- Python 3.11 or higher
- pip (Python package manager)

## Setup Instructions

### 1. Create Virtual Environment

```bash
cd backend
python3 -m venv venv
```

### 2. Activate Virtual Environment

**Linux/MacOS:**
```bash
source venv/bin/activate
```

**Windows:**
```bash
venv\Scripts\activate
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

### 4. Set Up PostgreSQL Database and Redis

Start the PostgreSQL database and Redis using Docker Compose (from the project root):

```bash
cd ..
docker compose up -d postgres redis
```

Wait for services to fully start (about 10 seconds), then return to the backend directory:

```bash
cd backend
```

You can verify Redis is running:

```bash
docker exec stockcontrol_redis redis-cli ping
# Should return: PONG
```

### 5. Configure Environment Variables

Create a `.env` file in the backend directory:

```env
# Application
DEBUG=True
APP_NAME=Stock Management API
APP_VERSION=1.0.0

# API
API_V1_PREFIX=/api/v1

# CORS
CORS_ORIGINS=http://localhost:3000,http://localhost:5173

# Database
DATABASE_URL=postgresql://stockuser:stockpass@localhost:5432/stockcontrol

# Redis
REDIS_URL=redis://localhost:6379/0

# Security (change in production!)
SECRET_KEY=your-secret-key-here
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7
```

### 6. Run Database Migrations

Initialize the database schema using Alembic:

```bash
alembic upgrade head
```

This will create the necessary database tables and structure.

## Running the Application

### Start the Development Server

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at:
- API: http://localhost:8000
- Interactive Docs (Swagger): http://localhost:8000/api/v1/docs
- Alternative Docs (ReDoc): http://localhost:8000/api/v1/redoc

### Health Check

Test the health check endpoint:

```bash
curl http://localhost:8000/api/v1/health
```

Expected response:
```json
{
  "status": "ok",
  "version": "1.0.0",
  "redis": "connected"
}
```

### Using Redis Cache Utilities

The application includes built-in Redis caching utilities. Here's how to use them:

```python
from app.redis import get_cached, set_cached, invalidate_cache, invalidate_cache_pattern

# Cache a value (expires in 3600 seconds)
set_cached("user:123", {"name": "John", "role": "admin"}, expire=3600)

# Retrieve cached value
user_data = get_cached("user:123")

# Invalidate a single cache entry
invalidate_cache("user:123")

# Invalidate all cache entries matching a pattern
invalidate_cache_pattern("user:*")
```

## Project Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI application entry point
│   ├── config.py            # Configuration management
│   ├── database.py          # Database configuration & session management
│   ├── dependencies.py      # Dependency injection (to be added)
│   ├── modules/             # Feature modules
│   │   ├── __init__.py
│   │   ├── auth/           # Authentication
│   │   ├── users/          # User management
│   │   ├── roles/          # Role management
│   │   ├── items/          # Stock items
│   │   ├── locations/      # Locations & vans
│   │   ├── maps/           # Maps & visual navigation
│   │   ├── movements/      # Stock movements
│   │   ├── stock_requests/ # Stock requests
│   │   └── notifications/  # Notifications
│   └── common/             # Shared utilities
│       ├── __init__.py
│       ├── schemas.py      # Common Pydantic schemas
│       └── utils.py        # Utility functions
├── tests/                  # Test suite
├── alembic/               # Database migrations
└── requirements.txt       # Python dependencies
```

## Development Guidelines

### Database Management

**Creating Migrations:**
When you make changes to database models, create a new migration:

```bash
alembic revision --autogenerate -m "Description of changes"
```

**Applying Migrations:**
Apply pending migrations to the database:

```bash
alembic upgrade head
```

**Rolling Back Migrations:**
Rollback the last migration:

```bash
alembic downgrade -1
```

**Migration History:**
View migration history:

```bash
alembic history
alembic current
```

**Stopping Services:**
When you're done developing, stop all services:

```bash
docker compose down
```

To remove all volumes (⚠️ this will delete all data):

```bash
docker compose down -v
```

### Code Style
- Follow PEP 8 style guide
- Use type hints for all function parameters and return values
- Document functions and classes with docstrings

### Module Structure
Each module should contain:
- `models.py` - SQLAlchemy models
- `schemas.py` - Pydantic schemas for validation
- `router.py` - FastAPI route definitions
- `service.py` - Business logic
- `dependencies.py` - Module-specific dependencies

## Next Steps

1. ✅ Set up database connection (Issue 1.3) - Complete
2. ✅ Configure Redis for caching (Issue 1.4) - Complete
3. Implement authentication module (Issue 2.x)
4. Implement user management (Issue 2.x)
5. Add additional feature modules

## API Documentation

The OpenAPI specification is available at `/docs/openapi.yml` in the repository root.

## License

See repository LICENSE file.
