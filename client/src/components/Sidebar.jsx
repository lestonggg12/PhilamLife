import React, { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { BarChart3, CreditCard, FileText, DollarSign, Home, Settings, Activity } from './Icons'
import './Sidebar.css'

export default function Sidebar({ user, onLogout }) {
  const dashboardPath = user?.role === 'admin'
    ? '/admin/dashboard'
    : user?.role === 'treasurer'
    ? '/treasurer/dashboard'
    : '/secretary/dashboard'

  const overviewItems = [
    { name: 'Dashboard', path: dashboardPath, icon: BarChart3 },
    { name: 'Activity Log', path: '/activity-log', icon: Activity },
  ]

  const financeItems = [
    { name: 'Ledger', path: '/ledger', icon: FileText },
    { name: 'Payments', path: '/payments', icon: CreditCard },
    { name: 'Services', path: '/secretary/services', icon: DollarSign },
    { name: 'Reports', path: '/reports', icon: BarChart3 },
  ]

  const systemItems = [
    { name: 'System Settings', path: '/system-settings', icon: Settings },
  ]

  // ...rest unchanged

  const renderNavItems = (items) =>
    items.map((item) => (
      <NavLink
        key={item.path}
        to={item.path}
        end={item.path === '/' || item.path.endsWith('/dashboard')}
        className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
      >
        <span className="nav-icon"><item.icon size={18} /></span>
        <span className="nav-text">{item.name}</span>
      </NavLink>
    ))

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo">
          <Home size={20} />
          <span className="logo-text">PHILAM Village</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section">
          <h3 className="nav-section-title">OVERVIEW</h3>
          <div className="nav-items">{renderNavItems(overviewItems)}</div>
        </div>

        <div className="nav-section">
          <h3 className="nav-section-title">FINANCE</h3>
          <div className="nav-items">{renderNavItems(financeItems)}</div>
        </div>

        <div className="nav-section">
          <h3 className="nav-section-title">SYSTEM</h3>
          <div className="nav-items">{renderNavItems(systemItems)}</div>
        </div>
      </nav>

      <div className="sidebar-footer">
        <div className="user-section">
          <div className="user-avatar">
            {user?.email?.charAt(0).toUpperCase() || 'U'}
          </div>
          <div className="user-info">
            <div className="user-name">User</div>
            <div className="user-role">{user?.role || 'Admin'}</div>
          </div>
        </div>
        <button className="logout-btn" onClick={onLogout}>
          Logout
        </button>
      </div>
    </aside>
  )
}