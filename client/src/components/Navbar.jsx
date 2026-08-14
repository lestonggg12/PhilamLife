import React, { useState } from 'react'
import { useLocation } from 'react-router-dom'
import './Navbar.css'
import { Bell, Search, LogOut } from './Icons'
import { useOrganization } from '../context/OrganizationContext'

const PAGE_LABELS = {
  '/admin/dashboard': 'Dashboard',
  '/secretary/dashboard': 'Dashboard',
  '/treasurer/dashboard': 'Dashboard',
  '/activity-log': 'Activity Log',
  '/calendar': 'Event Calendar',
  '/contacts': 'Contact Manager',
  '/homeowners': 'Homeowners',
  '/overdue-accounts': 'Overdue Accounts',
  '/documents': 'Document Library',
  '/secretary/payables': 'Payables & Collections',
  '/ledger': 'Ledger',
  '/treasurer/service-revenue': 'Amenity Revenue',
  '/payments': 'Payments',
  '/treasurer/expenses': 'Expenses',
  '/secretary/services': 'Services',
  '/reports': 'Reports',
  '/secretary/receipts': 'Official Receipts',
  '/system-settings': 'System Settings',
}

function pageLabelFor(pathname) {
  if (PAGE_LABELS[pathname]) return PAGE_LABELS[pathname]
  const match = Object.keys(PAGE_LABELS).find((path) => pathname.startsWith(path))
  return match ? PAGE_LABELS[match] : 'Dashboard'
}

export default function Navbar({ user, onLogout, hasNotifications = false }) {
  const { organization } = useOrganization()
  const location = useLocation()
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)

  const roleLabel = user?.role
    ? user.role.charAt(0).toUpperCase() + user.role.slice(1).toLowerCase()
    : 'Staff'
  const pageLabel = pageLabelFor(location.pathname)

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
            <span className="breadcrumb-item">{roleLabel}</span>
            <span className="breadcrumb-sep">›</span>
            <span className="breadcrumb-active">{pageLabel}</span>
          </div>
        </div>

        <div className="navbar-right">
          <label className="navbar-search">
            <Search size={16} />
            <input type="search" placeholder="Search anything..." aria-label="Search" />
          </label>

          <button className="icon-btn" title="Notifications">
            <Bell size={19} />
            {hasNotifications && <span className="icon-btn-dot" aria-hidden="true" />}
          </button>

          <button className="navbar-signout" onClick={handleLogoutClick}>
            <LogOut size={15} />
            <span>Sign Out</span>
          </button>
        </div>
      </nav>

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="modal-overlay" onClick={handleCancelLogout}>
          <div className="logout-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Confirm Logout</h2>
              <button className="modal-close" onClick={handleCancelLogout} aria-label="Close">
                ×
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