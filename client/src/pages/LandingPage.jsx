import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useOrganization } from '../context/OrganizationContext';
import './Landingpage.css';

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

function scrollToSection(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Split a string into one <span class="lp-ch"> per character, preserving spaces. */
function splitChars(text, startIndex) {
  let i = startIndex;
  return [...text].map((ch) => {
    const idx = i++;
    return (
      <span className="lp-ch" style={{ '--i': idx }} key={idx}>
        {ch === ' ' ? ' ' : ch}
      </span>
    );
  });
}

export default function LandingPage({ onAccessPortal } = {}) {
  const navigate = useNavigate();
  const { organization } = useOrganization();
  const [rolePickerIntent, setRolePickerIntent] = useState(null); // null | 'login' | 'guide'

  const reducedMotionRef = useRef(false);
  const introRef = useRef(null);
  const [introExiting, setIntroExiting] = useState(false);
  const [introGone, setIntroGone] = useState(false);
  const [heroSettled, setHeroSettled] = useState(false);

  const headerRef = useRef(null);
  const progressRef = useRef(null);
  const heroRef = useRef(null);
  const spotlightRef = useRef(null);
  const titleRef = useRef(null);
  const sweepingRef = useRef(false);

  // ---- Intro sequence: logo draw / name fade / bar fill, then shutters open ----
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    reducedMotionRef.current = reduced;

    if (reduced) {
      setIntroGone(true);
      setHeroSettled(true);
      document.documentElement.classList.remove('lp-loading');
      return;
    }

    document.documentElement.classList.add('lp-loading');
    let exitTimer, settleTimer, sweepTimer, goneTimer;
    const failsafe = setTimeout(finish, 7000);

    function finish() {
      clearTimeout(exitTimer); clearTimeout(settleTimer); clearTimeout(sweepTimer); clearTimeout(goneTimer); clearTimeout(failsafe);
      setIntroExiting(true);
      setHeroSettled(true);
      document.documentElement.classList.remove('lp-loading');
      setIntroGone(true);
    }

    Promise.all([
      new Promise((r) => { exitTimer = setTimeout(r, 1900); }),
      document.fonts ? document.fonts.ready.catch(() => {}) : Promise.resolve(),
    ]).then(() => {
      setIntroExiting(true);
      document.documentElement.classList.remove('lp-loading');
      settleTimer = setTimeout(() => setHeroSettled(true), 450);
      sweepTimer = setTimeout(() => runSweep(), 650);
      goneTimer = setTimeout(() => setIntroGone(true), 1300);
      clearTimeout(failsafe);
    });

    return () => {
      clearTimeout(exitTimer); clearTimeout(settleTimer); clearTimeout(sweepTimer); clearTimeout(goneTimer); clearTimeout(failsafe);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Header shrink + scroll progress bar ----
  useEffect(() => {
    function onScroll() {
      if (headerRef.current) {
        headerRef.current.classList.toggle('lp-scrolled', window.scrollY > 30);
      }
      if (progressRef.current) {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const pct = max > 0 ? window.scrollY / max : 0;
        progressRef.current.style.transform = `scaleX(${pct})`;
      }
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Keep the portal picker dismissible from the keyboard.
  useEffect(() => {
    if (!rolePickerIntent) return undefined;
    function onKeyDown(event) {
      if (event.key === 'Escape') setRolePickerIntent(null);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [rolePickerIntent]);

  // ---- Scroll reveal ----
  useEffect(() => {
    const els = document.querySelectorAll('.lp-reveal');
    if (!els.length) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('lp-in');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // ---- Hero spotlight follows the pointer ----
  useEffect(() => {
    const hero = heroRef.current;
    const spot = spotlightRef.current;
    if (!hero || !spot) return undefined;
    function onMove(e) {
      const r = hero.getBoundingClientRect();
      spot.style.setProperty('--mx', `${e.clientX - r.left}px`);
      spot.style.setProperty('--my', `${e.clientY - r.top}px`);
    }
    hero.addEventListener('pointermove', onMove);
    return () => hero.removeEventListener('pointermove', onMove);
  }, []);

  // ---- Title: a band of light sweeps across the letters ----
  function runSweep() {
    if (reducedMotionRef.current || sweepingRef.current || !titleRef.current) return;
    sweepingRef.current = true;
    const chars = titleRef.current.querySelectorAll('.lp-ch');
    const box = titleRef.current.getBoundingClientRect();
    const xs = [...chars].map((c) => {
      const r = c.getBoundingClientRect();
      return r.left + r.width / 2 - box.left;
    });
    const band = box.width * 0.15;
    const dur = 1400;
    const t0 = performance.now();
    function frame(now) {
      const p = Math.min((now - t0) / dur, 1);
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const x = -band + (box.width + 2 * band) * e;
      chars.forEach((c, i) => {
        const d = (xs[i] - x) / band;
        c.style.setProperty('--g', Math.exp(-d * d * 2).toFixed(3));
      });
      if (p < 1) requestAnimationFrame(frame);
      else {
        chars.forEach((c) => c.style.setProperty('--g', 0));
        sweepingRef.current = false;
      }
    }
    requestAnimationFrame(frame);
  }

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

  const words = organization.hoaName.trim().split(' ');
  const lastWord = words.pop();
  const firstWords = words.join(' ');
  const firstWordsChars = firstWords ? splitChars(firstWords, 0) : [];
  const lastWordChars = splitChars(lastWord, firstWords ? firstWords.length + 1 : 0);

  return (
    <div className="lp-container">
      {/* Scroll progress */}
      <div className="lp-progress" ref={progressRef} aria-hidden="true"></div>

      {/* Animated Background Orbs */}
      <div className="lp-bg" aria-hidden="true">
        <div className="lp-orb lp-orb-1"></div>
        <div className="lp-orb lp-orb-2"></div>
        <div className="lp-orb lp-orb-3"></div>
      </div>

      {/* Intro splash */}
      {!introGone && (
        <div className={`lp-intro${introExiting ? ' lp-intro-exit' : ''}`} ref={introRef} aria-hidden="true">
          <div className="lp-intro-panel lp-intro-top"></div>
          <div className="lp-intro-panel lp-intro-bottom"></div>
          <div className="lp-intro-content">
            <svg className="lp-intro-logo" width="88" height="88" viewBox="0 0 24 24" fill="none">
              <path pathLength="1" d="M5 20V9.5a7 7 0 0 1 14 0V20M3 20h18M9 20v-5h6v5" />
            </svg>
            <div className="lp-intro-name">{organization.hoaName}</div>
            <div className="lp-intro-bar"><i></i></div>
          </div>
        </div>
      )}

      {/* Navbar */}
      <nav className="lp-navbar" ref={headerRef} aria-label="Primary navigation">
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
          <div className="lp-status-pill" role="status">
            <div className="lp-status-dot" aria-hidden="true"></div>
            <span>HOA Management System Active</span>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="lp-hero" ref={heroRef}>
        <div className="lp-spotlight" ref={spotlightRef} aria-hidden="true"></div>
        <div className="lp-hero-content">
          <div className="lp-hero-eyebrow lp-fade-in" style={{ animationDelay: '.05s' }}>HOMEOWNERS ASSOCIATION</div>
          <h1
            className={`lp-hero-title${heroSettled ? ' lp-settled' : ''}`}
            ref={titleRef}
            aria-label={organization.hoaName}
            onPointerEnter={runSweep}
          >
            {firstWords && (
              <span className="lp-word" aria-hidden="true">
                {firstWordsChars}
              </span>
            )}
            {' '}
            <span className="lp-word lp-hero-highlight" aria-hidden="true">
              {lastWordChars}
            </span>
          </h1>
          <div className="lp-hero-subtitle lp-fade-in" style={{ animationDelay: '.7s' }}>LEDGER &amp; PAYMENT SYSTEM</div>
          <p className="lp-hero-description lp-fade-in" style={{ animationDelay: '.85s' }}>
            A secure platform for managing homeowner dues, collections, and financial records for our community.
          </p>

          {/* CTA Row */}
          <div className="lp-cta-row lp-fade-in" style={{ animationDelay: '1s' }}>
            <button className="lp-btn lp-btn-primary" onClick={() => onAccessPortal ? onAccessPortal() : setRolePickerIntent('login')}>ACCESS PORTAL</button>
            <div className="lp-cta-divider"></div>
            <a href="#" className="lp-ghost-link" onClick={(e) => { e.preventDefault(); setRolePickerIntent('guide'); }}>
              Learn more <span className="lp-arrow">→</span>
            </a>
          </div>
        </div>
        <div className="lp-scroll-hint" aria-hidden="true"></div>
      </section>

      <main>
        {/* Feature Cards */}
        <section className="lp-features" id="features">
          <div className="lp-cards-container">
            {/* Card 1 */}
            <article
              className="lp-card lp-reveal"
              onPointerMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                e.currentTarget.style.setProperty('--x', `${e.clientX - r.left}px`);
                e.currentTarget.style.setProperty('--y', `${e.clientY - r.top}px`);
              }}
            >
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
            </article>

            {/* Card 2 */}
            <article
              className="lp-card lp-reveal"
              style={{ '--d': '120ms' }}
              onPointerMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                e.currentTarget.style.setProperty('--x', `${e.clientX - r.left}px`);
                e.currentTarget.style.setProperty('--y', `${e.clientY - r.top}px`);
              }}
            >
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
            </article>

            {/* Card 3 */}
            <article
              className="lp-card lp-reveal"
              style={{ '--d': '240ms' }}
              onPointerMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                e.currentTarget.style.setProperty('--x', `${e.clientX - r.left}px`);
                e.currentTarget.style.setProperty('--y', `${e.clientY - r.top}px`);
              }}
            >
              <div className="lp-card-icon">
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M20 7L31 12V19c0 6.7-4.6 11.6-11 14-6.4-2.4-11-7.3-11-14v-7l11-5Z" stroke="#1766a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M14 20l4 4 8-9" stroke="#1f9e6e" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h3 className="lp-card-title">Secure Portals</h3>
              <p className="lp-card-description">Role-based access for Admin, Treasurer, Secretary, and homeowner accounts.</p>
            </article>
          </div>
        </section>

        {/* About */}
        <section className="lp-about" id="about">
          <div className="lp-about-card lp-reveal">
            <div className="lp-about-eyebrow">ABOUT</div>
            <h2 className="lp-about-title">Built for how {organization.hoaName} actually runs</h2>
            <p className="lp-about-text">
              The Ledger &amp; Payment System replaces scattered notebooks and spreadsheets with one organized place for the association's records. Officers can bill dues, record payments, issue official receipts, and follow up on overdue accounts, while every action is logged for transparency.
            </p>
            <p className="lp-about-text">
              Each officer signs in to a portal made for their role, so everyone sees what they need and nothing more.
            </p>
            <ul className="lp-about-list">
              <li><span className="lp-dot"></span>Homeowner and property records</li>
              <li><span className="lp-dot"></span>Dues, charges, and payment allocation</li>
              <li><span className="lp-dot"></span>Official receipts and financial reports</li>
              <li><span className="lp-dot"></span>Documents, events, and community records</li>
              <li><span className="lp-dot"></span>Activity log for every officer action</li>
              <li><span className="lp-dot"></span>Role-based access for Admin, Secretary, and Treasurer</li>
            </ul>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="lp-footer">
        <div className="lp-footer-content">
          {/* Brand Column */}
          <div className="lp-footer-column lp-reveal">
            <h4 className="lp-footer-brand">{organization.hoaName}</h4>
            <p className="lp-footer-tagline">Empowering our community through transparent management and modern tools.</p>
          </div>

          {/* Platform Column */}
          <div className="lp-footer-column lp-reveal" style={{ '--d': '80ms' }}>
            <h5 className="lp-footer-col-title">PLATFORM</h5>
            <button onClick={() => setRolePickerIntent('login')} className="lp-footer-link" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>Portal Login</button>
            <a href="#features" className="lp-footer-link" onClick={(e) => { e.preventDefault(); scrollToSection('features'); }}>Features</a>
            <a href="#about" className="lp-footer-link" onClick={(e) => { e.preventDefault(); scrollToSection('about'); }}>About</a>
          </div>

          {/* Portals Column */}
          <div className="lp-footer-column lp-reveal" style={{ '--d': '160ms' }}>
            <h5 className="lp-footer-col-title">PORTALS</h5>
            <button onClick={() => goToLogin('Admin')} className="lp-footer-link" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>Admin Portal</button>
            <button onClick={() => goToLogin('Treasurer')} className="lp-footer-link" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>Treasurer Portal</button>
            <button onClick={() => goToLogin('Secretary')} className="lp-footer-link" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>Secretary Portal</button>
          </div>

          {/* Legal Column */}
          <div className="lp-footer-column lp-reveal" style={{ '--d': '240ms' }}>
            <h5 className="lp-footer-col-title">LEGAL</h5>
            <Link to="/privacy" className="lp-footer-link">Privacy Policy</Link>
            <Link to="/terms" className="lp-footer-link">Terms of Service</Link>
            <Link to="/security" className="lp-footer-link">Security</Link>
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
              {rolePickerIntent === 'guide' ? 'What is your role?' : 'Choose your portal'}
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