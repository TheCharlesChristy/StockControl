## Issue 1.5: Set Up CI/CD Pipeline

### Context
Establish automated testing and deployment pipeline to ensure code quality and streamline releases.

### Implementation Steps
1. Create `.github/workflows/ci.yml` (run linters, tests, build)
2. Create `.github/workflows/cd.yml` (deploy to staging/production)
3. Configure coverage and security scanning
4. Create PR template

### Acceptance Criteria
- CI pipeline runs on every PR
- All tests must pass before merge
- Linters run automatically
- Coverage reports generated

### Testing Methods
Manual: Create a PR and verify CI runs
