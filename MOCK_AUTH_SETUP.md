# Mock Authentication System - Documentation

## Overview

A complete authentication system for the PHILAM Village HOA Management Portal with role-based access control. Currently uses mock authentication that accepts any credentials and routes users to role-specific dashboards.

---
http://localhost:5173


Enter credentials
The current mock auth accepts any email/password, but these example test credentials are typically used:

Admin
Email: admin@philamvillage.hoa
Password: admin123
Secretary
Email: secretary@philamvillage.hoa
Password: secretary123
Treasurer
Email: treasurer@philamvillage.hoa
Password: treasurer123

## Features

### Current Implementation (Mock)

1. **Role-Based Login**
   - Admin Portal
   - Treasurer Portal
   - Secretary Portal

2. **User Information Capture**
   - Email address
   - Selected role
   - Remember me checkbox

3. **Automatic Role Routing**
   - Successful login redirects to appropriate dashboard
   - Each role has unique interface and permissions

4. **Session Management**
   - User state stored in App component
   - Navigation protected with context
   - Auto-logout on browser close (mock)

---

## File Structure

### Authentication Files

**[LoginPage.jsx](client/src/pages/LoginPage.jsx)**
```
Main authentication component handling user login
- File: client/src/pages/LoginPage.jsx
- Lines: ~180

State Management:
  - selectedRole: Current role selection (Admin, Secretary, Treasurer)
  - email: Email input value
  - password: Password input value
  - showPassword: Password visibility toggle (currently unused - hidden field)
  - rememberMe: Checkbox state for remember me

Functions:
  - handleRoleChange(role): Updates role selection
  - handleLogin(e): Processes login and routes user
  - handleBackHome(): Navigation back to landing page
  - togglePasswordVisibility(): Eye icon toggle (unused)

Key Features:
  - SVG icons (mail, lock, home, back arrow)
  - Glassmorphism design matching landing page
  - Real-time role selection with dynamic button text
  - Email/password form with basic validation
  - Mock authentication (accepts any credentials)
  - Role-based navigation using useNavigate hook
```

**[LoginPage.css](client/src/pages/LoginPage.css)**
```
Styling for login pages
- File: client/src/pages/LoginPage.css
- Lines: ~600+

Components:
  - .login-container: Full-page wrapper with background
  - .login-orb: Animated background orbs (3 total)
  - .login-tabs-container: Role selection tabs
  - .login-card: Form card with glass effect
  - .login-input-wrapper: Input field container
  - .login-submit-btn: Submit button styling
  - Responsive breakpoints: 1024px, 768px, 480px
```

**[App.jsx](client/src/App.jsx)**
```
Main application router and state management
- File: client/src/App.jsx
- Lines: ~45

State Management:
  - isAuthenticated: Boolean for auth status
  - user: Object containing { email, role }
  - setIsAuthenticated: Function to update auth status
  - setUser: Function to update user object

Routes:
  - / : Landing page (public)
  - /login : Login page (public)
  - /forgot-password : Password reset (public)
  - /dashboard : Protected routes
  - /admin/dashboard : Admin dashboard
  - /treasurer/dashboard : Treasurer dashboard
  - /secretary/dashboard : Secretary dashboard
  - Plus other protected routes...

Auth Flow:
  1. User visits /login
  2. Selects role and enters email/password
  3. LoginPage calls setIsAuthenticated(true) and setUser({email, role})
  4. navigate() sends user to role-specific route
  5. Protected routes accessible after auth
```

**[Layout.jsx](client/src/components/Layout.jsx)**
```
Protected route wrapper component
- File: client/src/components/Layout.jsx

Props:
  - user: Current user object from App state

Features:
  - Wraps protected routes
  - Passes user info to child pages
  - Contains navbar and sidebar navigation
  - Logout functionality
```

---

## Authentication Flow

