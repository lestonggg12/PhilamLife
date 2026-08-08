import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOrganization } from '../context/OrganizationContext';
import { supabase } from '../lib/supabaseClient';
import './ForgotPasswordPage.css';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const { organization } = useOrganization();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [validSession, setValidSession] = useState(false);

  useEffect(() => {
    // When the user arrives here via the emailed reset link, Supabase's
    // client library automatically parses the recovery token from the URL
    // and establishes a temporary "recovery" session. We just need to
    // confirm that session exists before letting them set a new password.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setValidSession(Boolean(session));
      setCheckingSession(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) {
        setValidSession(true);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (!newPassword || !confirmPassword) {
      setError('Please fill in all fields.');
      return;
    }

    const minLength = organization.requireStrongPassword ? 8 : 6;

    if (newPassword.length < minLength) {
      setError(`Password must be at least ${minLength} characters long.`);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    // "Require strong passwords" in Admin > System Settings > Security
    // controls whether this stricter rule applies. Off just means the
    // minimum-length check above still applies — never no rule at all.
    if (organization.requireStrongPassword) {
      const hasUpperCase = /[A-Z]/.test(newPassword);
      const hasNumber = /\d/.test(newPassword);
      const hasSymbol = /[^A-Za-z0-9]/.test(newPassword);

      if (!hasUpperCase || !hasNumber || !hasSymbol) {
        setError('Password must contain an uppercase letter, a number, and a symbol.');
        return;
      }
    }

    setLoading(true);

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setMessage('Password reset successfully! Redirecting to login...');
    await supabase.auth.signOut();
    setTimeout(() => {
      navigate('/login');
    }, 2000);
  };

  return (
    <div className="forgot-container">
      <div className="forgot-orb forgot-orb-1"></div>
      <div className="forgot-orb forgot-orb-2"></div>
      <div className="forgot-orb forgot-orb-3"></div>

      <div className="forgot-wrapper">
        <div className="forgot-brand-section">
          <div className="forgot-brand-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 9L12 2L21 9V20C21 20.5304 20.7893 21.0391 20.4142 21.4142C20.0391 21.7893 19.5304 22 19 22H5C4.46957 22 3.96086 21.7893 3.58579 21.4142C3.21071 21.0391 3 20.5304 3 20V9Z" stroke="#1464a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M9 22V12H15V22" stroke="#1464a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 className="forgot-brand-name">{organization.hoaName}</h1>
          <div className="forgot-portal-label">SET NEW PASSWORD</div>
          <p className="forgot-hint-text">Create a new secure password for your account</p>
        </div>

        <form className="forgot-card" onSubmit={handleResetPassword}>
          {checkingSession ? (
            <p className="forgot-hint-text">Verifying your reset link...</p>
          ) : !validSession ? (
            <div className="forgot-error-message">
              This reset link is invalid or has expired. Please request a new one from the{' '}
              <a href="/forgot-password">Forgot Password</a> page.
            </div>
          ) : (
            <>
              <div className="forgot-form-group">
                <label className="forgot-label">New Password</label>
                <div className="forgot-input-wrapper">
                  <input
                    type="password"
                    className="forgot-input"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={organization.requireStrongPassword ? 'At least 8 characters' : 'At least 6 characters'}
                    disabled={loading}
                  />
                </div>
              </div>
              <div className="forgot-form-group">
                <label className="forgot-label">Confirm Password</label>
                <div className="forgot-input-wrapper">
                  <input
                    type="password"
                    className="forgot-input"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    disabled={loading}
                  />
                </div>
              </div>
              <p className="forgot-password-requirements">
                {organization.requireStrongPassword
                  ? 'Password must contain: an uppercase letter, a number, a symbol, and be at least 8 characters'
                  : 'Password must be at least 6 characters'}
              </p>

              {error && <div className="forgot-error-message">{error}</div>}
              {message && <div className="forgot-success-message">{message}</div>}

              <button type="submit" className="forgot-submit-btn" disabled={loading}>
                {loading ? 'Saving...' : 'Reset Password'}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}