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
