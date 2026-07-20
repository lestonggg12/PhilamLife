import React from 'react'
import { Link } from 'react-router-dom'
import './HomePage.css'

export default function HomePage() {
  return (
    <div className="homepage">
      {/* Navbar */}
      <nav className="navbar">
        <div className="navbar-container">
          <Link to="/" className="navbar-logo">
            <span className="logo-icon">🏘️</span>
            <span className="logo-text">PHILAM Village</span>
          </Link>
          
          <div className="status-pill">
            <span className="status-indicator"></span>
            <span className="status-text">HOA Management System Active</span>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="hero" id="hero">
        {/* Decorative Stars */}
        <div className="stars">
          {[...Array(20)].map((_, i) => (
            <div key={i} className="star" style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 60}%`,
              animationDelay: `${i * 0.1}s`
            }}></div>
          ))}
        </div>

        {/* Hero Content - Centered */}
        <div className="hero-content-wrapper">
          <h1 className="hero-title">PHILAM Village</h1>
          <h2 className="hero-subtitle">HOA Ledger & Payment System</h2>
          
          <p className="hero-description">
            A secure platform for managing homeowner dues, <br />
            collections, and financial records for our community.
          </p>

          <Link to="/login" className="btn btn-primary btn-cta">Access Portal</Link>
        </div>

        {/* Gradient Fade Mask */}
        <div className="hero-fade-mask"></div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="footer-container">
          <div className="footer-column">
            <h3>PHILAM Village</h3>
            <p>Empowering our community through transparent management and modern tools.</p>
          </div>

          <div className="footer-column">
            <h4>Platform</h4>
            <ul>
              <li><a href="#portal-login">Portal Login</a></li>
              <li><a href="#features">Features</a></li>
              <li><a href="#about">About</a></li>
            </ul>
          </div>

          <div className="footer-column">
            <h4>Portals</h4>
            <ul>
              <li><a href="#admin">Admin Portal</a></li>
              <li><a href="#treasurer">Treasurer Portal</a></li>
              <li><a href="#secretary">Secretary Portal</a></li>
            </ul>
          </div>

          <div className="footer-column">
            <h4>Legal</h4>
            <ul>
              <li><a href="#privacy">Privacy Policy</a></li>
              <li><a href="#terms">Terms of Service</a></li>
              <li><a href="#security">Security</a></li>
            </ul>
          </div>
        </div>

        <div className="footer-bottom">
          <p>&copy; 2026 PHILAM Village Lite HOA. All rights reserved.</p>
          <div className="footer-socials">
            <a href="#facebook" title="Facebook">f</a>
            <a href="#email" title="Email">✉</a>
          </div>
        </div>
      </footer>
    </div>
  )
}

