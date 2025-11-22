## Issue 2.3: Create JWT Authentication System

### Context

Implement JWT-based authentication with access and refresh tokens for secure API access.

### Documentation References

- `/docs/SystemRequirementsSpecification.md` Section 4.1.1: Login requirements
- `/docs/openapi.yml`: AuthTokenResponse schema

### Implementation Steps

1. Install dependencies: `python-jose[cryptography]`
2. Create backend/app/modules/auth/jwt.py:
   - create_access_token(data, expires_delta)
   - create_refresh_token(data)
   - verify_token(token)
   - decode_token(token)
3. Configure JWT settings in config.py:
   - SECRET_KEY (from environment)
   - ALGORITHM = "HS256"
   - ACCESS_TOKEN_EXPIRE_MINUTES = 30
   - REFRESH_TOKEN_EXPIRE_DAYS = 7
4. Create TokenData Pydantic model
5. Create get_current_user dependency:
   ```python
   async def get_current_user(
       token: str = Depends(oauth2_scheme),
       db: Session = Depends(get_db)
   ) -> User:
       # Verify token, load user, check if active
   ```
6. Create get_current_active_user wrapper
7. Add token blacklist support using Redis
8. Create refresh token endpoint logic
9. Document authentication flow

### Acceptance Criteria

- [ ] Access tokens expire after 30 minutes
- [ ] Refresh tokens expire after 7 days
- [ ] Tokens contain user ID and username
- [ ] Invalid tokens return 401 Unauthorized
- [ ] Expired tokens can be refreshed
- [ ] Token blacklist prevents reuse after logout
- [ ] get_current_user dependency works correctly

### Testing Methods

**Unit Tests:**
```python
def test_create_and_verify_token():
    token_data = {"sub": str(user_id)}
    token = create_access_token(token_data)
    
    decoded = decode_token(token)
    assert decoded["sub"] == str(user_id)

def test_expired_token_rejected():
    token = create_access_token(
        {"sub": str(user_id)},
        expires_delta=timedelta(seconds=-1)
    )
    
    with pytest.raises(JWTError):
        decode_token(token)
```

---
