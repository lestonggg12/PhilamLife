import React, { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Turnstile } from '@marsidev/react-turnstile';
import './LoginPage.css';
import { Mail, Lock } from '../components/Icons';
import { setRememberMePreference, supabase } from '../lib/supabaseClient';
import { useOrganization } from '../context/OrganizationContext';

const VALID_ROLES = ['Admin', 'Secretary', 'Treasurer'];

// Public Turnstile site key (safe to expose). Env var wins if set.
const TURNSTILE_SITE_KEY =
  import.meta.env.VITE_TURNSTILE_SITE_KEY || '0x4AAAAAAFT0_eur9ECXzVDx';

// Client-side brake against password guessing. Real rate limiting is enforced
// by Supabase Auth on the server; this just slows down casual abuse.
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 60 * 1000;
const LOCKOUT_KEY = 'philam-login-locked-until';

export default function LoginPage({ onAuthenticated }) {
  const navigate = useNavigate();
  const { organization } = useOrganization();
  const [searchParams, setSearchParams] = useSearchParams();
  const roleFromUrl = VALID_ROLES.find(
    (role) => role.toLowerCase() === (searchParams.get('role') || '').toLowerCase(),
  );
  const [selectedRole, setSelectedRole] = useState(roleFromUrl || 'Secretary');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState(null);
  const [captchaError, setCaptchaError] = useState(false);
  const failedAttempts = useRef(0);
  const turnstileRef = useRef(null);

  // Turnstile tokens are single-use, so reset after every sign-in attempt.
  const resetCaptcha = () => {
    setCaptchaToken(null);
    turnstileRef.current?.reset();
  };

  const handleRoleChange = (role) => {
    setSelectedRole(role);
    setSearchParams({ role }, { replace: true });
    setError('');
  };

  const togglePasswordVisibility = () => {
    setShowPassword((prev) => !prev);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError('');

    const lockedUntil = Number(sessionStorage.getItem(LOCKOUT_KEY)) || 0;
    if (Date.now() < lockedUntil) {
      const seconds = Math.ceil((lockedUntil - Date.now()) / 1000);
      setError(`Too many failed attempts. Please try again in ${seconds} seconds.`);
      return;
    }

    if (!captchaToken) {
      setError('Please complete the verification first.');
      return;
    }

    setLoading(true);
    setRememberMePreference(rememberMe);

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
      options: { captchaToken },
    });

    if (authError) {
      resetCaptcha();
      failedAttempts.current += 1;
      if (failedAttempts.current >= MAX_FAILED_ATTEMPTS) {
        sessionStorage.setItem(LOCKOUT_KEY, String(Date.now() + LOCKOUT_MS));
        failedAttempts.current = 0;
        setError('Too many failed attempts. Please wait a minute before trying again.');
      } else if (/captcha/i.test(authError.message || '')) {
        setError('Verification failed. Please try again.');
      } else {
        setError('Invalid email or password');
      }
      setLoading(false);
      return;
    }

    failedAttempts.current = 0;
    sessionStorage.removeItem(LOCKOUT_KEY);

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (profileError || !profile) {
      resetCaptcha();
      setError('Account exists but has no profile. Contact an admin.');
      setLoading(false);
      return;
    }

    // Verify the tab they picked matches their actual role
    if (profile.role !== selectedRole.toLowerCase()) {
      resetCaptcha();
      setError(`This account is registered as ${profile.role}, not ${selectedRole}. Please select the correct portal.`);
      await supabase.auth.signOut();
      setLoading(false);
      return;
    }

    setLoading(false);
    onAuthenticated(profile);
  };

  const handleBackHome = () => {
    navigate('/');
  };

  return (
    <div className="login-container">
      <div className="login-orb login-orb-1"></div>
      <div className="login-orb login-orb-2"></div>
      <div className="login-orb login-orb-3"></div>

      <button className="login-back-link" onClick={handleBackHome}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M19 12H5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M12 19L5 12L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Back to Home
      </button>

      <div className="login-wrapper">
        <div className="login-brand-section">
          <div className="login-brand-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 9L12 2L21 9V20C21 20.5304 20.7893 21.0391 20.4142 21.4142C20.0391 21.7893 19.5304 22 19 22H5C4.46957 22 3.96086 21.7893 3.58579 21.4142C3.21071 21.0391 3 20.5304 3 20V9Z" stroke="#1464a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M9 22V12H15V22" stroke="#1464a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 className="login-brand-name">{organization.hoaName}</h1>
          <div className="login-portal-label">PORTAL LOGIN</div>
          <p className="login-hint-text">Select your role and sign in to access your dashboard</p>
        </div>

        <div className="login-tabs-container">
          <button
            className={`login-tab ${selectedRole === 'Admin' ? 'active' : ''}`}
            onClick={() => handleRoleChange('Admin')}
            type="button"
          >
            <i className="ti ti-settings"></i>
            <span>Admin</span>
          </button>
          <button
            className={`login-tab ${selectedRole === 'Secretary' ? 'active' : ''}`}
            onClick={() => handleRoleChange('Secretary')}
            type="button"
          >
            <i className="ti ti-edit"></i>
            <span>Secretary</span>
          </button>
          <button
            className={`login-tab ${selectedRole === 'Treasurer' ? 'active' : ''}`}
            onClick={() => handleRoleChange('Treasurer')}
            type="button"
          >
            <i className="ti ti-wallet"></i>
            <span>Treasurer</span>
          </button>
        </div>

        <form className="login-card" onSubmit={handleLogin}>
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

          <div className="login-form-group">
            <label className="login-label">Password</label>
            <div className="login-input-wrapper">
              <span className="login-input-icon-lock" aria-hidden="true">
                <Lock size={18} />
              </span>
              <input
                type={showPassword ? 'text' : 'password'}
                className="login-input"
                id="pwfield"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                style={{ paddingRight: 48 }}
                required
              />
              <button
                type="button"
                className="login-eye-toggle"
                onClick={togglePasswordVisibility}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                tabIndex={0}
              >
                {showPassword ? (
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div className="login-remember-row">
            <label className="login-checkbox-label">
              <input
                type="checkbox"
                className="login-checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              <span>Remember me on this device</span>
            </label>
            <a href="#" className="login-forgot-link" onClick={(e) => {
              e.preventDefault();
              navigate('/forgot-password');
            }}>
              Forgot password?
            </a>
          </div>

          <div
            className="login-turnstile"
            style={{ display: 'flex', justifyContent: 'center', minHeight: 65, marginTop: 12 }}
          >
            <Turnstile
              ref={turnstileRef}
              siteKey={TURNSTILE_SITE_KEY}
              options={{ theme: 'light', size: 'flexible' }}
              onSuccess={(token) => {
                setCaptchaToken(token);
                setCaptchaError(false);
              }}
              onExpire={() => setCaptchaToken(null)}
              onError={(code) => {
                console.error('Turnstile error:', code);
                setCaptchaToken(null);
                setCaptchaError(true);
              }}
            />
          </div>

          {captchaError && (
            <p style={{ color: '#c0392b', fontSize: '13px', marginTop: '8px', textAlign: 'center' }}>
              Verification could not load. Disable ad blockers or extensions for this site, then refresh.
            </p>
          )}

          {error && <p style={{ color: '#c0392b', fontSize: '14px', marginTop: '8px' }}>{error}</p>}

          <button
            type="submit"
            className="login-submit-btn"
            id="signinbtn"
            disabled={loading || !captchaToken}
          >
            {loading ? 'Signing in...' : `Sign In To ${selectedRole} Portal`}
          </button>
        </form>
      </div>
    </div>
  );
}