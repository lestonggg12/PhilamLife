import React, { useState } from 'react'
import './SystemSettingsPage.css'
import { Settings, Bell, Lock, HardDrive, Check } from '../components/Icons'

export default function SystemSettingsPage() {
  const [activeTab, setActiveTab] = useState('general')
  const [saved, setSaved] = useState(false)

  const [general, setGeneral] = useState({
    hoaName: 'PHILAM Village',
    address: 'Cagayan de Oro City, Philippines',
    contactEmail: 'admin@philamvillage.hoa',
    contactPhone: '(088) 123-4567',
    duesAmount: '5000',
    dueDay: '5',
  })

  const [notifications, setNotifications] = useState({
    emailOnPayment: true,
    emailOnOverdue: true,
    smsReminders: false,
    weeklyDigest: true,
  })

  const [security, setSecurity] = useState({
    requireStrongPassword: true,
    sessionTimeout: '30',
    twoFactor: false,
  })

  const handleSave = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const tabs = [
    { id: 'general', label: 'General', icon: Settings },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'security', label: 'Security', icon: Lock },
    { id: 'backup', label: 'Backup & Data', icon: HardDrive },
  ]

  return (
    <div className="ss-page">
      <div className="ss-header">
        <h1>System Settings</h1>
        <p>Configure organization details, notifications, and security preferences.</p>
      </div>

      <div className="ss-layout">
        {/* Tabs */}
        <div className="ss-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`ss-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <tab.icon size={18} />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="ss-content glass-card">
          {activeTab === 'general' && (
            <div className="ss-section">
              <h3>Organization Details</h3>
              <div className="ss-field">
                <label>HOA Name</label>
                <input value={general.hoaName} onChange={(e) => setGeneral({ ...general, hoaName: e.target.value })} />
              </div>
              <div className="ss-field">
                <label>Address</label>
                <input value={general.address} onChange={(e) => setGeneral({ ...general, address: e.target.value })} />
              </div>
              <div className="ss-row">
                <div className="ss-field">
                  <label>Contact Email</label>
                  <input value={general.contactEmail} onChange={(e) => setGeneral({ ...general, contactEmail: e.target.value })} />
                </div>
                <div className="ss-field">
                  <label>Contact Phone</label>
                  <input value={general.contactPhone} onChange={(e) => setGeneral({ ...general, contactPhone: e.target.value })} />
                </div>
              </div>

              <h3>Dues Configuration</h3>
              <div className="ss-row">
                <div className="ss-field">
                  <label>Monthly Dues Amount (₱)</label>
                  <input type="number" value={general.duesAmount} onChange={(e) => setGeneral({ ...general, duesAmount: e.target.value })} />
                </div>
                <div className="ss-field">
                  <label>Due Day of Month</label>
                  <input type="number" min="1" max="31" value={general.dueDay} onChange={(e) => setGeneral({ ...general, dueDay: e.target.value })} />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="ss-section">
              <h3>Email & SMS Notifications</h3>
              <ToggleRow
                label="Payment confirmations"
                desc="Notify homeowners by email when a payment is recorded"
                checked={notifications.emailOnPayment}
                onChange={(v) => setNotifications({ ...notifications, emailOnPayment: v })}
              />
              <ToggleRow
                label="Overdue alerts"
                desc="Notify homeowners by email when dues become overdue"
                checked={notifications.emailOnOverdue}
                onChange={(v) => setNotifications({ ...notifications, emailOnOverdue: v })}
              />
              <ToggleRow
                label="SMS reminders"
                desc="Send SMS reminders 3 days before due date"
                checked={notifications.smsReminders}
                onChange={(v) => setNotifications({ ...notifications, smsReminders: v })}
              />
              <ToggleRow
                label="Weekly digest"
                desc="Send admins a weekly summary of collections and activity"
                checked={notifications.weeklyDigest}
                onChange={(v) => setNotifications({ ...notifications, weeklyDigest: v })}
              />
            </div>
          )}

          {activeTab === 'security' && (
            <div className="ss-section">
              <h3>Account Security</h3>
              <ToggleRow
                label="Require strong passwords"
                desc="Enforce minimum 8 characters, uppercase, number, and symbol"
                checked={security.requireStrongPassword}
                onChange={(v) => setSecurity({ ...security, requireStrongPassword: v })}
              />
              <ToggleRow
                label="Two-factor authentication"
                desc="Require a verification code at login for all Admin accounts"
                checked={security.twoFactor}
                onChange={(v) => setSecurity({ ...security, twoFactor: v })}
              />
              <div className="ss-field">
                <label>Session Timeout (minutes)</label>
                <input
                  type="number"
                  value={security.sessionTimeout}
                  onChange={(e) => setSecurity({ ...security, sessionTimeout: e.target.value })}
                  style={{ maxWidth: '160px' }}
                />
              </div>
            </div>
          )}

          {activeTab === 'backup' && (
            <div className="ss-section">
              <h3>Data Backup</h3>
              <p className="ss-desc">Export a full backup of ledger, payments, and homeowner records.</p>
              <div className="ss-backup-actions">
                <button className="btn btn-primary">Download Full Backup</button>
                <button className="btn btn-secondary">Export Ledger (CSV)</button>
              </div>

              <h3 style={{ marginTop: '28px' }}>Backup History</h3>
              <div className="ss-backup-list">
                <div className="ss-backup-row">
                  <span>Full backup</span>
                  <span className="ss-backup-date">Jul 15, 2026</span>
                </div>
                <div className="ss-backup-row">
                  <span>Full backup</span>
                  <span className="ss-backup-date">Jul 1, 2026</span>
                </div>
                <div className="ss-backup-row">
                  <span>Full backup</span>
                  <span className="ss-backup-date">Jun 15, 2026</span>
                </div>
              </div>
            </div>
          )}

          <div className="ss-save-bar">
            <button className="btn btn-primary" onClick={handleSave}>
              {saved ? <><Check size={16} /> Saved</> : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ToggleRow({ label, desc, checked, onChange }) {
  return (
    <div className="ss-toggle-row">
      <div>
        <p className="ss-toggle-label">{label}</p>
        <p className="ss-toggle-desc">{desc}</p>
      </div>
      <button
        className={`ss-switch ${checked ? 'on' : ''}`}
        onClick={() => onChange(!checked)}
        type="button"
      >
        <span className="ss-switch-knob"></span>
      </button>
    </div>
  )
}