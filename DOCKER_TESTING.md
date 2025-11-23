# Docker Development Environment - Testing & Validation Checklist

## Overview
This document provides a comprehensive testing checklist for the Docker development environment setup.

## Prerequisites Verification

- [ ] Docker Engine 20.10+ installed
  ```bash
  docker --version
  ```

- [ ] Docker Compose v2.0+ installed
  ```bash
  docker compose version
  ```

- [ ] Make installed (optional)
  ```bash
  make --version
  ```

- [ ] Git installed
  ```bash
  git --version
  ```

## Initial Setup Tests

### 1. Repository Setup

- [ ] Clone repository successfully
  ```bash
  git clone https://github.com/TheCharlesChristy/StockControl.git
  cd StockControl
  ```

- [ ] Environment file exists
  ```bash
  ls -la .env.example
  ```

- [ ] Create .env file from example
  ```bash
  cp .env.example .env
  cat .env
  ```

### 2. Docker Configuration Validation

- [ ] Docker Compose configuration is valid
  ```bash
  docker compose config
  ```
  Expected: No errors, configuration displays correctly

- [ ] Dockerfiles exist for backend and frontend
  ```bash
  ls -la backend/Dockerfile
  ls -la frontend/Dockerfile
  ```

- [ ] Nginx configuration exists
  ```bash
  ls -la nginx/nginx.conf
  ```

- [ ] .dockerignore files exist
  ```bash
  ls -la backend/.dockerignore
  ls -la frontend/.dockerignore
  ```

## Service Startup Tests

### 3. Build Containers

- [ ] Build all containers without errors
  ```bash
  make build
  # or
  docker compose build
  ```
  Expected: All services build successfully

- [ ] Check built images
  ```bash
  docker images | grep stockcontrol
  ```
  Expected: See stockcontrol-backend and stockcontrol-frontend images

### 4. Start Services

- [ ] Start all services
  ```bash
  make up
  # or
  docker compose up -d
  ```
  Expected: All services start successfully

- [ ] Verify all containers are running
  ```bash
  make ps
  # or
  docker compose ps
  ```
  Expected: All 5 services (postgres, redis, backend, frontend, nginx) are running

- [ ] Check service health
  ```bash
  docker compose ps
  ```
  Expected: postgres and redis show "healthy" status

## Service Accessibility Tests

### 5. Backend API Tests

- [ ] Backend health endpoint responds
  ```bash
  curl http://localhost:8000/api/v1/health
  ```
  Expected: JSON response with `{"status":"ok",...}`

- [ ] Backend root endpoint responds
  ```bash
  curl http://localhost:8000/
  ```
  Expected: JSON response with welcome message

- [ ] API documentation is accessible
  - Open browser: http://localhost:8000/api/v1/docs
  - Expected: Swagger UI loads successfully

- [ ] Backend is accessible via nginx
  ```bash
  curl http://localhost:80/api/v1/health
  ```
  Expected: Same response as direct backend access

### 6. Frontend Tests

- [ ] Frontend is accessible directly
  - Open browser: http://localhost:5173
  - Expected: React app loads

- [ ] Frontend is accessible via nginx
  - Open browser: http://localhost:80
  - Expected: React app loads through nginx

- [ ] Frontend can connect to backend API
  - Check browser console for API calls
  - Expected: No CORS errors

### 7. Database Tests

- [ ] Can connect to PostgreSQL
  ```bash
  docker compose exec postgres psql -U stockuser -d stockcontrol -c "SELECT version();"
  ```
  Expected: PostgreSQL version information

- [ ] Database has correct schema (after migrations)
  ```bash
  docker compose exec postgres psql -U stockuser -d stockcontrol -c "\dt"
  ```
  Expected: List of tables (after running migrations)

### 8. Redis Tests

- [ ] Can connect to Redis
  ```bash
  docker compose exec redis redis-cli ping
  ```
  Expected: PONG

- [ ] Redis is accessible from backend
  ```bash
  docker compose exec backend python -c "import redis; r=redis.from_url('redis://redis:6379/0'); print(r.ping())"
  ```
  Expected: True

## Development Workflow Tests

### 9. Hot-Reloading Tests

#### Backend Hot-Reload

- [ ] Make a change to a backend file
  ```bash
  # Add a comment or modify backend/app/main.py
  echo "# Test change" >> backend/app/main.py
  ```

- [ ] Watch backend logs
  ```bash
  docker compose logs -f backend
  ```
  Expected: See uvicorn detecting changes and reloading

- [ ] Revert the change
  ```bash
  git checkout backend/app/main.py
  ```

#### Frontend Hot-Reload

- [ ] Make a change to a frontend file
  ```bash
  # Modify frontend/src/App.tsx or similar
  ```

- [ ] Watch frontend logs
  ```bash
  docker compose logs -f frontend
  ```
  Expected: See Vite HMR update

- [ ] Check browser
  Expected: Page updates automatically without full reload

- [ ] Revert the change

### 10. Database Migration Tests

- [ ] Run database migrations
  ```bash
  make migrate
  # or
  docker compose exec backend alembic upgrade head
  ```
  Expected: Migrations run successfully

- [ ] Verify migration status
  ```bash
  docker compose exec backend alembic current
  ```
  Expected: Shows current migration revision

### 11. Testing Inside Containers

#### Backend Tests

- [ ] Run backend tests
  ```bash
  make test
  # or
  docker compose exec backend pytest
  ```
  Expected: Tests pass

- [ ] Run backend tests with coverage
  ```bash
  docker compose exec backend pytest --cov=app --cov-report=term-missing
  ```
  Expected: Coverage report displays

