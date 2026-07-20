import React, { useState } from 'react'
import './TreasurerDashboard.css'
import { DollarSign, TrendingUp, CreditCard, AlertCircle, CheckCircle, Bank } from '../components/Icons'

export default function TreasurerDashboard() {
  const [actionsOpen, setActionsOpen] = useState(true)

  return (
    <div className="treas-treasurer-dashboard">
      <div className="treas-page-header">
        <h1 className="treas-page-title">Treasurer Dashboard</h1>
        <p className="treas-page-subtitle">Manage financial accounts, payments, and collections.</p>
      </div>

      {/* Stats Grid */}
      <div className="treas-stats-grid">
        <div className="treas-stat-card">
          <div className="treas-stat-top">
            <span className="treas-stat-label">Total Collections</span>
            <div className="treas-stat-icon-box">
              <DollarSign size={18} />
            </div>
          </div>
          <h3 className="treas-stat-value">₱8.2M</h3>
          <div className="treas-stat-footer">
            <TrendingUp size={12} />
            <span>+₱450K this month</span>
          </div>
        </div>

        <div className="treas-stat-card">
          <div className="treas-stat-top">
            <span className="treas-stat-label">Pending Payments</span>
            <div className="treas-stat-icon-box" style={{ background: 'rgba(212, 146, 10, 0.12)', color: '#d49206' }}>
              <CreditCard size={18} />
            </div>
          </div>
          <h3 className="treas-stat-value">₱980K</h3>
          <div className="treas-stat-footer">
            <AlertCircle size={12} />
            <span>From 45 accounts</span>
          </div>
        </div>

        <div className="treas-stat-card">
          <div className="treas-stat-top">
            <span className="treas-stat-label">Collection Rate</span>
            <div className="treas-stat-icon-box" style={{ background: 'rgba(26, 138, 96, 0.12)', color: '#1a8a60' }}>
              <CheckCircle size={18} />
            </div>
          </div>
          <h3 className="treas-stat-value">94.2%</h3>
          <div className="treas-stat-footer">
            <TrendingUp size={12} />
            <span>Excellent performance</span>
          </div>
        </div>

        <div className="treas-stat-card">
          <div className="treas-stat-top">
            <span className="treas-stat-label">Bank Balance</span>
            <div className="treas-stat-icon-box" style={{ background: 'rgba(20, 100, 160, 0.12)', color: '#1464a0' }}>
              <Bank size={18} />
            </div>
          </div>
          <h3 className="treas-stat-value">₱3.5M</h3>
          <div className="treas-stat-footer">
            <CheckCircle size={12} />
            <span>Main account</span>
          </div>
        </div>
      </div>

      {/* Bottom Grid - Transactions & Account Summary */}
      <div className="treas-bottom-grid">
        <div className="treas-transactions-panel">
          <h3 className="treas-section-title">Recent Transactions</h3>

          <div className="treas-transaction-row">
            <div className="treas-transaction-icon" style={{ background: 'rgba(26, 138, 96, 0.12)', color: '#1a8a60' }}>↓</div>
            <div className="treas-transaction-content">
              <p className="treas-transaction-title">Collection Deposit</p>
              <p className="treas-transaction-detail">Block A & B collections</p>
            </div>
            <div className="treas-transaction-amount">+ ₱125,000</div>
          </div>

          <div className="treas-transaction-row">
            <div className="treas-transaction-icon" style={{ background: 'rgba(212, 146, 10, 0.12)', color: '#d49206' }}>↑</div>
            <div className="treas-transaction-content">
              <p className="treas-transaction-title">Maintenance Payment</p>
              <p className="treas-transaction-detail">Monthly facility upkeep</p>
            </div>
            <div className="treas-transaction-amount negative">- ₱45,000</div>
          </div>

          <div className="treas-transaction-row">
            <div className="treas-transaction-icon" style={{ background: 'rgba(26, 138, 96, 0.12)', color: '#1a8a60' }}>↓</div>
            <div className="treas-transaction-content">
              <p className="treas-transaction-title">Collection Deposit</p>
              <p className="treas-transaction-detail">Block C collections</p>
            </div>
            <div className="treas-transaction-amount">+ ₱98,500</div>
          </div>
        </div>

        <div className="treas-accounts-panel">
          <h3 className="treas-section-title">Account Summary</h3>

          <div className="treas-account-item">
            <span className="treas-account-icon">🏦</span>
            <div className="treas-account-info">
              <p className="treas-account-title">Main Account</p>
              <p className="treas-account-detail">₱3.5M</p>
            </div>
          </div>

          <div className="treas-account-item">
            <span className="treas-account-icon">💰</span>
            <div className="treas-account-info">
              <p className="treas-account-title">Collections Account</p>
              <p className="treas-account-detail">₱2.1M</p>
            </div>
          </div>

          <div className="treas-account-item">
            <span className="treas-account-icon">📊</span>
            <div className="treas-account-info">
              <p className="treas-account-title">Reserve Fund</p>
              <p className="treas-account-detail">₱2.6M</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
