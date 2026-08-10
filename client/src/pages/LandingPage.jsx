import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOrganization } from '../context/OrganizationContext';
import '../styles/LandingPage.css';

const ROLE_CHOICES = [
  {
    key: 'Admin',
    description: 'Full system access — users, settings, and all modules.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="#1766a0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="#1766a0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    key: 'Secretary',
    description: 'Homeowners, documents, events, and community records.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 19.5A2.5 2.5 0 016.5 17H20" stroke="#1766a0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" stroke="#1766a0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    key: 'Treasurer',
    description: 'Ledger, payments, expenses, and financial reports.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 12V8H6a2 2 0 010-4h12v4" stroke="#1766a0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M4 6v12a2 2 0 002 2h14v-4" stroke="#1766a0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M18 12a2 2 0 100 4 2 2 0 000-4z" stroke="#1766a0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
]

export default function LandingPage() {
  const navigate = useNavigate();
  const { organization } = useOrganization();
  const [rolePickerIntent, setRolePickerIntent] = useState(null); // null | 'login' | 'guide'

  function chooseRole(role) {
    const intent = rolePickerIntent;
    setRolePickerIntent(null);
    if (intent === 'guide') {
      navigate(`/guide?role=${role}`);
    } else {
      navigate(`/login?role=${role}`);
    }
  }

  function goToLogin(role) {
    setRolePickerIntent(null);
    navigate(`/login?role=${role}`);
  }

  return (
    <div className="lp-container">
      {/* Animated Background Orbs */}
      <div className="lp-orb lp-orb-1"></div>
      <div className="lp-orb lp-orb-2"></div>
      <div className="lp-orb lp-orb-3"></div>

      {/* Navbar */}
      <nav className="lp-navbar">
        <div className="lp-navbar-content">
          {/* Brand */}
          <div className="lp-brand">
            <div className="lp-brand-icon">
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M18 2L28 8V18H8V8L18 2Z" stroke="#1766a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M8 18V28C8 29.1 8.9 30 10 30H26C27.1 30 28 29.1 28 28V18" stroke="#1766a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M14 22V28" stroke="#1766a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M22 22V28" stroke="#1766a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="lp-brand-name">{organization.hoaName}</span>
          </div>

          {/* Status Pill */}
          <div className="lp-status-pill">
            <div className="lp-status-dot"></div>
            <span>HOA Management System Active</span>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="lp-hero">
        <div className="lp-hero-content">
          <div className="lp-hero-eyebrow">HOMEOWNERS ASSOCIATION</div>
          <h1 className="lp-hero-title">
            {(() => {
              const words = organization.hoaName.trim().split(' ')
              const lastWord = words.pop()
              return (
                <>
                  {words.length > 0 && <span>{words.join(' ')}</span>}{' '}
                  <span className="lp-hero-highlight">{lastWord}</span>
                </>
              )
            })()}
          </h1>
          <div className="lp-hero-subtitle">LEDGER & PAYMENT SYSTEM</div>
          <p className="lp-hero-description">
            A secure platform for managing homeowner dues, collections, and financial records for our community.
          </p>

          {/* CTA Row */}
          <div className="lp-cta-row">
            <button className="lp-btn lp-btn-primary" onClick={() => setRolePickerIntent('login')}>ACCESS PORTAL</button>
            <div className="lp-cta-divider"></div>
            <a href="#" className="lp-ghost-link" onClick={(e) => { e.preventDefault(); setRolePickerIntent('guide'); }}>Learn more →</a>
          </div>
        </div>
      </section>

      {/* Feature Cards */}
      <section className="lp-features">
        <div className="lp-cards-container">
          {/* Card 1 */}
          <div className="lp-card">
            <div className="lp-card-icon">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 10H32V28C32 29.1 31.1 30 30 30H10C8.9 30 8 29.1 8 28V10Z" stroke="#1766a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 14H28" stroke="#1766a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 18H28" stroke="#1766a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 22H22" stroke="#1766a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h3 className="lp-card-title">Payment Tracking</h3>
            <p className="lp-card-description">Monitor dues, receipts, and collection status across all homeowners in real time.</p>
          </div>

          {/* Card 2 */}
          <div className="lp-card">
            <div className="lp-card-icon">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 8V32" stroke="#1766a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M28 8V32" stroke="#1766a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M8 12H32" stroke="#1766a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M8 20H32" stroke="#1766a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M14 16L16 18L20 14" stroke="#1766a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M26 16L28 18L32 14" stroke="#1766a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h3 className="lp-card-title">Financial Ledger</h3>
            <p className="lp-card-description">Transparent records of all transactions, balances, and HOA financial activities.</p>
          </div>

          {/* Card 3 */}
          <div className="lp-card">
            <div className="lp-card-icon">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M20 8C13.4 8 8 13.4 8 20C8 26.6 13.4 32 20 32C26.6 32 32 26.6 32 20C32 13.4 26.6 8 20 8Z" stroke="#1766a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M20 14V20L24 24" stroke="#1766a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 20C12 15.6 15.6 12 20 12" stroke="#1f9e6e" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h3 className="lp-card-title">Secure Portals</h3>
            <p className="lp-card-description">Role-based access for Admin, Treasurer, Secretary, and homeowner accounts.</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="lp-footer">
        <div className="lp-footer-content">
          {/* Brand Column */}
          <div className="lp-footer-column">
            <h4 className="lp-footer-brand">{organization.hoaName}</h4>
            <p className="lp-footer-tagline">Empowering our community through transparent management and modern tools.</p>
          </div>

          {/* Platform Column */}
          <div className="lp-footer-column">
            <h5 className="lp-footer-col-title">PLATFORM</h5>
            <button onClick={() => setRolePickerIntent('login')} className="lp-footer-link" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>Portal Login</button>
            <a href="#" className="lp-footer-link" onClick={(e) => e.preventDefault()}>Features</a>
            <a href="#" className="lp-footer-link" onClick={(e) => e.preventDefault()}>About</a>
          </div>

          {/* Portals Column */}
          <div className="lp-footer-column">
            <h5 className="lp-footer-col-title">PORTALS</h5>
            <button onClick={() => goToLogin('Admin')} className="lp-footer-link" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>Admin Portal</button>
            <button onClick={() => goToLogin('Treasurer')} className="lp-footer-link" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>Treasurer Portal</button>
            <button onClick={() => goToLogin('Secretary')} className="lp-footer-link" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>Secretary Portal</button>
          </div>

          {/* Legal Column */}
          <div className="lp-footer-column">
            <h5 className="lp-footer-col-title">LEGAL</h5>
            <a href="#" className="lp-footer-link">Privacy Policy</a>
            <a href="#" className="lp-footer-link">Terms of Service</a>
            <a href="#" className="lp-footer-link">Security</a>
          </div>
        </div>

        {/* Footer Bottom */}
        <div className="lp-footer-bottom">
          <span className="lp-footer-copyright">© {new Date().getFullYear()} {organization.hoaName}. All rights reserved.</span>
          <div className="lp-footer-status">
            <div className="lp-status-dot"></div>
            <span>All systems operational</span>
          </div>
        </div>
      </footer>

      {/* Role Picker Modal */}
      {rolePickerIntent && (
        <div
          className="lp-role-modal-overlay"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setRolePickerIntent(null);
          }}
        >
          <div className="lp-role-modal" role="dialog" aria-modal="true" aria-labelledby="lp-role-modal-title">
            <button
              className="lp-role-modal-close"
              onClick={() => setRolePickerIntent(null)}
              aria-label="Close"
              type="button"
            >
              ×
            </button>
            <h2 id="lp-role-modal-title" className="lp-role-modal-title">
              {rolePickerIntent === 'guide' ? 'What is your role?' : 'Logging in as?'}
            </h2>
            <p className="lp-role-modal-subtitle">
              {rolePickerIntent === 'guide'
                ? "Pick your role and we'll open the guide for what you'll actually use."
                : 'Choose your role to continue to the portal.'}
            </p>

            <div className="lp-role-modal-options">
              {ROLE_CHOICES.map((role) => (
                <button
                  key={role.key}
                  type="button"
                  className="lp-role-option"
                  onClick={() => chooseRole(role.key)}
                >
                  <span className="lp-role-option-icon">{role.icon}</span>
                  <span className="lp-role-option-text">
                    <span className="lp-role-option-name">{role.key}</span>
                    <span className="lp-role-option-description">{role.description}</span>
                  </span>
                  <span className="lp-role-option-arrow" aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}