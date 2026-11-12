import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import './Navbar.css'
import NotificationBell from './NotificationBell'
import { LogOut, Menu } from './Icons'
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
  '/ledger': 'Ledger',
  '/secretary/grievances': 'Grievances',
  '/treasurer/service-revenue': 'Amenity Revenue',
  '/payments': 'Payments',
  '/bank-deposits': 'Bank Deposits',
  '/treasurer/expenses': 'Expenses',
  '/secretary/services': 'Services',
  '/reports': 'Reports',
  '/secretary/reports': 'Reports',
  '/treasurer/reports': 'Reports',
  '/secretary/receipts': 'Official Receipts',
  '/system-settings': 'System Settings',
}

function pageLabelFor(pathname) {
  if (PAGE_LABELS[pathname]) return PAGE_LABELS[pathname]
  const match = Object.keys(PAGE_LABELS).find((path) => pathname.startsWith(path))
  return match ? PAGE_LABELS[match] : 'Dashboard'
}

export default function Navbar({ user, onLogout, menuOpen = false, onMenuToggle }) {
  const { organization } = useOrganization()
  const location = useLocation()
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const dialogRef = useRef(null)
  const cancelRef = useRef(null)
  const logoutBusyRef = useRef(false)

  useEffect(() => {
    if (!showLogoutConfirm) return
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    cancelRef.current?.focus()

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!logoutBusyRef.current) setShowLogoutConfirm(false)
      }
      if (event.key !== 'Tab') return
      const buttons = [...(dialogRef.current?.querySelectorAll('button:not(:disabled)') || [])]
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      if (!first) { event.preventDefault(); return }
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [showLogoutConfirm])

  const roleLabel = user?.role
    ? user.role.charAt(0).toUpperCase() + user.role.slice(1).toLowerCase()
    : 'Staff'
  const pageLabel = pageLabelFor(location.pathname)

  const displayName = user?.full_name?.trim() || user?.email || `${roleLabel} account`
  const initials = displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()

  const handleLogoutClick = () => {
    setLogoutError('')
    setShowLogoutConfirm(true)
  }

  const handleConfirmLogout = async () => {
    if (logoutBusyRef.current || !onLogout) return
    logoutBusyRef.current = true
    setLoggingOut(true)
    setLogoutError('')
    try {
      await onLogout()
      setShowLogoutConfirm(false)
    } catch {
      setLogoutError('Unable to sign out. Please try again.')
    } finally {
      logoutBusyRef.current = false
      setLoggingOut(false)
    }
  }

  const handleCancelLogout = () => {
    if (!logoutBusyRef.current) setShowLogoutConfirm(false)
  }

  return (
    <>
      <nav className="navbar">
        <div className="navbar-left">
          <button
            type="button"
            className="navbar-menu"
            onClick={onMenuToggle}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            <Menu size={22} />
          </button>
          <div className="breadcrumb">
            <span className="breadcrumb-item">{roleLabel}</span>
            <span className="breadcrumb-sep">›</span>
            <span className="breadcrumb-active">{pageLabel}</span>
          </div>
        </div>

        <div className="navbar-right">
          <NotificationBell user={user} />
          <button type="button" className="navbar-signout" onClick={handleLogoutClick}>
            <LogOut size={15} />
            <span>Sign Out</span>
          </button>
        </div>
      </nav>

      {showLogoutConfirm && createPortal(
        <div className="navbar-logout-overlay" onClick={(event) => {
          if (event.target === event.currentTarget) handleCancelLogout()
        }}>
          <section
            className="navbar-logout-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="navbar-logout-title"
            aria-describedby="navbar-logout-description"
            aria-busy={loggingOut}
            ref={dialogRef}
            tabIndex={-1}
          >
            <button type="button" className="navbar-logout-close" onClick={handleCancelLogout}
              disabled={loggingOut} aria-label="Close sign-out confirmation">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
            <header className="navbar-logout-heading">
              <span className="navbar-logout-icon" aria-hidden="true"><LogOut size={28} /></span>
              <div>
                <p className="navbar-logout-brand">{organization.hoaName}</p>
                <h2 id="navbar-logout-title">Sign out of your account?</h2>
              </div>
            </header>
            <div className="navbar-logout-content">
              <p id="navbar-logout-description" className="navbar-logout-message">
                You’re about to leave the {roleLabel} portal. You can sign in again anytime.
              </p>
              <div className="navbar-logout-account">
                <span className="navbar-logout-avatar" aria-hidden="true">{initials}</span>
                <div className="navbar-logout-account-copy">
                  <strong>{displayName}</strong>
                  <span>{roleLabel} portal</span>
                </div>
                <span className="navbar-logout-session">Signed in</span>
              </div>
              {logoutError && <p className="navbar-logout-error" role="alert">{logoutError}</p>}
            </div>
            <footer className="navbar-logout-actions">
              <button type="button" ref={cancelRef} className="navbar-logout-cancel"
                onClick={handleCancelLogout} disabled={loggingOut}>Keep me signed in</button>
              <button type="button" className="navbar-logout-confirm" onClick={handleConfirmLogout}
                disabled={loggingOut || !onLogout}>
                <span aria-hidden="true"><LogOut size={16} /></span>
                <span aria-live="polite">{loggingOut ? 'Signing out…' : 'Sign out'}</span>
              </button>
            </footer>
          </section>
        </div>, document.body
      )}
    </>
  )
}
