import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './LoginPage.css';
import { Mail, Lock } from '../components/Icons';

export default function LoginPage({ setIsAuthenticated, setUser }) {
  const navigate = useNavigate();
  const [selectedRole, setSelectedRole] = useState('Secretary');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const handleRoleChange = (role) => {
    setSelectedRole(role);
  };

  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };

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

  const handleBackHome = () => {
    navigate('/');
  };

  return (
    <div className="login-container">
      {/* Animated Background Orbs */}
      <div className="login-orb login-orb-1"></div>
      <div className="login-orb login-orb-2"></div>
      <div className="login-orb login-orb-3"></div>

      {/* Back to Home Button */}
      <button className="login-back-link" onClick={handleBackHome}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M19 12H5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M12 19L5 12L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Back to Home
      </button>

      {/* Main Content */}
      <div className="login-wrapper">
        {/* Brand Section */}
        <div className="login-brand-section">
          <div className="login-brand-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 9L12 2L21 9V20C21 20.5304 20.7893 21.0391 20.4142 21.4142C20.0391 21.7893 19.5304 22 19 22H5C4.46957 22 3.96086 21.7893 3.58579 21.4142C3.21071 21.0391 3 20.5304 3 20V9Z" stroke="#1464a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M9 22V12H15V22" stroke="#1464a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 className="login-brand-name">PHILAM Village</h1>
          <div className="login-portal-label">PORTAL LOGIN</div>
          <p className="login-hint-text">Select your role and sign in to access your dashboard</p>
        </div>

        {/* Role Tab Switcher */}
        <div className="login-tabs-container">
          <button
            className={`login-tab ${selectedRole === 'Admin' ? 'active' : ''}`}
            onClick={() => handleRoleChange('Admin')}
          >
            <i className="ti ti-settings"></i>
            <span>Admin</span>
          </button>
          <button
            className={`login-tab ${selectedRole === 'Secretary' ? 'active' : ''}`}
            onClick={() => handleRoleChange('Secretary')}
          >
            <i className="ti ti-edit"></i>
            <span>Secretary</span>
          </button>
          <button
            className={`login-tab ${selectedRole === 'Treasurer' ? 'active' : ''}`}
            onClick={() => handleRoleChange('Treasurer')}
          >
            <i className="ti ti-wallet"></i>
            <span>Treasurer</span>
          </button>
        </div>

        {/* Login Card */}
        <form className="login-card" onSubmit={handleLogin}>
          {/* Email Field */}
          <div className="login-form-group">
            <label className="login-label">Email Address</label>
            <div className="login-input-wrapper">
              <span className="login-input-icon-mail" aria-hidden="true">
                <Mail size={18} />
              </span>
              <input
                type="email"
                className="login-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                required
              />
            </div>
          </div>

          {/* Password Field */}
          <div className="login-form-group">
            <label className="login-label">Password</label>
            <div className="login-input-wrapper">
              <span className="login-input-icon-lock" aria-hidden="true">
                <Lock size={18} />
              </span>
              <input
                type="password"
                className="login-input"
                id="pwfield"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
              />
            </div>
          </div>

          {/* Remember Me & Forgot Password */}
          <div className="login-remember-row">
            <label className="login-checkbox-label">
              <input
                type="checkbox"
                className="login-checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              <span>Remember me</span>
            </label>
            <a href="#" className="login-forgot-link" onClick={(e) => {
              e.preventDefault();
              navigate('/forgot-password');
            }}>
              Forgot password?
            </a>
          </div>

          {/* Submit Button */}
          <button type="submit" className="login-submit-btn" id="signinbtn">
            Sign In To {selectedRole} Portal
          </button>

          {/* Contact Hint */}
          <p className="login-contact-hint">
            Need access?{' '}
            <a href="#" className="login-contact-link" onClick={(e) => e.preventDefault()}>
              Contact the Admin
            </a>
          </p>
        </form>
      </div>
    </div>
  );
}
