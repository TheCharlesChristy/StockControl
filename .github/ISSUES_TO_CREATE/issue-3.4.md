## Issue 3.4: Create Item CRUD API Endpoints

### Context

Implement complete CRUD operations for items with proper permission checking and validation.

### Documentation References

- `/docs/openapi.yml`: /items/* endpoints
- `/docs/SystemRequirementsSpecification.md` Section 4.2.1

### Implementation Steps

1. Create `backend/app/modules/items/router.py`
2. Implement GET /api/v1/items (list items with pagination):
   - Requires "view_stock" permission
   - Support pagination (limit, offset)
   - Support filtering:
     - category
     - unit_type
     - active status
     - minimum_level threshold
   - Support search (name, SKU, description)
   - Support sorting (name, sku, category, created_at)
   - Return with pagination metadata
3. Implement GET /api/v1/items/{id} (get single item):
   - Requires "view_stock" permission
   - Include all item details
   - Include codes and suppliers
   - Include current stock summary
   - Return 404 if not found
4. Implement POST /api/v1/items (create item):
   - Requires "edit_items" permission
   - Validate SKU uniqueness
   - Validate required fields
   - Validate unit_type enum
   - Return created item with 201 status
5. Implement PATCH /api/v1/items/{id} (update item):
   - Requires "edit_items" permission
   - Support partial updates
   - Validate SKU uniqueness if changed
   - Cannot modify if item has movements (optional constraint)
6. Implement DELETE /api/v1/items/{id} (soft delete):
   - Requires "edit_items" permission
   - Set active = False
   - Return 204 No Content
7. Add comprehensive input validation
8. Add audit logging for all item changes
9. Implement caching for frequently accessed items

### Acceptance Criteria

- [ ] All endpoints match OpenAPI specification
- [ ] Permission checking works correctly
- [ ] SKU uniqueness is enforced
- [ ] Pagination works correctly
- [ ] Search and filtering return correct results
- [ ] Validation provides clear error messages
- [ ] All item changes are audit logged
- [ ] Soft delete preserves data
- [ ] Caching improves performance

### Testing Methods

**Integration Tests:**
```python
def test_create_item(client, auth_token):
    response = client.post(
        "/api/v1/items",
        json={
            "name": "Widget Pro",
            "sku": "WP-001",
            "unitType": "unit",
            "category": "Widgets",
            "minimumLevel": 10
        },
        headers={"Authorization": f"Bearer {auth_token}"}
    )
    
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Widget Pro"
    assert data["sku"] == "WP-001"
    assert "id" in data

def test_list_items_with_filter(client, auth_token):
    response = client.get(
        "/api/v1/items?category=Widgets&limit=10",
        headers={"Authorization": f"Bearer {auth_token}"}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert "meta" in data
    assert all(item["category"] == "Widgets" for item in data["items"])
```

---

Due to character limits, I'll create this comprehensive issues document that continues with all remaining issues. Let me create the full document now:

<function_calls>
<invoke name="bash">
<parameter name="command">wc -c /home/runner/work/StockControl/StockControl/ISSUES.md