```
┌─────────────────────────────────────┐
│     Landing Page                    │
│  Click "ACCESS PORTAL" button       │
└─────────────────┬───────────────────┘
                  │
                  ▼
        ┌──────────────────────┐
        │   LOGIN PAGE         │
        │  /login              │
        ├──────────────────────┤
        │ 1. Select Role       │
        │    - Admin           │
        │    - Secretary       │
        │    - Treasurer       │
        └─────┬────────────────┘
              │
        2. Enter Email        
        3. Enter Password     
        4. (Optional) Remember Me
              │
              ▼
        ┌──────────────────────┐
        │ Click "Sign In To    │
        │ [Role] Portal"       │
        └─────┬────────────────┘
              │
    ┌─────────┴─────────────────────────┐
    │  handleLogin() called              │
    │  - Accept any credentials (mock)   │
    │  - Check selected role             │
    │  - Route based on role             │
    │  - Update App state:               │
    │    setIsAuthenticated(true)        │
    │    setUser({email, role})          │
    └─────────┬─────────────────────────┘
              │
    ┌─────────┴──────────────────────────┐
    │                                    │
  Admin?                             Secretary?
    │                                    │
    ▼                                    ▼
┌──────────────────┐        ┌──────────────────┐
│ /admin/dashboard │        │/secretary/       │
│ AdminDashboard   │        │dashboard         │
│ Component        │        │SecretaryDashboard│
└──────────────────┘        └──────────────────┘
              │                         │
              └────────────┬────────────┘
                           │
                    Treasurer?
                           │
                           ▼
                    ┌──────────────────┐
                    │/treasurer/       │
                    │dashboard         │
                    │TreasurerDashboard│
                    └──────────────────┘
```

---

## Current Mock Implementation

### LoginPage.jsx - handleLogin()

```javascript
const handleLogin = (e) => {
  e.preventDefault();
  
  // Mock authentication - accept any credentials
  setIsAuthenticated(true);
  setUser({
    email,
    role: selectedRole.toLowerCase(),
  });

  // Route based on selected role
  const roleRoutes = {
    admin: '/admin/dashboard',
    treasurer: '/treasurer/dashboard',
    secretary: '/secretary/dashboard',
  };

  navigate(roleRoutes[selectedRole.toLowerCase()]);
};
```

**Current Behavior:**
- ✅ Accepts any email format
- ✅ Accepts any password
- ✅ No password validation
- ✅ No API calls
- ✅ Instant login (no loading)
- ✅ Routes immediately to dashboard

**Mock Limitations:**
- ❌ No actual user verification
- ❌ No password requirements
- ❌ No account lockout
- ❌ No failed login tracking
- ❌ No token/session generation
- ❌ User data lost on refresh
- ❌ No logout functionality
- ❌ Not secure for production

---

## Design System

### Colors
- **Primary Blue**: #1464a0 (brand color, buttons)
- **Baby Blue**: #b3d4ed, #a5ccea, #c2dff4 (backgrounds)
- **Dark Navy**: #071e30 (text)
- **Muted Tones**: #2a5470, #3a5a72 (secondary text)
- **Glass White**: rgba(255,255,255,0.32-0.82) (cards)

### Typography
- **Headings**: Cormorant Garamond, 28px, weight 600
- **Labels**: DM Sans, 12px, weight 600, uppercase
- **Body**: DM Sans, 13px, weight 400
- **Buttons**: DM Sans, 13px, weight 600

### Glass Effects
- **Background**: radial gradients with fixed positioning
- **Form Card**: rgba(255,255,255,0.32) blur(28px) saturate(160%)
- **Inputs**: rgba(255,255,255,0.60) focus state 0.82
- **Buttons**: rgba(20,100,160,0.82) primary action

### Animations
- **Fade Up**: 0.8s ease-out
- **Orb Drift**: 3 animated orbs (16s-22s infinite)
- **Button Hover**: 0.25s transition

---

## User Information Structure

```javascript
// User object stored in App state
{
  email: "officer@philamvillage.hoa",        // String: email input
  role: "secretary"                          // String: lowercase role
}

// Available roles:
- "admin"      → /admin/dashboard
- "secretary"  → /secretary/dashboard
- "treasurer"  → /treasurer/dashboard
```

---

## Mock Test Credentials

### Important Note
The current mock authentication **accepts ANY email and password combination**. These are suggested test credentials for consistency during development.

### Admin Account
```
Email:    admin@philamvillage.hoa
Password: admin123
Role:     Admin
Dashboard: /admin/dashboard
```

### Treasurer Account
```
Email:    treasurer@philamvillage.hoa
Password: treasurer123
Role:     Treasurer
Dashboard: /treasurer/dashboard
```

### Secretary Account
```
Email:    secretary@philamvillage.hoa
Password: secretary123
Role:     Secretary
Dashboard: /secretary/dashboard
```

### Alternative Test Credentials

You can also use any of these combinations (mock accepts anything):

```
Email:    john.doe@philamvillage.hoa
Password: test123

Email:    maria@example.com
Password: password456

Email:    test@test.com
Password: anything
```

### How to Test Each Role

