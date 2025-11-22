# Docker Development Environment Guide

## Overview

This project uses Docker Compose to provide a complete containerized development environment. This ensures consistency across development setups and simplifies onboarding for new developers.

## Architecture

### Services

The development environment consists of 5 services:

1. **PostgreSQL 15** - Primary database
2. **Redis 7** - Cache and session storage
3. **Backend** - FastAPI application (Python 3.11)
4. **Frontend** - React application (Node.js 20)
5. **Nginx** - Reverse proxy

### Network Flow

```
┌─────────┐
│ Client  │
└────┬────┘
     │
     ▼
┌─────────────────┐
│  Nginx (port 80)│
└────┬───────┬────┘
     │       │
     │       └──────────────────┐
     │                          │
     ▼                          ▼
┌──────────────┐        ┌──────────────┐
│   Backend    │        │   Frontend   │
│  (port 8000) │        │  (port 5173) │
└──┬────────┬──┘        └──────────────┘
   │        │
   │        └──────────┐
   ▼                   ▼
┌──────────┐      ┌─────────┐
│PostgreSQL│      │  Redis  │
│(port 5432)│      │(port 6379)│
└──────────┘      └─────────┘
```

## Quick Start

### Prerequisites

- Docker Engine 20.10+ or Docker Desktop
- Docker Compose v2.0+
- Make (optional, for Makefile commands)

### Getting Started

1. **Clone the repository**
   ```bash
   git clone https://github.com/TheCharlesChristy/StockControl.git
   cd StockControl
   ```

2. **Copy environment file**
   ```bash
   cp .env.example .env
   ```

3. **Start all services**
   ```bash
   make up
   # or
   docker compose up -d
   ```

4. **Run database migrations**
   ```bash
   make migrate
   # or
   docker compose exec backend alembic upgrade head
   ```

5. **Access the application**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:8000
   - API Docs: http://localhost:8000/api/v1/docs
   - Nginx: http://localhost:80

## Makefile Commands

The project includes a Makefile with convenient commands:

```bash
make help        # Show all available commands
make up          # Start all services
make down        # Stop all services
make build       # Build/rebuild containers
make logs        # View logs from all services
make test        # Run backend tests
make migrate     # Run database migrations
make clean       # Remove all containers, volumes, and images
make restart     # Restart all services
make ps          # Show running containers
make shell-backend   # Open shell in backend container
make shell-frontend  # Open shell in frontend container
```

## Development Workflow

### Hot-Reloading

Both backend and frontend support hot-reloading:

- **Backend**: uvicorn automatically reloads on Python file changes
- **Frontend**: Vite HMR (Hot Module Replacement) updates the browser instantly

### Making Code Changes

1. Edit files in your local `backend/` or `frontend/` directories
2. Changes are automatically synced to containers via volume mounts
3. Services automatically reload with your changes

### Running Tests

```bash
# Backend tests
make test
# or
docker compose exec backend pytest

# With coverage
docker compose exec backend pytest --cov=app --cov-report=term-missing

# Backend linting
docker compose exec backend flake8 app tests

# Frontend linting
docker compose exec frontend npm run lint

# Frontend type checking
docker compose exec frontend npx tsc --noEmit
```

### Database Migrations

```bash
# Run migrations
make migrate
# or
docker compose exec backend alembic upgrade head

# Create a new migration
docker compose exec backend alembic revision --autogenerate -m "description"

# Rollback one migration
docker compose exec backend alembic downgrade -1
```

### Accessing Services

#### Backend Shell
```bash
make shell-backend
# or
docker compose exec backend /bin/bash
```

#### Frontend Shell
```bash
make shell-frontend
# or
docker compose exec frontend /bin/sh
```

#### Database Access
```bash
docker compose exec postgres psql -U stockuser -d stockcontrol
```

#### Redis CLI
```bash
docker compose exec redis redis-cli
```

## Environment Variables

### Root .env File

The root `.env` file controls Docker Compose settings:

```env
# Database
POSTGRES_DB=stockcontrol
POSTGRES_USER=stockuser
POSTGRES_PASSWORD=stockpass
POSTGRES_PORT=5432

# Redis
REDIS_PORT=6379

# Backend
BACKEND_PORT=8000
DEBUG=True
SECRET_KEY=change-me-in-production-use-strong-random-key

# Frontend
FRONTEND_PORT=5173
VITE_API_BASE_URL=http://localhost:8000/api/v1

# Nginx
NGINX_PORT=80
```

