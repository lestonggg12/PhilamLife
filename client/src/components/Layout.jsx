
import React, { useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Navbar from './Navbar'
import './Layout.css'

export default function Layout({ user, onLogout }) {
  const location = useLocation()
  const [navOpen, setNavOpen] = useState(false)


  const toggleNav = useCallback(() => {
    setNavOpen((open) => !open)
  }, [])

  const closeNav = useCallback(() => {
    setNavOpen(false)
  }, [])


  // Close the drawer after navigating.
  useEffect(() => {
    setNavOpen(false)
  }, [location.pathname])

  // Escape closes the drawer; lock page scroll while it is open.
  useEffect(() => {
    document.body.classList.toggle('nav-locked', navOpen)

    if (!navOpen) return undefined

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setNavOpen(false)
      }
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


        <div className="page-content">
          {/* State-only replacements must preserve page state, including payment prefill. */}
          <div className="motion-page-enter" key={location.pathname}>
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  )
}
