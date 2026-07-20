import React from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Navbar from './Navbar'
import './Layout.css'

export default function Layout({ user, onLogout }) {
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
