import React from 'react'
import './DashboardPage.css'
import { Home, Users, DollarSign, AlertCircle, FileText, BarChart3, Settings } from '../components/Icons'

export default function DashboardPage() {
  const stats = [
    { label: 'Total Properties', value: '248', icon: Home, color: 'primary' },
    { label: 'Active Homeowners', value: '245', icon: Users, color: 'success' },
    { label: 'Total Collections', value: '₱2.4M', icon: DollarSign, color: 'accent' },
    { label: 'Unpaid Accounts', value: '18', icon: AlertCircle, color: 'danger' },
  ]

  const recentPayments = [
    { id: 1, name: 'John Doe', property: 'Block A, Lot 5', amount: '₱5,000', date: '2024-04-28', status: 'Paid' },
    { id: 2, name: 'Maria Santos', property: 'Block B, Lot 12', amount: '₱3,500', date: '2024-04-27', status: 'Paid' },
    { id: 3, name: 'Carlos Reyes', property: 'Block C, Lot 8', amount: '₱2,000', date: '2024-04-26', status: 'Pending' },
  ]

  return (
    <div className="dashboard">
      {/* Stats Grid */}
      <div className="stats-grid">
        {stats.map((stat, i) => (
          <div key={i} className={`stat-card glass-card stat-${stat.color}`}>
            <div className="stat-icon"><stat.icon size={32} /></div>
            <div className="stat-content">
              <p className="stat-label">{stat.label}</p>
              <p className="stat-value">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Payments */}
      <div className="dashboard-section glass-card">
        <div className="section-header">
          <h2>Recent Payments</h2>
          <button className="btn btn-primary">View All →</button>
        </div>

        <div className="table-responsive">
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>Homeowner</th>
                <th>Property</th>
                <th>Amount</th>
                <th>Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recentPayments.map((payment) => (
                <tr key={payment.id}>
                  <td><strong>{payment.name}</strong></td>
                  <td>{payment.property}</td>
                  <td className="amount">{payment.amount}</td>
                  <td>{payment.date}</td>
                  <td>
                    <span className={`badge badge-${payment.status.toLowerCase()}`}>
                      {payment.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="quick-actions">
        <h3>Quick Actions</h3>
        <div className="actions-grid">
          <button className="action-btn glass-card">
            <FileText size={24} />
            <span className="action-label">Add Homeowner</span>
          </button>
          <button className="action-btn glass-card">
            <FileText size={24} />
            <span className="action-label">Record Payment</span>
          </button>
          <button className="action-btn glass-card">
            <BarChart3 size={24} />
            <span className="action-label">View Reports</span>
          </button>
          <button className="action-btn glass-card">
            <Settings size={24} />
            <span className="action-label">Settings</span>
          </button>
        </div>
      </div>
    </div>
  )
}
