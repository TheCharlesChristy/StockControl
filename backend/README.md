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

### 4. Configure Environment Variables (Optional)

Create a `.env` file in the backend directory:

```env
# Application
DEBUG=True
APP_NAME=Stock Management API
APP_VERSION=1.0.0

# API
API_V1_PREFIX=/api/v1

# CORS
CORS_ORIGINS=["http://localhost:3000", "http://localhost:5173"]

# Database (to be configured later)
# DATABASE_URL=postgresql://user:password@localhost:5432/stockmanagement

# Redis (to be configured later)
# REDIS_URL=redis://localhost:6379/0

# Security (change in production!)
SECRET_KEY=your-secret-key-here
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7
```

## Running the Application

### Development Server

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
  "version": "1.0.0"
}
```

## Project Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI application entry point
│   ├── config.py            # Configuration management
│   ├── database.py          # Database configuration (to be added)
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

1. Set up database connection (Issue 1.3)
2. Implement authentication module (Issue 2.x)
3. Implement user management (Issue 2.x)
4. Add additional feature modules

## API Documentation

The OpenAPI specification is available at `/docs/openapi.yml` in the repository root.

## License

See repository LICENSE file.