- [ ] Run backend linter
  ```bash
  docker compose exec backend flake8 app tests
  ```
  Expected: No linting errors (or expected errors only)

#### Frontend Tests

- [ ] Run frontend linter
  ```bash
  docker compose exec frontend npm run lint
  ```
  Expected: No linting errors (or expected errors only)

- [ ] Run frontend type checking
  ```bash
  docker compose exec frontend npx tsc --noEmit
  ```
  Expected: No type errors (or expected errors only)

- [ ] Run frontend build
  ```bash
  docker compose exec frontend npm run build
  ```
  Expected: Build completes successfully

### 12. Shell Access Tests

- [ ] Access backend shell
  ```bash
  make shell-backend
  # or
  docker compose exec backend /bin/bash
  ```
  Expected: Shell prompt in backend container

- [ ] Verify Python environment
  ```bash
  python --version
  pip list
  exit
  ```

- [ ] Access frontend shell
  ```bash
  make shell-frontend
  # or
  docker compose exec frontend /bin/sh
  ```
  Expected: Shell prompt in frontend container

- [ ] Verify Node environment
  ```bash
  node --version
  npm --version
  exit
  ```

## Makefile Command Tests

### 13. Test All Makefile Commands

- [ ] Test help command
  ```bash
  make help
  ```
  Expected: List of available commands

- [ ] Test logs command
  ```bash
  make logs
  # Press Ctrl+C to exit
  ```
  Expected: Logs from all services stream

- [ ] Test restart command
  ```bash
  make restart
  ```
  Expected: All services restart successfully

- [ ] Test ps command
  ```bash
  make ps
  ```
  Expected: Container status list

- [ ] Test down command
  ```bash
  make down
  ```
  Expected: All services stop gracefully

- [ ] Test up command again
  ```bash
  make up
  ```
  Expected: All services start again

## Cleanup and Reset Tests

### 14. Data Persistence Tests

- [ ] Stop services
  ```bash
  make down
  ```

- [ ] Start services again
  ```bash
  make up
  ```

- [ ] Verify database data persists
  ```bash
  docker compose exec postgres psql -U stockuser -d stockcontrol -c "SELECT COUNT(*) FROM alembic_version;"
  ```
  Expected: Migration data still exists

### 15. Full Cleanup Test

- [ ] Clean everything
  ```bash
  make clean
  # or
  docker compose down -v
  ```
  Expected: All containers, volumes, and networks removed

- [ ] Verify volumes are removed
  ```bash
  docker volume ls | grep stockcontrol
  ```
  Expected: No stockcontrol volumes

- [ ] Start fresh
  ```bash
  make up
  make migrate
  ```
  Expected: Fresh environment starts successfully

## Port Configuration Tests

### 16. Custom Port Tests

- [ ] Edit .env to use custom ports
  ```bash
  # Change ports in .env:
  # BACKEND_PORT=8001
  # FRONTEND_PORT=5174
  # NGINX_PORT=8080
  ```

- [ ] Restart services
  ```bash
  make down
  make up
  ```

- [ ] Test services on new ports
  ```bash
  curl http://localhost:8001/api/v1/health
  curl http://localhost:8080/api/v1/health
  ```
  Expected: Services accessible on custom ports

- [ ] Restore default ports
  ```bash
  git checkout .env
  make restart
  ```

## Performance Tests

### 17. Resource Usage

- [ ] Check container resource usage
  ```bash
  docker stats --no-stream
  ```
  Expected: Reasonable CPU and memory usage

- [ ] Check disk usage
  ```bash
  docker system df
  ```
  Expected: Reasonable disk usage

## Documentation Tests

### 18. Documentation Verification

- [ ] README.md has Docker section
  ```bash
  grep -A 5 "Docker" README.md
  ```
  Expected: Docker setup instructions present

- [ ] DOCKER.md exists and is comprehensive
  ```bash
  ls -la DOCKER.md
  wc -l DOCKER.md
  ```
  Expected: Comprehensive Docker guide exists

- [ ] Makefile has help text
  ```bash
  make help
  ```
  Expected: Clear command descriptions

## Final Validation

### 19. Complete Workflow Test

Execute the complete workflow as a new developer would:

- [ ] Clone repository
- [ ] Copy .env.example to .env
- [ ] Run `make up`
- [ ] Run `make migrate`
- [ ] Access frontend at http://localhost:5173
- [ ] Access backend docs at http://localhost:8000/api/v1/docs
- [ ] Access via nginx at http://localhost:80
- [ ] Make a code change and verify hot-reload
- [ ] Run `make test`
- [ ] Run `make down`

Expected: All steps complete successfully without errors

## Acceptance Criteria Validation

From Issue 1.6, verify:

- [x] `docker compose up` starts all services
- [x] Backend is accessible at http://localhost:8000
- [x] Frontend accessible at configured port (5173)
- [x] Hot-reloading works for backend and frontend
- [x] Comprehensive documentation provided
- [x] Makefile with convenient commands
- [x] `.env.example` created with all required variables

## Known Issues and Limitations

Document any issues found during testing:

1. **SSL Certificate Issues in CI/CD**: Building images in restricted CI environments may fail due to SSL cert verification. This is a CI environment limitation, not a Docker setup issue.

2. **Port Conflicts**: If ports 80, 5173, 8000, 5432, or 6379 are already in use, services won't start. Solution: Change ports in .env file.

3. **Volume Permissions**: On some systems, volume mount permissions may cause issues. Solution: Ensure Docker has proper permissions to mount host directories.

## Testing Sign-Off

Date: _______________
Tester: _______________
Result: [ ] PASS [ ] FAIL
Notes: _______________

---

**Last Updated**: November 2025
