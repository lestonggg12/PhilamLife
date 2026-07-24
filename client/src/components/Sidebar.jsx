import React from 'react'
import { NavLink } from 'react-router-dom'
import { BarChart3, CreditCard, FileText, DollarSign, Home, Settings, Activity, Users, Zap } from './Icons'
import './Sidebar.css'

export default function Sidebar({ user, onLogout }) {
  const role = user?.role?.trim().toLowerCase()

  const dashboardPath = role === 'admin'
    ? '/admin/dashboard'
    : role === 'treasurer'
    ? '/treasurer/dashboard'
    : '/secretary/dashboard'

  const overviewItems = [
    {
      name: 'Dashboard',
      path: dashboardPath,
      icon: BarChart3,
      roles: ['admin', 'treasurer', 'secretary'],
    },
    {
      name: 'Activity Log',
      path: '/activity-log',
      icon: Activity,
      roles: ['admin', 'secretary'],
    },
  ].filter((item) => item.roles.includes(role))

  const financeItems = [
    {
      name: 'Payables & Collections',
      path: '/secretary/payables',
      icon: Users,
      roles: ['treasurer'],
    },
    {
      name: 'Ledger',
      path: '/ledger',
      icon: FileText,
      roles: ['admin', 'treasurer', 'secretary'],
    },
    {
  
      name: 'Amenity Revenue',
      path: '/treasurer/service-revenue',
      icon: Zap,
      roles: ['treasurer'],
    },
    {
      name: 'Payments',
      path: '/payments',
      icon: CreditCard,
      roles: ['treasurer', 'secretary'],
    },
    {
      name: 'Expenses',
      path: '/treasurer/expenses',
      icon: DollarSign,
      roles: ['treasurer'],
    },
    {
      name: 'Services',
      path: '/secretary/services',
      icon: DollarSign,
      roles: ['secretary'],
    },
    {
      name: 'Reports',
      path: '/reports',
      icon: BarChart3,
      roles: ['admin', 'treasurer'],
    },
    {
      name: 'Official Receipts',
      path: '/secretary/receipts',
      icon: FileText,
      roles: ['secretary'],
    },
  ].filter((item) => item.roles.includes(role))

  const systemItems = [
    {
      name: 'System Settings',
      path: '/system-settings',
      icon: Settings,
      roles: ['admin'],
    },
  ].filter((item) => item.roles.includes(role))

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

        {financeItems.length > 0 && (
          <div className="nav-section">
            <h3 className="nav-section-title">FINANCE</h3>
            <div className="nav-items">{renderNavItems(financeItems)}</div>
          </div>
        )}

        {systemItems.length > 0 && (
          <div className="nav-section">
            <h3 className="nav-section-title">SYSTEM</h3>
            <div className="nav-items">{renderNavItems(systemItems)}</div>
          </div>
        )}
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