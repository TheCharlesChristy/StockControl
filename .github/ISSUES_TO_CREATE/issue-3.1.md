## Issue 3.1: Implement Item Model and Database Schema

### Context

Create the Item model with all required fields for comprehensive stock item tracking including multi-code support and supplier relationships.

### Documentation References

- `/docs/SystemRequirementsSpecification.md` Section 4.2: Items & Stock
- `/docs/openapi.yml`: Item, ItemCreate, ItemUpdate schemas

### Implementation Steps

1. Create `backend/app/modules/items/models.py`:
   ```python
   class Item(Base):
       __tablename__ = "items"
       
       id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
       name = Column(String, nullable=False, index=True)
       sku = Column(String, unique=True, nullable=False, index=True)
       description = Column(Text)
       category = Column(String, index=True)
       photo_url = Column(String)
       unit_type = Column(Enum('unit', 'meter', 'kg', 'litre', 'box', 'flexi'), nullable=False)
       minimum_level = Column(Numeric(precision=10, scale=2))
       length = Column(Numeric(precision=10, scale=2))
       width = Column(Numeric(precision=10, scale=2))
       height = Column(Numeric(precision=10, scale=2))
       weight = Column(Numeric(precision=10, scale=2))
       active = Column(Boolean, default=True, nullable=False)
       created_at = Column(DateTime(timezone=True), server_default=func.now())
       updated_at = Column(DateTime(timezone=True), onupdate=func.now())
       
       # Relationships
       codes = relationship("ItemCode", back_populates="item", cascade="all, delete-orphan")
       suppliers = relationship("ItemSupplier", back_populates="item", cascade="all, delete-orphan")
       movements = relationship("Movement", back_populates="item")
   ```
2. Create UnitType enum
3. Create Pydantic schemas:
   - ItemBase with all fields
   - ItemCreate (without id)
   - ItemUpdate (all fields optional)
   - ItemResponse (with timestamps)
   - DimensionsSchema (nested)
4. Add full-text search support for name and description
5. Create database indexes:
   - sku (unique)
   - name (for search)
   - category (for filtering)
   - active status
6. Create Alembic migration for items table
7. Add constraints:
   - Check minimum_level >= 0
   - Check dimensions > 0 if present

### Acceptance Criteria

- [ ] Item model matches OpenAPI Item schema exactly
- [ ] SKU is unique and indexed
- [ ] All unit types from requirements are supported
- [ ] Dimensions are optional
- [ ] Relationships to codes and suppliers are defined
- [ ] Pydantic schemas validate all fields correctly
- [ ] Migration creates items table with all constraints
- [ ] Soft delete is supported via active field
- [ ] Full-text search is configured

### Testing Methods

**Unit Tests:**
```python
def test_item_creation():
    item = Item(
        name="Test Widget",
        sku="WID-001",
        unit_type="unit",
        category="Widgets"
    )
    db.add(item)
    db.commit()
    
    assert item.id is not None
    assert item.active == True
    assert item.sku == "WID-001"

def test_sku_uniqueness():
    item1 = Item(name="Item 1", sku="DUP-001", unit_type="unit")
    db.add(item1)
    db.commit()
    
    item2 = Item(name="Item 2", sku="DUP-001", unit_type="unit")
    db.add(item2)
    
    with pytest.raises(IntegrityError):
        db.commit()
```

---
