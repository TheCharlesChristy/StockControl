# Stock Management & Location Tracking System

A comprehensive stock management system with location tracking, barcode scanning, and real-time inventory management capabilities.

## 🚀 Features

- **User Management**: Role-based access control (Admin, Warehouse Staff, Van Operator)
- **Stock Management**: Track items, locations, and inventory levels
- **Stock Movements**: Record and track item movements between locations
- **Stock Requests**: Van-to-warehouse stock request workflow
- **Barcode Integration**: QR code and barcode scanning for items and locations
- **Maps & Navigation**: Visual warehouse layout and location management
- **Notifications**: Real-time updates for stock requests and movements
- **Reporting**: Analytics and insights on inventory and operations

## 🏗️ Architecture

- **Backend**: FastAPI (Python 3.11+) with SQLAlchemy ORM
- **Frontend**: React 19 with TypeScript and TailwindCSS
- **Database**: PostgreSQL 15
- **Cache**: Redis 7
- **Authentication**: JWT-based authentication
- **Deployment**: Docker and Docker Compose

## 📋 Prerequisites

- Python 3.11 or higher
- Node.js 20 or higher
- Docker and Docker Compose
- Git

## 🔧 Quick Start

You can run the application using either Docker (recommended) or local setup.

### Option 1: Docker Setup (Recommended)

The easiest way to get started is using Docker Compose:

```bash
# Clone the repository
git clone https://github.com/TheCharlesChristy/StockControl.git
cd StockControl

# Copy environment file
cp .env.example .env

# Start all services
make up
```

That's it! The application will be available at:
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:8000
- **API Docs**: http://localhost:8000/api/v1/docs
- **Nginx (reverse proxy)**: http://localhost:80

#### Docker Commands

```bash
make up          # Start all services
make down        # Stop all services
make build       # Build/rebuild containers
make logs        # View logs from all services
make test        # Run backend tests
make migrate     # Run database migrations
make clean       # Remove all containers and volumes
make restart     # Restart all services
make ps          # Show running containers
make help        # Show all available commands
```

#### Hot-Reloading

Docker development environment includes hot-reloading for both backend and frontend:
- **Backend**: Uses `uvicorn --reload` to automatically restart on code changes
- **Frontend**: Uses Vite's HMR (Hot Module Replacement) for instant updates

### Option 2: Local Setup

If you prefer to run services locally without Docker:

### 1. Clone the Repository

```bash
git clone https://github.com/TheCharlesChristy/StockControl.git
cd StockControl
```

### 2. Start Database Services

```bash
docker compose up -d postgres redis
```

### 3. Backend Setup

```bash
cd backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Copy environment file
cp .env.example .env

# Run database migrations
alembic upgrade head

# Start the backend server
uvicorn app.main:app --reload
```

The API will be available at http://localhost:8000

API Documentation: http://localhost:8000/docs

### 4. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start the development server
npm run dev
```

The frontend will be available at http://localhost:5173

## 🧪 Testing

### Backend Tests

```bash
cd backend
source venv/bin/activate

# Run tests
pytest

# Run with coverage
pytest --cov=app --cov-report=term-missing

# Run linter
flake8 app tests
```

### Frontend Tests

```bash
cd frontend

# Run linter
npm run lint

# Type checking
npx tsc --noEmit

# Build
npm run build
```

### Testing with Docker

```bash
# Run backend tests in Docker
make test

# Run tests with coverage
docker compose exec backend pytest --cov=app --cov-report=term-missing

# Run backend linter
docker compose exec backend flake8 app tests

