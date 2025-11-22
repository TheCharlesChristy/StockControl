## Issue 3.3: Implement ItemSupplier Model and Schema

### Context

Create ItemSupplier model to track supplier information and ordering links for each item.

### Documentation References

- `/docs/SystemRequirementsSpecification.md` Section 4.2.1: Item Creation with supplier list
- `/docs/openapi.yml`: ItemSupplier, ItemSupplierCreate, ItemSupplierUpdate schemas

### Implementation Steps

1. Create ItemSupplier model in models.py:
   ```python
   class ItemSupplier(Base):
       __tablename__ = "item_suppliers"
       
       id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
       item_id = Column(UUID(as_uuid=True), ForeignKey("items.id"), nullable=False)
       supplier_name = Column(String, nullable=False)
       supplier_sku = Column(String)
       unit_cost = Column(Numeric(precision=10, scale=2))
       currency = Column(String(3), default="GBP")
       ordering_url = Column(String)
       lead_time_days = Column(Integer)
       minimum_order_quantity = Column(Numeric(precision=10, scale=2))
       is_preferred = Column(Boolean, default=False)
       active = Column(Boolean, default=True)
       notes = Column(Text)
       created_at = Column(DateTime(timezone=True), server_default=func.now())
       updated_at = Column(DateTime(timezone=True), onupdate=func.now())
       
       # Relationships
       item = relationship("Item", back_populates="suppliers")
   ```
2. Create Pydantic schemas:
   - ItemSupplierBase
   - ItemSupplierCreate
   - ItemSupplierUpdate
   - ItemSupplierResponse
3. Add indexes:
   - item_id (for lookup)
   - supplier_name (for search)
4. Create Alembic migration
5. Add business logic:
   - Only one preferred supplier per item
   - Cost and currency validation
6. Add supplier cost history tracking (optional extension)

### Acceptance Criteria

- [ ] ItemSupplier model has all required fields
- [ ] Cost is stored with appropriate precision
- [ ] Currency defaults to GBP
- [ ] Preferred supplier logic works correctly
- [ ] Pydantic schemas validate data
- [ ] Migration creates item_suppliers table
- [ ] Relationships work correctly
- [ ] Soft delete via active field

### Testing Methods

**Unit Tests:**
```python
def test_item_supplier_creation():
    item = create_test_item()
    supplier = ItemSupplier(
        item_id=item.id,
        supplier_name="Acme Corp",
        supplier_sku="AC-12345",
        unit_cost=Decimal("15.99"),
        is_preferred=True
    )
    db.add(supplier)
    db.commit()
    
    assert supplier.id is not None
    assert supplier.currency == "GBP"
    assert item.suppliers[0].supplier_name == "Acme Corp"

def test_preferred_supplier_logic():
    item = create_test_item()
    
    supplier1 = ItemSupplier(item_id=item.id, supplier_name="S1", is_preferred=True)
    db.add(supplier1)
    db.commit()
    
    supplier2 = ItemSupplier(item_id=item.id, supplier_name="S2", is_preferred=True)
    # Business logic should set supplier1.is_preferred = False
```

---
