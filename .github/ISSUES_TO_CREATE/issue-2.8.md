## Issue 2.8: Build User Management UI Components

### Context

Create React components for user list, creation, and editing in the admin interface.

### Documentation References

- `/docs/SystemRequirementsSpecification.md` Section 4.1

### Implementation Steps

1. Create `frontend/src/components/users/UserList.tsx`:
   - Display users in a table with columns: username, display name, roles, status, actions
   - Support pagination
   - Support filtering by active status
   - Support search by username/name
   - Add "Create User" button
2. Create `frontend/src/components/users/UserForm.tsx`:
   - Form for create/edit with fields:
     - Username (disabled when editing)
     - Display Name
     - Password (only for create, optional for edit)
     - Role selection (multi-select)
     - Van assignment (multi-select)
     - Active checkbox
   - Validation:
     - Required fields
     - Username format
     - Password complexity
   - Submit with React Query mutation
3. Create `frontend/src/components/users/UserDetail.tsx`:
   - Display full user information
   - Show assigned roles with permissions
   - Show assigned vans
   - Edit and delete buttons (with confirmation)
4. Create `frontend/src/pages/UsersPage.tsx`:
   - Layout with UserList
   - Modal for create/edit UserForm
5. Set up React Query hooks:
   - useUsers() for list
   - useUser(id) for details
   - useCreateUser()
   - useUpdateUser()
   - useDeleteUser()
6. Add permission-based UI visibility
7. Style with TailwindCSS
8. Add loading states and error handling

### Acceptance Criteria

- [ ] User list displays with pagination
- [ ] Search and filtering work correctly
- [ ] Create user form validates input
- [ ] Edit user form pre-fills current data
- [ ] Password field is optional for updates
- [ ] Delete requires confirmation
- [ ] Only users with permission see admin features
- [ ] Loading and error states are user-friendly
- [ ] UI is responsive on mobile and desktop

### Testing Methods

**Component Tests (Vitest + React Testing Library):**
```typescript
describe('UserList', () => {
  it('renders users', async () => {
    const { getByText } = render(<UserList />);
    await waitFor(() => {
      expect(getByText('testuser')).toBeInTheDocument();
    });
  });
  
  it('opens create modal', () => {
    const { getByText, getByRole } = render(<UserList />);
    fireEvent.click(getByText('Create User'));
    expect(getByRole('dialog')).toBeInTheDocument();
  });
});
```

**Manual Testing:**
- Navigate to /users
- Verify list loads
- Create a new user
- Edit an existing user
- Delete a user
- Test on mobile viewport

---
