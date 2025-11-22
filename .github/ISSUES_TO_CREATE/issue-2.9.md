## Issue 2.9: Build Login/Logout UI

### Context

Create user-facing login form and session management UI.

### Documentation References

- `/docs/SystemRequirementsSpecification.md` Section 4.1.1

### Implementation Steps

1. Create `frontend/src/components/auth/LoginForm.tsx`:
   - Username input
   - Password input (with show/hide toggle)
   - Remember me checkbox (optional)
   - Submit button
   - Loading state during authentication
   - Error display for failed login
   - Validation (required fields)
2. Create `frontend/src/pages/LoginPage.tsx`:
   - Center the LoginForm
   - Add branding/logo
   - Responsive layout
3. Create auth context `frontend/src/contexts/AuthContext.tsx`:
   - Store access token in memory
   - Store refresh token in httpOnly cookie or localStorage
   - Provide login(), logout(), isAuthenticated
   - Auto-refresh tokens before expiry
   - Redirect to login on 401 responses
4. Create `frontend/src/components/layout/Header.tsx`:
   - Display logged-in user name
   - Logout button
   - Navigation menu (permission-based)
5. Set up protected routes:
   - Redirect to /login if not authenticated
   - Redirect to / after successful login
6. Configure Axios interceptors:
   - Add Authorization header
   - Handle 401 with token refresh
   - Logout on refresh failure
7. Style with TailwindCSS
8. Add "forgot password" placeholder (implement later)

### Acceptance Criteria

- [ ] Login form validates input
- [ ] Successful login redirects to dashboard
- [ ] Failed login shows error message
- [ ] Token is stored securely
- [ ] Auth state persists across page reloads
- [ ] Logout clears tokens and redirects to login
- [ ] Protected routes require authentication
- [ ] Expired tokens are refreshed automatically
- [ ] UI is responsive and accessible

### Testing Methods

**Component Tests:**
```typescript
describe('LoginForm', () => {
  it('submits credentials', async () => {
    const { getByLabelText, getByText } = render(<LoginForm />);
    
    fireEvent.change(getByLabelText('Username'), {
      target: { value: 'testuser' }
    });
    fireEvent.change(getByLabelText('Password'), {
      target: { value: 'password123' }
    });
    fireEvent.click(getByText('Login'));
    
    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('testuser', 'password123');
    });
  });
});
```

**Manual Testing:**
- Navigate to /login
- Submit with invalid credentials -> see error
- Submit with valid credentials -> redirect to dashboard
- Logout -> redirect to login
- Refresh page while logged in -> remain authenticated

---
