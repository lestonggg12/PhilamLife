import React, { useState } from 'react'
import './Navbar.css'
import { X, Bell, Search } from './Icons'

export default function Navbar({ user, onLogout }) {
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)

  const handleLogoutClick = () => {
    setShowLogoutConfirm(true)
  }

  const handleConfirmLogout = () => {
    setShowLogoutConfirm(false)
    if (onLogout) {
      onLogout()
    }
  }

  const handleCancelLogout = () => {
    setShowLogoutConfirm(false)
  }

  return (
    <>
      <nav className="navbar">
        <div className="navbar-left">
          <div className="breadcrumb">
            <span className="breadcrumb-item">PHILAM Village</span>
            <span className="breadcrumb-sep">/</span>
            <span className="breadcrumb-item">Dashboard</span>
            <span className="breadcrumb-sep">/</span>
            <span className="breadcrumb-active">System Active</span>
          </div>
        </div>
        
        <div className="navbar-right">
          <div className="navbar-icons">
            <button className="icon-btn" title="Notifications">
              <Bell size={20} />
            </button>
            <button className="icon-btn" title="Search">
              <Search size={20} />
            </button>
          </div>
          <button className="logout-link" onClick={handleLogoutClick}>
            Logout
          </button>
        </div>
      </nav>

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="modal-overlay" onClick={handleCancelLogout}>
          <div className="logout-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Confirm Logout</h2>
              <button className="modal-close" onClick={handleCancelLogout}>
                <X size={24} />
              </button>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to log out?</p>
              <p className="modal-subtitle">You will be redirected to the login page.</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={handleCancelLogout}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleConfirmLogout}>
                Yes, Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