1. **Test as Admin:**
   - Go to `/login`
   - Click "Admin" tab
   - Enter: `admin@philamvillage.hoa` / `admin123` (or any credentials)
   - Click "Sign In To Admin Portal"
   - Should navigate to `/admin/dashboard`

2. **Test as Secretary:**
   - Go to `/login`
   - Click "Secretary" tab (default selected)
   - Enter: `secretary@philamvillage.hoa` / `secretary123` (or any credentials)
   - Click "Sign In To Secretary Portal"
   - Should navigate to `/secretary/dashboard`

3. **Test as Treasurer:**
   - Go to `/login`
   - Click "Treasurer" tab
   - Enter: `treasurer@philamvillage.hoa` / `treasurer123` (or any credentials)
   - Click "Sign In To Treasurer Portal"
   - Should navigate to `/treasurer/dashboard`

### Email Addresses for Reference

| Role | Email | Department |
|------|-------|------------|
| Admin | `admin@philamvillage.hoa` | System Administrator |
| Treasurer | `treasurer@philamvillage.hoa` | Finance Department |
| Secretary | `secretary@philamvillage.hoa` | Records Department |
| Homeowner (Optional) | `homeowner@philamvillage.hoa` | Resident Account |

### Testing Checklist

- [ ] Admin credentials work and route to `/admin/dashboard`
- [ ] Secretary credentials work and route to `/secretary/dashboard`
- [ ] Treasurer credentials work and route to `/treasurer/dashboard`
- [ ] Email field accepts any format (mock)
- [ ] Password field accepts any value (mock)
- [ ] Switching roles updates button text dynamically
- [ ] User info displays correctly in dashboard
- [ ] Each dashboard shows role-appropriate content

---

## Integration Guide

### Step 1: Backend API Setup

Create authentication endpoints on your backend:

```
POST /api/auth/login
POST /api/auth/logout
POST /api/auth/verify-token
POST /api/auth/refresh-token
```

### Step 2: Add Real Authentication

Update `handleLogin()` in LoginPage.jsx:

```javascript
const handleLogin = async (e) => {
  e.preventDefault();
  
  // Add loading state
  setLoading(true);
  
  try {
    // Call backend API
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        role: selectedRole.toLowerCase()
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // Store token (in localStorage or sessionStorage)
      localStorage.setItem('authToken', data.token);
      
      // Update app state
      setIsAuthenticated(true);
      setUser({
        email: data.user.email,
        role: data.user.role,
        userId: data.user.id,
        // Add other user fields
      });
      
      // Navigate to dashboard
      navigate(`/${data.user.role}/dashboard`);
    } else {
      // Handle login error
      setError(data.message || 'Login failed');
    }
  } catch (error) {
    setError('Network error. Please try again.');
  } finally {
    setLoading(false);
  }
};
```

### Step 3: Add Token Management

Create authentication service:

```javascript
// services/auth.js
export const authService = {
  // Store token
  setToken: (token) => {
    localStorage.setItem('authToken', token);
  },

  // Get token
  getToken: () => {
    return localStorage.getItem('authToken');
  },

  // Check if authenticated
  isAuthenticated: () => {
    return !!localStorage.getItem('authToken');
  },

  // Clear authentication
  logout: () => {
    localStorage.removeItem('authToken');
  },

  // Verify token validity
  verifyToken: async (token) => {
    const response = await fetch('/api/auth/verify-token', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.ok;
  }
};
```

### Step 4: Add Password Validation

Add to LoginPage.jsx before handleLogin():

```javascript
const validateForm = () => {
  if (!email) {
    setError('Email is required');
    return false;
  }
  
  if (!password) {
    setError('Password is required');
    return false;
  }
  
  if (password.length < 8) {
    setError('Password must be at least 8 characters');
    return false;
  }
  
  // Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    setError('Please enter a valid email address');
    return false;
  }
  
  return true;
};

// Call before making API request
if (!validateForm()) return;
```

### Step 5: Add Protected Routes

```javascript
// utils/ProtectedRoute.jsx
import { Navigate } from 'react-router-dom';

export function ProtectedRoute({ isAuthenticated, children }) {
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

// In App.jsx
import { ProtectedRoute } from './utils/ProtectedRoute';

<Route 
  path="/admin/dashboard" 
  element={
    <ProtectedRoute isAuthenticated={isAuthenticated}>
      <AdminDashboard />
    </ProtectedRoute>
  } 
/>
```

---

## Mock vs. Real Authentication Comparison

