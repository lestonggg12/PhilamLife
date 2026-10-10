import React, { useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Navbar from './Navbar'
import ActionDialog from './ActionDialog'
import { useOrganization } from '../context/OrganizationContext'
import useSessionTimeout from '../hooks/useSessionTimeout'
import './Layout.css'

export default function Layout({ user, onLogout }) {
  const { organization } = useOrganization()
  const location = useLocation()
  const [timedOut, setTimedOut] = useState(false)
  const [navOpen, setNavOpen] = useState(false)

  const handleTimeout = useCallback(() => {
    setTimedOut(true)
  }, [])

  const toggleNav = useCallback(() => setNavOpen((open) => !open), [])
  const closeNav = useCallback(() => setNavOpen(false), [])

  useSessionTimeout(organization.sessionTimeoutMinutes, handleTimeout)

  // Close the drawer after navigating.
  useEffect(() => {
    setNavOpen(false)
  }, [location.pathname])

  // Escape closes the drawer; lock page scroll while it is open.
  useEffect(() => {
    document.body.classList.toggle('nav-locked', navOpen)
    if (!navOpen) return undefined

    const onKeyDown = (event) => {
      if (event.key === 'Escape') setNavOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.classList.remove('nav-locked')
    }
  }, [navOpen])

  return (
    <div className="layout">
      <Navbar
        user={user}
        onLogout={onLogout}
        menuOpen={navOpen}
        onMenuToggle={toggleNav}
      />
      <div className="layout-container">
        <Sidebar
          user={user}
          onLogout={onLogout}
          open={navOpen}
          onNavigate={closeNav}
        />
        <div
          className={`nav-backdrop${navOpen ? ' show' : ''}`}
          onClick={closeNav}
          aria-hidden="true"
        />

        <ActionDialog
          open={timedOut}
          title="Signed Out"
          message="You've been signed out due to inactivity. Please sign in again."
          onConfirm={() => {
            setTimedOut(false)
            onLogout()
          }}
        />
        <div className="page-content">
          <Outlet />
        </div>
      </div>
    </div>
  )
}