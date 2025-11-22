## Issue 3.2: Implement ItemCode Model (Barcodes and QR Codes)

### Context

Create ItemCode model to support multiple barcodes and QR codes per item for flexible identification.

### Documentation References

- `/docs/SystemRequirementsSpecification.md` Section 4.2.2: Multi-Code Identification
- `/docs/openapi.yml`: ItemCode, ItemCodeCreate schemas

### Implementation Steps

1. Create ItemCode model in models.py:
   ```python
   class ItemCode(Base):
       __tablename__ = "item_codes"
       
       id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
       item_id = Column(UUID(as_uuid=True), ForeignKey("items.id"), nullable=False)
       code = Column(String, nullable=False, index=True)
       code_type = Column(Enum('barcode', 'qr'), nullable=False)
       is_primary = Column(Boolean, default=False)
       created_at = Column(DateTime(timezone=True), server_default=func.now())
       
       # Relationships
       item = relationship("Item", back_populates="codes")
       
       __table_args__ = (
           UniqueConstraint('code', 'code_type', name='unique_code_type'),
           Index('idx_code_lookup', 'code', 'code_type'),
       )
   ```
2. Create CodeType enum ('barcode', 'qr')
3. Create Pydantic schemas:
   - ItemCodeBase
   - ItemCodeCreate
   - ItemCodeResponse
4. Add code validation:
   - Barcode format validation (UPC, EAN, Code128, etc.)
   - QR code format validation
5. Create unique constraint: (code, code_type) must be unique
6. Create fast lookup index for scanning
7. Create Alembic migration
8. Add business logic:
   - Only one primary code per item per type
   - Auto-set first code as primary

### Acceptance Criteria

- [ ] ItemCode model supports barcodes and QR codes
- [ ] Code + type combination is unique
- [ ] Fast lookup by code is possible
- [ ] Primary code logic works correctly
- [ ] Pydantic schemas validate code format
- [ ] Migration creates item_codes table
- [ ] Relationships to Item work correctly

### Testing Methods

**Unit Tests:**
```python
def test_item_code_creation():
    item = create_test_item()
    code = ItemCode(
        item_id=item.id,
        code="1234567890128",
        code_type="barcode",
        is_primary=True
    )
    db.add(code)
    db.commit()
    
    assert code.id is not None
    assert code.item.name == item.name

def test_code_uniqueness():
    item = create_test_item()
    code1 = ItemCode(item_id=item.id, code="12345", code_type="barcode")
    db.add(code1)
    db.commit()
    
    code2 = ItemCode(item_id=item.id, code="12345", code_type="barcode")
    db.add(code2)
    
    with pytest.raises(IntegrityError):
        db.commit()
```

---
