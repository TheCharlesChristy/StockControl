## Issue 2.2: Implement Role and Permission Models

### Context

Create Role and Permission models to support the RBAC system with granular permissions as specified.

### Documentation References

- `/docs/SystemRequirementsSpecification.md` Section 4.1.2: Roles & Permissions
- `/docs/openapi.yml`: Role, Permission schemas

### Implementation Steps

1. Define all permissions as enums in models/permissions.py:
   ```python
   class Permission(str, Enum):
       VIEW_STOCK = "view_stock"
       EDIT_ITEMS = "edit_items"
       ADJUST_QUANTITIES = "adjust_quantities"
       MANAGE_USERS = "manage_users"
       MANAGE_ROLES = "manage_roles"
       MANAGE_LOCATIONS = "manage_locations"
       MANAGE_MAPS = "manage_maps"
       CREATE_MOVEMENTS = "create_movements"
       APPROVE_STOCK_REQUESTS = "approve_stock_requests"
       VIEW_COST_VALUES = "view_cost_values"
       # ... (add all from requirements)
   ```
2. Create Role model in models.py:
   ```python
   class Role(Base):
       __tablename__ = "roles"
       
       id = Column(UUID(as_uuid=True), primary_key=True)
       name = Column(String, unique=True, nullable=False)
       description = Column(String)
       is_system = Column(Boolean, default=False)  # Admin role
       created_at = Column(DateTime(timezone=True))
       
       permissions = relationship("RolePermission")
   ```
3. Create RolePermission association table
4. Create Pydantic schemas for Role
5. Create migration for roles and permissions tables
6. Create seed data for default roles:
   - Admin (all permissions)
   - Warehouse Manager
   - Engineer (van user)
   - Viewer (read-only)
7. Add permission checking utilities

### Acceptance Criteria

- [ ] All permissions from requirements are defined
- [ ] Role model supports multiple permissions
- [ ] System roles (like Admin) cannot be deleted
- [ ] Pydantic schemas validate role data
- [ ] Migration creates roles and permissions tables
- [ ] Seed data creates default roles
- [ ] Permission utilities enable easy checks

### Testing Methods

**Unit Tests:**
```python
def test_role_creation():
    role = Role(name="Test Role")
    role.permissions.append(
        RolePermission(permission=Permission.VIEW_STOCK)
    )
    db.add(role)
    db.commit()
    
    assert len(role.permissions) == 1
    assert role.permissions[0].permission == Permission.VIEW_STOCK

def test_admin_role_has_all_permissions():
    admin = db.query(Role).filter(Role.name == "Admin").first()
    all_perms = list(Permission)
    assert len(admin.permissions) == len(all_perms)
```

---
