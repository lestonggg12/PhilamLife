import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './ForgotPasswordPage.css';

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1); // Step 1: Email, Step 2: Verify Code, Step 3: New Password
  const [email, setEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [codeExpiry, setCodeExpiry] = useState(null);
  const [attempts, setAttempts] = useState(0);
  const [lockoutTime, setLockoutTime] = useState(null);

  // Simulate code expiry countdown
  useEffect(() => {
    if (codeExpiry && step === 2) {
      const timer = setInterval(() => {
        const now = new Date();
        if (now > codeExpiry) {
          setError('Code expired. Please request a new one.');
          setStep(1);
          setCodeExpiry(null);
        }
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [codeExpiry, step]);

  // Security: Check lockout
  useEffect(() => {
    if (lockoutTime) {
      const timer = setInterval(() => {
        const now = new Date();
        if (now > lockoutTime) {
          setLockoutTime(null);
          setAttempts(0);
          setError('');
        }
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [lockoutTime]);

  const getRemainingTime = () => {
    if (!codeExpiry) return '';
    const now = new Date();
    const remaining = Math.floor((codeExpiry - now) / 1000);
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleSendCode = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (!email) {
      setError('Please enter your email address.');
      return;
    }

    // Security: Check if account exists (mock)
    const mockEmails = ['officer@philamvillage.hoa', 'admin@philamvillage.hoa', 'treasurer@philamvillage.hoa'];
    if (!mockEmails.includes(email) && !email.includes('@')) {
      setError('Invalid email format.');
      return;
    }

    setLoading(true);
    // Simulate API call delay
    setTimeout(() => {
      setLoading(false);
      // Generate mock code
      const mockCode = Math.floor(100000 + Math.random() * 900000).toString();
      sessionStorage.setItem('resetCode', mockCode);
      
      // Set 10-minute expiry
      const expiryTime = new Date(Date.now() + 10 * 60 * 1000);
      setCodeExpiry(expiryTime);
      
      setMessage(`Verification code sent to ${email}`);
      setStep(2);
      setAttempts(0);
    }, 1500);
  };

  const handleVerifyCode = (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    // Security: Lockout after 3 failed attempts
    if (lockoutTime) {
      const remaining = Math.floor((lockoutTime - new Date()) / 1000);
      setError(`Too many attempts. Try again in ${Math.ceil(remaining / 60)} minutes.`);
      return;
    }

    if (!verificationCode) {
      setError('Please enter the verification code.');
      return;
    }

    const storedCode = sessionStorage.getItem('resetCode');
    if (verificationCode !== storedCode) {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);

      if (newAttempts >= 3) {
        setLockoutTime(new Date(Date.now() + 15 * 60 * 1000)); // 15-minute lockout
        setError('Too many failed attempts. Account locked for 15 minutes.');
        return;
      }

      setError(`Invalid code. ${3 - newAttempts} attempts remaining.`);
      return;
    }

    setMessage('Code verified successfully!');
    setStep(3);
  };

  const handleResetPassword = (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (!newPassword || !confirmPassword) {
      setError('Please fill in all fields.');
      return;
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    // Password strength validation
    const hasUpperCase = /[A-Z]/.test(newPassword);
    const hasLowerCase = /[a-z]/.test(newPassword);
    const hasNumbers = /\d/.test(newPassword);
    const hasSpecialChar = /[!@#$%^&*]/.test(newPassword);

    if (!hasUpperCase || !hasLowerCase || !hasNumbers) {
      setError('Password must contain uppercase, lowercase, and numbers.');
      return;
    }

    setLoading(true);
    // Simulate API call
    setTimeout(() => {
      setLoading(false);
      sessionStorage.removeItem('resetCode');
      setMessage('Password reset successfully! Redirecting to login...');
      setTimeout(() => {
        navigate('/login');
      }, 2000);
    }, 1500);
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
          <h1 className="forgot-brand-name">PHILAM Village</h1>
          <div className="forgot-portal-label">RESET PASSWORD</div>
          <p className="forgot-hint-text">
            {step === 1 && 'Enter your email to receive a verification code'}
            {step === 2 && 'Enter the code sent to your email'}
            {step === 3 && 'Create a new secure password'}
          </p>
        </div>

        {/* Form Card */}
        <form className="forgot-card" onSubmit={step === 1 ? handleSendCode : step === 2 ? handleVerifyCode : handleResetPassword}>
          {/* Step 1: Email */}
          {step === 1 && (
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

          {/* Step 2: Verification Code */}
          {step === 2 && (
            <>
              <div className="forgot-form-group">
                <label className="forgot-label">Verification Code</label>
                <p className="forgot-code-timer">Code expires in: {getRemainingTime()}</p>
                <div className="forgot-input-wrapper">
                  <svg className="forgot-input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 1C6.5 1 2 5.5 2 11V20C2 21.1 2.9 22 4 22H20C21.1 22 22 21.1 22 20V11C22 5.5 17.5 1 12 1Z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M7 11C7 8.2 9.2 6 12 6C14.8 6 17 8.2 17 11" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <input
                    type="text"
                    className="forgot-input"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value.toUpperCase())}
                    placeholder="Enter 6-digit code"
                    maxLength="6"
                    disabled={loading}
                  />
                </div>
              </div>
              <button
                type="button"
                className="forgot-secondary-btn"
                onClick={() => {
                  setStep(1);
                  setVerificationCode('');
                  setError('');
                }}
              >
                Resend Code
              </button>
            </>
          )}

          {/* Step 3: New Password */}
          {step === 3 && (
            <>
              <div className="forgot-form-group">
                <label className="forgot-label">New Password</label>
                <div className="forgot-input-wrapper">
                  <svg className="forgot-input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 1C6.5 1 2 5.5 2 11V20C2 21.1 2.9 22 4 22H20C21.1 22 22 21.1 22 20V11C22 5.5 17.5 1 12 1Z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M7 11C7 8.2 9.2 6 12 6C14.8 6 17 8.2 17 11" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <input
                    type="password"
                    className="forgot-input"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    disabled={loading}
                  />
                </div>
              </div>
              <div className="forgot-form-group">
                <label className="forgot-label">Confirm Password</label>
                <div className="forgot-input-wrapper">
                  <svg className="forgot-input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 1C6.5 1 2 5.5 2 11V20C2 21.1 2.9 22 4 22H20C21.1 22 22 21.1 22 20V11C22 5.5 17.5 1 12 1Z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M7 11C7 8.2 9.2 6 12 6C14.8 6 17 8.2 17 11" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
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
                Password must contain: uppercase, lowercase, numbers, and be at least 8 characters
              </p>
            </>
          )}

          {/* Messages */}
          {error && <div className="forgot-error-message">{error}</div>}
          {message && <div className="forgot-success-message">{message}</div>}

          {/* Submit Button */}
          <button type="submit" className="forgot-submit-btn" disabled={loading || lockoutTime}>
            {loading ? 'Processing...' : step === 1 ? 'Send Code' : step === 2 ? 'Verify Code' : 'Reset Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