### Backend .env File

Backend services can also use `backend/.env` for local development without Docker:

```env
DATABASE_URL=postgresql://stockuser:stockpass@localhost:5432/stockcontrol
REDIS_URL=redis://localhost:6379/0
SECRET_KEY=change-me-in-production-use-strong-random-key
```

### Frontend .env File

Frontend services can use `frontend/.env` for local development:

```env
VITE_API_BASE_URL=http://localhost:8000/api/v1
```

## Troubleshooting

### Port Conflicts

If you get port conflicts, update the ports in `.env`:

```env
POSTGRES_PORT=5433  # Instead of 5432
BACKEND_PORT=8001   # Instead of 8000
FRONTEND_PORT=5174  # Instead of 5173
NGINX_PORT=8080     # Instead of 80
```

### Services Not Starting

1. **Check logs**
   ```bash
   make logs
   # or
   docker compose logs -f [service-name]
   ```

2. **Check service health**
   ```bash
   docker compose ps
   ```

3. **Rebuild containers**
   ```bash
   make build
   make up
   ```

### Database Connection Issues

1. **Wait for database to be ready**
   ```bash
   docker compose ps
   # Wait for postgres to show "healthy" status
   ```

2. **Check database logs**
   ```bash
   docker compose logs postgres
   ```

3. **Reset database**
   ```bash
   make down
   docker volume rm stockcontrol_postgres_data
   make up
   make migrate
   ```

### Frontend Not Loading

1. **Check if frontend is running**
   ```bash
   docker compose logs frontend
   ```

2. **Rebuild frontend**
   ```bash
   docker compose build frontend
   docker compose up -d frontend
   ```

3. **Check node_modules volume**
   ```bash
   docker compose exec frontend ls -la node_modules
   ```

### Cache Issues

Clear Docker build cache:

```bash
docker compose build --no-cache
```

## Volumes

The setup uses several volumes:

### Named Volumes (Persistent Data)

- `postgres_data`: PostgreSQL database files
- `redis_data`: Redis persistence files

### Anonymous Volumes (Cache)

- `/app/__pycache__`: Python bytecode cache (backend)
- `/app/node_modules`: NPM packages (frontend)

### Bind Mounts (Code Sync)

- `./backend:/app`: Backend source code
- `./frontend:/app`: Frontend source code
- `./nginx/nginx.conf:/etc/nginx/conf.d/default.conf`: Nginx config

## Performance Optimization

### macOS and Windows

For better performance on macOS/Windows, consider:

1. **Use Docker Desktop with VirtioFS** (macOS) or **WSL2** (Windows)
2. **Exclude directories from sync** that don't need hot-reloading:
   - `__pycache__`
   - `node_modules`
   - `.pytest_cache`

### Build Time Optimization

The project includes `.dockerignore` files to exclude unnecessary files from Docker build context:

- `backend/.dockerignore`
- `frontend/.dockerignore`

## Production Considerations

⚠️ **This setup is for DEVELOPMENT ONLY**

For production deployment:

1. Remove `--reload` flag from uvicorn
2. Use environment-specific `.env` files
3. Generate strong `SECRET_KEY`
4. Use production-grade PostgreSQL settings
5. Enable SSL/TLS for all services
6. Use Docker secrets for sensitive data
7. Implement proper logging and monitoring
8. Use multi-stage builds for smaller images
9. Run containers as non-root users
10. Set resource limits for containers

## Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [FastAPI Deployment](https://fastapi.tiangolo.com/deployment/)
- [Vite Production Build](https://vitejs.dev/guide/build.html)

## Support

For issues related to the Docker setup:

1. Check existing [GitHub Issues](https://github.com/TheCharlesChristy/StockControl/issues)
2. Review this documentation
3. Check Docker and Docker Compose logs
4. Create a new issue with:
   - Docker version (`docker --version`)
   - Docker Compose version (`docker compose version`)
   - Operating system
   - Error logs
   - Steps to reproduce

---

**Last Updated**: November 2025