# Run frontend linter
docker compose exec frontend npm run lint
```

## 🐳 Docker Architecture

The Docker development environment consists of the following services:

### Services

1. **PostgreSQL** (`postgres:15`)
   - Database for persistent data storage
   - Port: 5432
   - Health checks enabled

2. **Redis** (`redis:7-alpine`)
   - Cache and session storage
   - Port: 6379
   - Persistence enabled with AOF (Append Only File)

3. **Backend** (FastAPI)
   - Python 3.11 application
   - Port: 8000
   - Hot-reloading with uvicorn
   - Volume mounted for live code updates

4. **Frontend** (React + Vite)
   - Node.js 20 application
   - Port: 5173
   - HMR (Hot Module Replacement) enabled
   - Volume mounted for live code updates

5. **Nginx** (Reverse Proxy)
   - Port: 80
   - Routes requests to backend API and frontend
   - WebSocket support for hot-reloading

### Network Architecture

```
Client → Nginx (port 80)
         ├─→ /api/* → Backend (port 8000) → PostgreSQL + Redis
         └─→ /* → Frontend (port 5173)
```

### Environment Configuration

Environment variables can be configured in `.env` file (copy from `.env.example`):

```bash
# Copy the example file
cp .env.example .env

# Edit the file with your settings
nano .env
```

Key environment variables:
- `POSTGRES_*`: Database credentials
- `BACKEND_PORT`: Backend service port (default: 8000)
- `FRONTEND_PORT`: Frontend service port (default: 5173)
- `NGINX_PORT`: Nginx reverse proxy port (default: 80)
- `SECRET_KEY`: JWT secret key (change in production!)
- `DEBUG`: Enable/disable debug mode

## 📚 Documentation

- [System Requirements Specification](docs/SystemRequirementsSpecification.md)
- [API Documentation](docs/openapi.yml)
- [Contributing Guidelines](CONTRIBUTING.md)
- [Project Roadmap](README_ROADMAP.md)
- [Implementation Guide](IMPLEMENTATION_GUIDE.md)

## 🔄 CI/CD Pipeline

This project uses GitHub Actions for continuous integration and deployment.

### Continuous Integration (CI)

The CI pipeline runs automatically on every pull request and includes:

- **Backend Linting**: Code style checking with flake8
- **Backend Tests**: Unit and integration tests with pytest
- **Test Coverage**: Coverage reports uploaded to Codecov
- **Frontend Linting**: Code style checking with ESLint
- **Frontend Type Checking**: TypeScript compilation checks
- **Frontend Build**: Production build verification
- **Docker Validation**: Docker Compose configuration validation

### Continuous Deployment (CD)

- **Staging**: Automatic deployment to staging on merge to `main`
- **Production**: Manual deployment to production on release tags (`v*`)

### Security Scanning

- **Dependency Review**: Automated dependency vulnerability checks on PRs
- **CodeQL Analysis**: Static code analysis for Python and JavaScript
- **Dependabot**: Automated dependency updates

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests and linters locally
5. Commit your changes (`git commit -m 'feat: add amazing feature'`)
6. Push to your branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Pull Request Requirements

- All CI checks must pass
- Code review approval required
- Test coverage maintained or improved
- Documentation updated if needed

## 📦 Project Structure

```
StockControl/
├── backend/              # FastAPI backend application
│   ├── app/             # Application code
│   │   ├── modules/     # Feature modules
│   │   ├── common/      # Shared utilities
│   │   └── main.py      # Application entry point
│   ├── alembic/         # Database migrations
│   ├── tests/           # Backend tests
│   └── requirements.txt # Python dependencies
├── frontend/            # React frontend application
│   ├── src/            # Source code
│   │   ├── components/ # React components
│   │   ├── pages/      # Page components
│   │   ├── services/   # API services
│   │   └── types/      # TypeScript types
│   └── package.json    # Node.js dependencies
├── docs/               # Documentation
├── .github/            # GitHub workflows and configurations
│   ├── workflows/      # CI/CD workflows
│   └── dependabot.yml  # Dependency update configuration
└── docker-compose.yml  # Docker services configuration
```

## 🔒 Security

- JWT-based authentication and authorization
- Role-based access control (RBAC)
- Password hashing with bcrypt
- SQL injection protection via SQLAlchemy ORM
- CORS configuration for API security
- Regular security scanning with CodeQL and Dependabot

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 👥 Team

- **Project Owner**: [TheCharlesChristy](https://github.com/TheCharlesChristy)

## 🙏 Acknowledgments

- FastAPI framework and community
- React and TypeScript communities
- All contributors and supporters

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/TheCharlesChristy/StockControl/issues)
- **Discussions**: [GitHub Discussions](https://github.com/TheCharlesChristy/StockControl/discussions)

---

**Status**: 🚧 In Development

**Last Updated**: November 2025
