import React from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/LandingPage.css';

export default function LandingPage() {
  const navigate = useNavigate();
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
            <span className="lp-brand-name">PHILAM Village</span>
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
            <span>PHILAM</span> <span className="lp-hero-highlight">Village</span>
          </h1>
          <div className="lp-hero-subtitle">LEDGER & PAYMENT SYSTEM</div>
          <p className="lp-hero-description">
            A secure platform for managing homeowner dues, collections, and financial records for our community.
          </p>

          {/* CTA Row */}
          <div className="lp-cta-row">
            <button className="lp-btn lp-btn-primary" onClick={() => navigate('/login')}>ACCESS PORTAL</button>
            <div className="lp-cta-divider"></div>
            <a href="#" className="lp-ghost-link" onClick={(e) => { e.preventDefault(); }}>Learn more →</a>
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
            <h4 className="lp-footer-brand">PHILAM Village</h4>
            <p className="lp-footer-tagline">Empowering our community through transparent management and modern tools.</p>
          </div>

          {/* Platform Column */}
          <div className="lp-footer-column">
            <h5 className="lp-footer-col-title">PLATFORM</h5>
            <button onClick={() => navigate('/login')} className="lp-footer-link" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>Portal Login</button>
            <a href="#" className="lp-footer-link" onClick={(e) => e.preventDefault()}>Features</a>
            <a href="#" className="lp-footer-link" onClick={(e) => e.preventDefault()}>About</a>
          </div>

          {/* Portals Column */}
          <div className="lp-footer-column">
            <h5 className="lp-footer-col-title">PORTALS</h5>
            <button onClick={() => navigate('/login')} className="lp-footer-link" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>Admin Portal</button>
            <button onClick={() => navigate('/login')} className="lp-footer-link" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>Treasurer Portal</button>
            <button onClick={() => navigate('/login')} className="lp-footer-link" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>Secretary Portal</button>
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
          <span className="lp-footer-copyright">© 2024 PHILAM Village. All rights reserved.</span>
          <div className="lp-footer-status">
            <div className="lp-status-dot"></div>
            <span>All systems operational</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
