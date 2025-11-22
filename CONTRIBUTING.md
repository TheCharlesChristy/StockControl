# Contributing to Stock Management System

Thank you for your interest in contributing to the Stock Management System! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Pull Request Process](#pull-request-process)
- [CI/CD Pipeline](#cicd-pipeline)

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help others learn and grow
- Follow the project's technical standards

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 20+
- Docker and Docker Compose
- Git

### Initial Setup

1. **Fork and Clone**
   ```bash
   git clone https://github.com/YOUR_USERNAME/StockControl.git
   cd StockControl
   ```

2. **Backend Setup**
   ```bash
   cd backend
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

3. **Frontend Setup**
   ```bash
   cd frontend
   npm install
   ```

4. **Start Services**
   ```bash
   # From project root
   docker compose up -d postgres redis
   ```

5. **Run Migrations**
   ```bash
   cd backend
   alembic upgrade head
   ```

## Development Workflow

### Branch Naming Convention

- `feature/description` - New features
- `bugfix/description` - Bug fixes
- `hotfix/description` - Critical production fixes
- `refactor/description` - Code refactoring
- `docs/description` - Documentation updates

### Commit Message Format

Use clear, descriptive commit messages:

```
<type>: <short summary>

<optional detailed description>

<optional footer>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Examples:
```
feat: add user authentication endpoint
fix: resolve database connection timeout
docs: update API documentation for items endpoint
```

## Coding Standards

### Backend (Python)

- Follow PEP 8 style guide
- Use type hints for function parameters and return values
- Maximum line length: 120 characters
- Use docstrings for modules, classes, and functions
- Run linter before committing:
  ```bash
  cd backend
  flake8 app tests
  ```

**Example:**
```python
from typing import Optional
from pydantic import BaseModel

def get_user_by_id(user_id: int) -> Optional[dict]:
    """
    Retrieve a user by their ID.
    
    Args:
        user_id: The unique identifier of the user
        
    Returns:
        User data dictionary or None if not found
    """
    # Implementation
    pass
```

### Frontend (TypeScript/React)

- Use TypeScript for all new code
- Follow React best practices and hooks guidelines
- Use functional components
- Implement proper error boundaries
- Run linter before committing:
  ```bash
  cd frontend
  npm run lint
  ```

**Example:**
```typescript
interface UserProps {
  userId: number;
  onUpdate: (user: User) => void;
}

export const UserProfile: React.FC<UserProps> = ({ userId, onUpdate }) => {
  // Implementation
};
```

### Database

- Always create Alembic migrations for schema changes
- Never modify existing migrations
- Test migrations both up and down
- Include descriptive migration messages

```bash
# Create migration
alembic revision --autogenerate -m "add user profile fields"

# Apply migration
alembic upgrade head

# Rollback migration
alembic downgrade -1
```

## Testing Guidelines

### Backend Testing

- Write tests for all new features
- Maintain test coverage above 80%
- Use pytest fixtures for common setup
- Mock external dependencies

```bash
# Run tests
cd backend
pytest

# Run with coverage
pytest --cov=app --cov-report=term-missing
```

**Example test:**
```python
def test_create_user(client, db_session):
    """Test user creation endpoint."""
    response = client.post(
        "/api/v1/users",
        json={"email": "test@example.com", "password": "secure123"}
    )
    assert response.status_code == 201
    assert response.json()["email"] == "test@example.com"
```

### Frontend Testing

- Write tests for components and utilities
- Test user interactions and edge cases
- Ensure accessibility standards

```bash
# Run tests (when implemented)
cd frontend
npm test
```

### Manual Testing

Before submitting a PR, manually test:

1. Backend API endpoints using tools like curl or Postman
2. Frontend UI for responsive design and user experience
3. Integration between frontend and backend
4. Error handling and edge cases

## Pull Request Process

### Before Submitting

1. **Update your branch**
   ```bash
   git checkout main
   git pull upstream main
   git checkout your-branch
   git rebase main
   ```

2. **Run all checks locally**
   ```bash
   # Backend
   cd backend
   flake8 app tests
   pytest --cov=app
   
   # Frontend
   cd frontend
   npm run lint
   npm run build
   ```

3. **Update documentation** if needed

### Submitting a PR

1. Push your branch to your fork
2. Create a Pull Request on GitHub
3. Fill out the PR template completely
4. Link related issues
5. Request review from maintainers

### PR Requirements

- [ ] All CI checks pass
- [ ] Code review approved by at least one maintainer
- [ ] Test coverage maintained or improved
- [ ] Documentation updated
- [ ] No merge conflicts

## CI/CD Pipeline

### Continuous Integration (CI)

Our CI pipeline runs automatically on every PR and includes:

1. **Backend Linting** - Runs `flake8` to check code style
2. **Backend Tests** - Runs `pytest` with coverage reporting
3. **Frontend Linting** - Runs `eslint` to check code style
4. **Frontend Type Checking** - Runs TypeScript compiler
5. **Frontend Build** - Ensures the application builds successfully
6. **Docker Build** - Validates Docker Compose configuration
7. **Security Scanning** - Checks for vulnerabilities in dependencies

### Viewing CI Results

- Check the "Checks" tab on your PR
- Click on individual jobs to see detailed logs
- Fix any failures before requesting review

### Common CI Issues

**Linting Failures:**
```bash
# Run locally to reproduce
cd backend && flake8 app tests
cd frontend && npm run lint
```

**Test Failures:**
```bash
# Run locally to debug
cd backend && pytest -v
```

**Build Failures:**
```bash
# Check TypeScript compilation
cd frontend && npx tsc --noEmit
```

### Continuous Deployment (CD)

- **Staging**: Automatic deployment on merge to `main`
- **Production**: Manual deployment on release tags (`v*`)

## Getting Help

- **Issues**: Check existing issues or create a new one
- **Discussions**: Use GitHub Discussions for questions
- **Documentation**: Review `/docs` directory for specifications

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.

---

Thank you for contributing to the Stock Management System! 🎉
