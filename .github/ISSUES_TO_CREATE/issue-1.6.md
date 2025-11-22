## Issue 1.6: Create Docker Development Environment

### Context
Provide a complete containerized development environment for easy onboarding and consistent development setup.

### Implementation Steps
1. Create backend and frontend Dockerfiles
2. Update docker-compose.yml with backend, frontend, postgres, redis, nginx
3. Configure hot-reloading for development
4. Create `.env.example` and Makefile commands (up/down/test/migrate)

### Acceptance Criteria
- `docker-compose up` starts all services
- Backend is accessible at http://localhost:8000
- Frontend accessible at configured port
- Hot-reloading works

### Testing Methods
Manual: `docker-compose up` and verify services
