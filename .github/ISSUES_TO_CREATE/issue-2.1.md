## Issue 2.1: Implement User Model and Database Schema

### Context

Create the User model with all required fields to support authentication, role assignment, and van assignments per the requirements.

### Documentation References

- `/docs/SystemRequirementsSpecification.md` Section 4.1.1-4.1.3: User requirements
- `/docs/openapi.yml`: User, UserCreate, UserUpdate schemas

### Implementation Steps

1. Create backend/app/modules/users/models.py:
   ```python
   class User(Base):
       __tablename__ = "users"
       
       id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
       username = Column(String, unique=True, nullable=False, index=True)
       display_name = Column(String, nullable=False)
       hashed_password = Column(String, nullable=False)
       active = Column(Boolean, default=True, nullable=False)
       created_at = Column(DateTime(timezone=True), server_default=func.now())
       updated_at = Column(DateTime(timezone=True), onupdate=func.now())
       
       # Relationships
       roles = relationship("UserRole", back_populates="user")
       assigned_vans = relationship("UserVan", back_populates="user")
   ```
2. Create UserRole association table for many-to-many relationship
3. Create UserVan association table for van assignments
4. Create Pydantic schemas in schemas.py:
   - UserBase
   - UserCreate (with password)
   - UserUpdate
   - UserResponse (without password)
5. Add password hashing utilities with bcrypt
6. Create Alembic migration for users table
7. Add indexes for performance:
   - username (unique)
   - active status
   - role lookups

### Acceptance Criteria

- [ ] User model matches OpenAPI User schema
- [ ] Password is hashed with bcrypt (never stored plain)
- [ ] Username is unique and indexed
- [ ] Relationships to roles and vans are defined
- [ ] Pydantic schemas validate data correctly
- [ ] Migration creates users table successfully
- [ ] Soft delete is supported via active field

### Testing Methods

**Unit Tests:**
```python
def test_user_creation():
    user = User(
        username="testuser",
        display_name="Test User",
        hashed_password=hash_password("password123")
    )
    db.add(user)
    db.commit()
    
    assert user.id is not None
    assert user.username == "testuser"
    assert user.active == True
    
def test_password_hashing():
    hashed = hash_password("secret")
    assert verify_password("secret", hashed) == True
    assert verify_password("wrong", hashed) == False
```

---