| Feature | Mock | Real |
|---------|------|------|
| Email Validation | ❌ None | ✅ Format + existence |
| Password Validation | ❌ None | ✅ Strength required |
| Account Lockout | ❌ No | ✅ After N attempts |
| Token Generation | ❌ No | ✅ JWT or session |
| Token Expiration | ❌ No | ✅ 1-24 hours |
| Refresh Tokens | ❌ No | ✅ RenewToken endpoint |
| Database Check | ❌ No | ✅ User lookup |
| Password Hashing | ❌ No | ✅ bcrypt/scrypt |
| Session Storage | ❌ Memory | ✅ Server-side |
| HTTPS Required | ❌ No | ✅ Yes |
| 2FA Support | ❌ No | ✅ TOTP/SMS |
| Audit Logging | ❌ No | ✅ All attempts |
| Logout | ❌ No | ✅ Token invalidation |

---

## Security Considerations

### Current Mock Implementation
- **Not Secure**: Accepts any credentials
- **Development Only**: Should not be used in production
- **No Persistence**: User data lost on browser refresh
- **No Validation**: No email or password checks

### Production Requirements

1. **Password Security**
   - Minimum 8 characters
   - Require uppercase + lowercase + numbers
   - Consider special characters (!@#$%^&*)
   - Hash passwords with bcrypt/scrypt (not plaintext)
   - Never transmit passwords in plain text

2. **Session Management**
   - Use secure HTTP-only cookies
   - Set SameSite=Strict attribute
   - Implement CSRF token protection
   - Short session timeouts (15-30 min)
   - Refresh token rotation

3. **API Security**
   - Use HTTPS/TLS for all requests
   - Implement rate limiting (5 attempts, 15-min lockout)
   - Add CAPTCHA after 3 failed attempts
   - Validate all server-side (never trust client)
   - Use parameterized queries (prevent SQL injection)

4. **Authentication Flow**
   - Implement email verification for new accounts
   - Require password reset on first login
   - Add account recovery options
   - Implement 2FA/MFA (especially for Admin role)
   - Log all authentication attempts

5. **Token Security**
   - Use JWT tokens with expiration
   - Sign tokens with strong secret
   - Store in secure, HTTP-only cookies
   - Implement token refresh mechanism
   - Revoke tokens on logout

6. **User Data Protection**
   - Encrypt sensitive data at rest
   - Don't log passwords or tokens
   - Implement data retention policies
   - Add user consent for data collection
   - GDPR/privacy compliance

---

## Testing Checklist

### Functional Testing
- [ ] Login page loads with all 3 role tabs
- [ ] Selecting different roles updates button text
- [ ] Email input accepts valid email formats
- [ ] Password input accepts any password
- [ ] "Remember me" checkbox toggles
- [ ] Clicking "Sign In" button submits form
- [ ] User redirected to correct dashboard by role
- [ ] User info displays in dashboard
- [ ] Going back to login shows form cleared
- [ ] Browser back button works correctly

### Role-Based Testing
- [ ] Admin role routes to /admin/dashboard
- [ ] Secretary role routes to /secretary/dashboard
- [ ] Treasurer role routes to /treasurer/dashboard
- [ ] Each dashboard shows correct role-specific content
- [ ] Navigation sidebar shows role-appropriate menu items

### Session Testing (After Real Auth)
- [ ] User stays logged in on page refresh ✅
- [ ] User redirected to login if unauthenticated
- [ ] Logout clears user session
- [ ] Token expires after timeout
- [ ] Refresh token extends session
- [ ] Back button after logout goes to login

### Responsive Testing
- [ ] Desktop (1024px+): All elements visible
- [ ] Tablet (768px): Layout adjusts properly
- [ ] Mobile (480px): Form stacks vertically
- [ ] Touch targets are at least 44x44px
- [ ] Text remains readable at all sizes

### Browser Testing
- [ ] Chrome/Chromium ✅
- [ ] Firefox ✅
- [ ] Safari
- [ ] Edge
- [ ] Mobile browsers (iOS Safari, Android Chrome)

---

## Backend API Examples

### Login Endpoint

```
POST /api/auth/login
Content-Type: application/json

Request:
{
  "email": "officer@philamvillage.hoa",
  "password": "SecurePass123!",
  "role": "secretary"
}

Response (Success):
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "613a2c4e5f8b9d2a1e5c3f8b",
    "email": "officer@philamvillage.hoa",
    "role": "secretary",
    "firstName": "John",
    "lastName": "Doe",
    "permissions": ["view_payments", "create_reports", ...]
  },
  "expiresIn": 3600
}

Response (Failure):
{
  "success": false,
  "message": "Invalid credentials",
  "code": "INVALID_LOGIN"
}
```

### Verify Token Endpoint

```
GET /api/auth/verify-token
Authorization: Bearer {token}

Response (Valid):
{
  "valid": true,
  "user": {
    "id": "613a2c4e5f8b9d2a1e5c3f8b",
    "email": "officer@philamvillage.hoa",
    "role": "secretary"
  }
}

Response (Invalid):
{
  "valid": false,
  "message": "Token expired"
}
```

### Logout Endpoint

```
POST /api/auth/logout
Authorization: Bearer {token}

Response:
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

## File Locations

```
PHILAMLIFE/
├── client/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── LoginPage.jsx               ← Authentication
│   │   │   └── LoginPage.css               ← Styling
│   │   ├── components/
│   │   │   ├── Layout.jsx                  ← Protected wrapper
│   │   │   └── ...
│   │   ├── services/
│   │   │   ├── api.js                      ← API calls (mock)
│   │   │   └── auth.js (to create)         ← Auth service
│   │   ├── utils/
│   │   │   └── ProtectedRoute.jsx (to create)
│   │   ├── App.jsx                         ← Main router
│   │   └── ...
│   └── ...
├── server/
│   ├── routes/
│   │   └── auth.js (to create)             ← Auth endpoints
│   ├── middleware/
│   │   └── authMiddleware.js (to create)   ← Auth validation
│   └── ...
└── MOCK_AUTH_SETUP.md                      ← This file
```

---

## Role Definitions

### Admin
- Dashboard: `/admin/dashboard`
- Access: Full system access
- Features: All reports, user management, system settings
- Component: [AdminDashboard.jsx](client/src/pages/AdminDashboard.jsx)

### Secretary
- Dashboard: `/secretary/dashboard`
- Access: Records and communications
- Features: Homeowner records, announcements, documents
- Component: [SecretaryDashboard.jsx](client/src/pages/SecretaryDashboard.jsx)

### Treasurer
- Dashboard: `/treasurer/dashboard`
- Access: Financial and payments
- Features: Accounting, payment processing, financial reports
- Component: [TreasurerDashboard.jsx](client/src/pages/TreasurerDashboard.jsx)

---

## Common Issues & Solutions

### Issue: User data lost on page refresh
**Cause**: Mock implementation stores user in React state only  
**Solution**: Implement tokens and persist state in localStorage/sessionStorage

### Issue: Can login with empty email/password
**Cause**: Mock authentication has no validation  
**Solution**: Add client-side validation + server-side verification

### Issue: No logout functionality
**Cause**: Mock implementation has no session management  
**Solution**: Implement logout endpoint that invalidates token

### Issue: Can access other role dashboards
**Cause**: No role-based access control  
**Solution**: Add ProtectedRoute wrapper checking user role

### Issue: Login state persists across browsers
**Cause**: localStorage/sessionStorage not implemented  
**Solution**: Use secure HTTP-only cookies for tokens

---

## Stats

| Metric | Value |
|--------|-------|
| Login Component Lines | ~180 |
| CSS Lines | ~600 |
| Supported Roles | 3 |
| Max Password Attempts | Unlimited (mock) |
| Session Timeout | None (mock) |
| Token Expiration | None (mock) |
| Responsive Breakpoints | 3 |
| Animation Orbs | 3 |

---

## Next Steps

1. ✅ Current: Basic login form with mock authentication
2. **Next**: Add backend API integration
3. **Then**: Implement real token-based auth
4. **After**: Add server-side session validation
5. **Finally**: Implement 2FA for Admin role

---

## Technology Stack

- **Frontend Framework**: React 18
- **Routing**: React Router v6
- **State Management**: React Hooks (useState)
- **Styling**: CSS3 with glassmorphism effects
- **Backend**: (To be configured - Node.js, Python, etc.)
- **Authentication**: (To be configured - JWT, OAuth, etc.)
- **Database**: (To be configured - MongoDB, PostgreSQL, etc.)

---

## Compliance & Security Standards

- OWASP Top 10
- GDPR (if applicable)
- CCPA (if applicable)
- PCI DSS (if handling payments)
- SOC 2 (if required)

---

**Last Updated**: June 1, 2026  
**Version**: 1.0  
**Status**: Mock Implementation - Development Only  
**Security Level**: NOT PRODUCTION READY
