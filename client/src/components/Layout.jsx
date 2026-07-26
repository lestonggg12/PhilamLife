import React, { useCallback } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Navbar from './Navbar'
import { useOrganization } from '../context/OrganizationContext'
import useSessionTimeout from '../hooks/useSessionTimeout'
import './Layout.css'

export default function Layout({ user, onLogout }) {
  const { organization } = useOrganization()

  const handleTimeout = useCallback(() => {
    window.alert(
      "You've been signed out due to inactivity. Please sign in again.",
    )
    onLogout()
  }, [onLogout])

  useSessionTimeout(organization.sessionTimeoutMinutes, handleTimeout)

  return (
    <div className="layout">
      <Navbar user={user} onLogout={onLogout} />
      <div className="layout-container">
        <Sidebar user={user} onLogout={onLogout} />
        <div className="page-content">
          <Outlet />
        </div>
      </div>
    </div>
  )
}