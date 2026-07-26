import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOrganization } from '../context/OrganizationContext';
import { supabase } from '../lib/supabaseClient';
import './ForgotPasswordPage.css';

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { organization } = useOrganization();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSendResetLink = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    setLoading(true);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo: `${window.location.origin}/reset-password` },
    );

    setLoading(false);

    // Always show the same success message regardless of whether the
    // email exists in the system. This prevents attackers from using this
    // form to discover which email addresses have accounts (account
    // enumeration), while still working correctly for real users.
    if (resetError) {
      console.error('Password reset request failed:', resetError.message);
    }

    setSubmitted(true);
    setMessage(
      `If an account exists for ${email.trim()}, a password reset link has been sent. Please check your inbox (and spam folder).`,
    );
  };

  const handleBackToLogin = () => {
    navigate('/login');
  };

  return (
    <div className="forgot-container">
      {/* Animated Background Orbs */}
      <div className="forgot-orb forgot-orb-1"></div>
      <div className="forgot-orb forgot-orb-2"></div>
      <div className="forgot-orb forgot-orb-3"></div>

      {/* Back to Login Button */}
      <button className="forgot-back-link" onClick={handleBackToLogin}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M19 12H5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M12 19L5 12L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Back to Login
      </button>

      {/* Main Content */}
      <div className="forgot-wrapper">
        {/* Brand Section */}
        <div className="forgot-brand-section">
          <div className="forgot-brand-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 9L12 2L21 9V20C21 20.5304 20.7893 21.0391 20.4142 21.4142C20.0391 21.7893 19.5304 22 19 22H5C4.46957 22 3.96086 21.7893 3.58579 21.4142C3.21071 21.0391 3 20.5304 3 20V9Z" stroke="#1464a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M9 22V12H15V22" stroke="#1464a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 className="forgot-brand-name">{organization.hoaName}</h1>
          <div className="forgot-portal-label">RESET PASSWORD</div>
          <p className="forgot-hint-text">
            {submitted
              ? 'Check your email for a reset link'
              : 'Enter your email and we\'ll send you a link to reset your password'}
          </p>
        </div>

        {/* Form Card */}
        <form className="forgot-card" onSubmit={handleSendResetLink}>
          {!submitted && (
            <div className="forgot-form-group">
              <label className="forgot-label">Email Address</label>
              <div className="forgot-input-wrapper">
                <svg className="forgot-input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M4 4H20C21.1 4 22 4.9 22 6V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V6C2 4.9 2.9 4 4 4Z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M22 6L12 13L2 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <input
                  type="email"
                  className="forgot-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your registered email"
                  disabled={loading}
                />
              </div>
            </div>
          )}

          {/* Messages */}
          {error && <div className="forgot-error-message">{error}</div>}
          {message && <div className="forgot-success-message">{message}</div>}

          {/* Submit Button */}
          {!submitted && (
            <button type="submit" className="forgot-submit-btn" disabled={loading}>
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
          )}

          {submitted && (
            <button
              type="button"
              className="forgot-secondary-btn"
              onClick={() => {
                setSubmitted(false);
                setMessage('');
                setEmail('');
              }}
            >
              Send another link
            </button>
          )}
        </form>
      </div>
    </div>
  );
}