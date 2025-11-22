## Issue 2.6: Create Role Management API Endpoints

### Context

Implement CRUD operations for role management with permission assignment.

### Documentation References

- `/docs/openapi.yml`: /roles/* endpoints
- `/docs/SystemRequirementsSpecification.md` Section 4.1.2

### Implementation Steps

1. Create backend/app/modules/roles/router.py
2. Implement GET /api/v1/roles (list all roles):
   - Requires "manage_roles" permission
   - Include permission count in response
3. Implement GET /api/v1/roles/{id} (get single role):
   - Requires "manage_roles" permission
   - Include full permission list
   - Return 404 if role not found
4. Implement POST /api/v1/roles (create role):
   - Requires "manage_roles" permission
   - Validate role name uniqueness
   - Validate all permissions exist
   - Cannot create system roles
5. Implement PATCH /api/v1/roles/{id} (update role):
   - Requires "manage_roles" permission
   - Cannot modify system roles (Admin)
   - Support adding/removing permissions
6. Implement DELETE /api/v1/roles/{id} (delete role):
   - Requires "manage_roles" permission
   - Cannot delete system roles
   - Check if role is assigned to users
   - Return error if role is in use
7. Implement GET /api/v1/permissions (list all permissions):
   - Requires authentication
   - Return permission key and description
8. Add audit logging for role changes

### Acceptance Criteria

- [ ] All endpoints match OpenAPI specification
- [ ] Only users with "manage_roles" permission can access
- [ ] System roles (Admin) cannot be modified or deleted
- [ ] Roles in use cannot be deleted
- [ ] Permission validation works correctly
- [ ] All role changes are audit logged
- [ ] Clear error messages for validation failures

### Testing Methods

**Integration Tests:**
```python
def test_create_role(client, admin_token):
    response = client.post(
        "/api/v1/roles",
        json={
            "name": "Warehouse Staff",
            "permissions": ["view_stock", "create_movements"]
        },
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Warehouse Staff"
    assert len(data["permissions"]) == 2

def test_cannot_delete_system_role(client, admin_token):
    admin_role = # ... fetch admin role
    response = client.delete(
        f"/api/v1/roles/{admin_role.id}",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    assert response.status_code == 403
```

---
