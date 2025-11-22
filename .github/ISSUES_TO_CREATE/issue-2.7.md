## Issue 2.7: Implement Permission Checking Middleware

### Context

Create reusable permission checking decorators and dependencies to enforce RBAC across all endpoints.

### Documentation References

- `/docs/SystemRequirementsSpecification.md` Section 4.1.2: Permission enforcement

### Implementation Steps

1. Create backend/app/common/permissions.py
2. Implement permission checker dependency:
   ```python
   def require_permission(permission: Permission):
       async def permission_checker(
           current_user: User = Depends(get_current_user)
       ):
           if not has_permission(current_user, permission):
               raise HTTPException(
                   status_code=403,
                   detail="Insufficient permissions"
               )
           return current_user
       return permission_checker
   ```
3. Implement has_permission utility:
   ```python
   def has_permission(user: User, permission: Permission) -> bool:
       # Admin always has all permissions
       # Check user's roles for the permission
       # Support permission overrides per user
   ```
4. Implement require_any_permission (OR logic)
5. Implement require_all_permissions (AND logic)
6. Create permission caching (Redis) to avoid repeated DB queries
7. Add permission checking to all protected endpoints
8. Document permission requirements in API documentation
9. Create permission testing utilities

### Acceptance Criteria

- [ ] require_permission dependency works correctly
- [ ] Admin users always pass permission checks
- [ ] Users without permission get 403 Forbidden
- [ ] Permission checks are cached for performance
- [ ] Multiple permission requirements (AND/OR) are supported
- [ ] All protected endpoints use permission checks
- [ ] Permission requirements are documented

### Testing Methods

**Unit Tests:**
```python
def test_admin_has_all_permissions():
    admin = User(...)  # Admin user
    for perm in Permission:
        assert has_permission(admin, perm) == True

def test_user_permission_check():
    user = User(...)  # User with VIEW_STOCK only
    assert has_permission(user, Permission.VIEW_STOCK) == True
    assert has_permission(user, Permission.MANAGE_USERS) == False

@pytest.mark.asyncio
async def test_permission_middleware():
    checker = require_permission(Permission.MANAGE_USERS)
    
    with pytest.raises(HTTPException) as exc:
        await checker(current_user=regular_user)
    
    assert exc.value.status_code == 403
```

---
