## Issue 2.4: Build Login and Token Refresh Endpoints

### Context

Create API endpoints for user login and token refresh according to the OpenAPI specification.

### Documentation References

- `/docs/openapi.yml`: /auth/login and /auth/refresh endpoints
- `/docs/SystemRequirementsSpecification.md` Section 4.1.1

### Implementation Steps

1. Create backend/app/modules/auth/router.py
2. Implement POST /api/v1/auth/login:
   ```python
   @router.post("/login", response_model=AuthTokenResponse)
   async def login(
       credentials: AuthLoginRequest,
       db: Session = Depends(get_db)
   ):
       # 1. Fetch user by username
       # 2. Verify password
       # 3. Check if user is active
       # 4. Generate access and refresh tokens
       # 5. Return tokens with expiry
   ```
3. Implement POST /api/v1/auth/refresh:
   ```python
   @router.post("/refresh", response_model=AuthTokenResponse)
   async def refresh(
       request: AuthRefreshRequest
   ):
       # 1. Verify refresh token
       # 2. Check token not blacklisted
       # 3. Generate new access token
       # 4. Optionally rotate refresh token
       # 5. Return new tokens
   ```
4. Implement POST /api/v1/auth/logout:
   - Add tokens to blacklist
   - Return success message
5. Add rate limiting to login endpoint (prevent brute force)
6. Add audit logging for auth events
7. Add comprehensive error handling:
   - Invalid credentials -> 401
   - Inactive user -> 403
   - Missing fields -> 422

### Acceptance Criteria

- [ ] Login returns access and refresh tokens for valid credentials
- [ ] Login returns 401 for invalid credentials
- [ ] Login returns 403 for inactive users
- [ ] Refresh returns new access token for valid refresh token
- [ ] Logout blacklists both tokens
- [ ] Rate limiting prevents brute force attacks
- [ ] All auth events are logged

### Testing Methods

**Integration Tests:**
```python
def test_login_success(client, test_user):
    response = client.post("/api/v1/auth/login", json={
        "username": "testuser",
        "password": "password123"
    })
    
    assert response.status_code == 200
    data = response.json()
    assert "accessToken" in data
    assert "refreshToken" in data
    assert data["expiresIn"] == 1800  # 30 minutes

def test_login_invalid_credentials(client):
    response = client.post("/api/v1/auth/login", json={
        "username": "testuser",
        "password": "wrongpassword"
    })
    
    assert response.status_code == 401
```

---
