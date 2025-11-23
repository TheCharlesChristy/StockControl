.PHONY: help up down build logs test migrate migrate-create migrate-up migrate-down migrate-history clean restart ps shell-backend shell-frontend

# Default target
help:
	@echo "Stock Control - Docker Development Environment"
	@echo ""
	@echo "Available commands:"
	@echo "  make up             - Start all services"
	@echo "  make down           - Stop all services"
	@echo "  make build          - Build/rebuild all containers"
	@echo "  make logs           - View logs from all services"
	@echo "  make test           - Run backend tests"
	@echo "  make migrate        - Run database migrations (alias for migrate-up)"
	@echo "  make migrate-create - Create a new migration (use: make migrate-create MSG=\"description\")"
	@echo "  make migrate-up     - Apply all pending migrations"
	@echo "  make migrate-down   - Rollback last migration"
	@echo "  make migrate-history - Show migration history"
	@echo "  make clean          - Remove all containers, volumes, and images"
	@echo "  make restart        - Restart all services"
	@echo "  make ps             - Show running containers"
	@echo "  make shell-backend  - Open shell in backend container"
	@echo "  make shell-frontend - Open shell in frontend container"

# Start all services
up:
	@echo "Starting all services..."
	docker compose up -d
	@echo ""
	@echo "Services started!"
	@echo "  - Backend API: http://localhost:8000"
	@echo "  - API Docs: http://localhost:8000/api/v1/docs"
	@echo "  - Frontend: http://localhost:5173"
	@echo "  - Nginx (reverse proxy): http://localhost:80"
	@echo ""
	@echo "Run 'make logs' to view logs"

# Stop all services
down:
	@echo "Stopping all services..."
	docker compose down
	@echo "Services stopped!"

# Build or rebuild containers
build:
	@echo "Building containers..."
	docker compose build
	@echo "Build complete!"

# View logs
logs:
	docker compose logs -f

# Run backend tests
test:
	@echo "Running backend tests..."
	docker compose exec backend pytest
	@echo ""
	@echo "Run 'docker compose exec backend pytest --cov=app' for coverage report"

# Run database migrations (alias for migrate-up)
migrate: migrate-up

# Create a new migration
migrate-create:
	@if [ -z "$(MSG)" ]; then \
		echo "Error: Please provide a migration message using MSG=\"description\""; \
		echo "Example: make migrate-create MSG=\"add user table\""; \
		exit 1; \
	fi
	@echo "Creating new migration: $(MSG)"
	docker compose exec backend alembic revision --autogenerate -m "$(MSG)"
	@echo "Migration created successfully!"
	@echo ""
	@echo "Review the generated migration file in backend/alembic/versions/"
	@echo "Then run 'make migrate-up' to apply it"

# Apply all pending migrations
migrate-up:
	@echo "Applying pending migrations..."
	docker compose exec backend alembic upgrade head
	@echo "Migrations applied successfully!"

# Rollback the last migration
migrate-down:
	@echo "Rolling back last migration..."
	docker compose exec backend alembic downgrade -1
	@echo "Migration rolled back successfully!"

# Show migration history
migrate-history:
	@echo "Migration history:"
	@echo ""
	docker compose exec backend alembic history --verbose

# Clean everything (containers, volumes, images)
clean:
	@echo "Cleaning up containers, volumes, and images..."
	docker compose down -v
	@echo "Cleaning up Docker images..."
	docker image prune -f
	@echo "Cleanup complete!"

# Restart all services
restart:
	@echo "Restarting all services..."
	docker compose restart
	@echo "Services restarted!"

# Show running containers
ps:
	docker compose ps

# Open shell in backend container
shell-backend:
	docker compose exec backend /bin/bash

# Open shell in frontend container
shell-frontend:
	docker compose exec frontend /bin/sh
