import React, { useCallback, useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Navbar from './Navbar'
import ActionDialog from './ActionDialog'
import { useOrganization } from '../context/OrganizationContext'
import useSessionTimeout from '../hooks/useSessionTimeout'
import './Layout.css'

export default function Layout({ user, onLogout }) {
  const { organization } = useOrganization()
  const [timedOut, setTimedOut] = useState(false)

  const handleTimeout = useCallback(() => {
    setTimedOut(true)
  }, [])

  useSessionTimeout(organization.sessionTimeoutMinutes, handleTimeout)

  return (
    <div className="layout">
      <Navbar user={user} onLogout={onLogout} />
      <div className="layout-container">
        <Sidebar user={user} onLogout={onLogout} />

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