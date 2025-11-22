## Issue 2.5: Create User CRUD API Endpoints

### Context

Implement complete CRUD operations for user management with proper permission checking.

### Documentation References

- `/docs/openapi.yml`: /users/* endpoints
- `/docs/SystemRequirementsSpecification.md` Section 4.1

### Implementation Steps

1. Create backend/app/modules/users/router.py
2. Implement GET /api/v1/users (list users with pagination):
   - Requires "manage_users" permission
   - Support filtering by active status
   - Support search by username/display name
   - Return paginated results with metadata
3. Implement GET /api/v1/users/{id} (get single user):
   - Requires "manage_users" permission
   - Return 404 if user not found
   - Include assigned roles and vans
4. Implement POST /api/v1/users (create user):
   - Requires "manage_users" permission
   - Validate username uniqueness
   - Hash password before storing
   - Validate password complexity (configurable)
   - Assign default role if not specified
5. Implement PATCH /api/v1/users/{id} (update user):
   - Requires "manage_users" permission
   - Support partial updates
   - Re-hash password if changed
   - Cannot deactivate admin user
6. Implement DELETE /api/v1/users/{id} (soft delete):
   - Requires "manage_users" permission
   - Set active = False
   - Cannot delete admin user
7. Implement GET /api/v1/users/me (current user profile):
   - Requires valid authentication only
8. Add input validation for all endpoints
9. Add audit logging for all user changes

### Acceptance Criteria

- [ ] All endpoints match OpenAPI specification
- [ ] Only users with "manage_users" permission can access
- [ ] Username uniqueness is enforced
- [ ] Passwords are hashed and never returned
- [ ] Admin user cannot be deleted or deactivated
- [ ] Pagination works correctly
- [ ] All user changes are audit logged
- [ ] Input validation provides clear error messages

### Testing Methods

**Integration Tests:**
```python
def test_create_user(client, admin_token):
    response = client.post(
        "/api/v1/users",
        json={
            "username": "newuser",
            "password": "SecurePass123",
            "displayName": "New User",
            "roleIds": []
        },
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    assert response.status_code == 201
    data = response.json()
    assert data["username"] == "newuser"
    assert "password" not in data

def test_create_user_without_permission(client, user_token):
    response = client.post(
        "/api/v1/users",
        json={"username": "test", "password": "pass"},
        headers={"Authorization": f"Bearer {user_token}"}
    )
    
    assert response.status_code == 403
```

---
