import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import './SystemSettingsPage.css'

const TABLES = [
  'activity_log',
  'blocks',
  'expenses',
  'payments',
  'profiles',
  'properties',
  'system_settings',
  'user_management_logs',
]

const EXPORTS = [
  { table: 'payments', label: 'Payments', description: 'Payment records, balances, and receipt details' },
  { table: 'expenses', label: 'Expenses', description: 'Recorded HOA expenses and references' },
  { table: 'properties', label: 'Properties', description: 'Blocks, lots, and homeowner records' },
  { table: 'profiles', label: 'User Profiles', description: 'System users, roles, and account status' },
  { table: 'activity_log', label: 'Activity Log', description: 'Recorded actions in the system' },
]

const DEFAULT_SETTINGS = {
  hoa_name: 'PHILAM Village',
  address: 'Cagayan de Oro City, Philippines',
  contact_email: '',
  contact_phone: '',
  dues_amount: '5000',
  due_day: '5',
  grace_period_days: '0',
  late_penalty: '0',
  email_on_payment: true,
  email_on_overdue: true,
  sms_reminders: false,
  weekly_digest: true,
  reminder_days_before: '3',
  require_strong_password: true,
  session_timeout: '30',
  two_factor: false,
  currency: 'PHP',
  timezone: 'Asia/Manila',
  date_format: 'MM/DD/YYYY',
}

const HISTORY_KEY = 'philam_settings_export_history'

function Icon({ name, size = 18 }) {
  const paths = {
    general: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21h-4v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1v4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
    notifications: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
    security: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    backup: <><path d="M4 5h16v14H4z" /><path d="M8 9h8M8 13h5" /></>,
    download: <><path d="M12 3v12m-4-4 4 4 4-4" /><path d="M5 19h14" /></>,
    check: <path d="m5 12 4 4L19 6" />,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function readHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') } catch { return [] }
}

function csvCell(value) {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

function rowsToCsv(rows) {
  if (!rows.length) return ''
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  return [columns.map(csvCell).join(','), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(','))].join('\r\n')
}

function downloadFile(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function stamp() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export default function SystemSettingsPage({ user }) {
  const [activeTab, setActiveTab] = useState('general')
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState('')
  const [message, setMessage] = useState(null)
  const [history, setHistory] = useState(readHistory)

  const tabs = useMemo(() => [
    ['general', 'General'],
    ['notifications', 'Notifications'],
    ['security', 'Security'],
    ['backup', 'Backup & Data'],
  ], [])

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase.from('system_settings').select('*').eq('id', 1).single()
      if (error) setMessage({ type: 'error', text: `Unable to load settings: ${error.message}` })
      else setSettings({ ...DEFAULT_SETTINGS, ...data, dues_amount: String(data.dues_amount), due_day: String(data.due_day), grace_period_days: String(data.grace_period_days), late_penalty: String(data.late_penalty), reminder_days_before: String(data.reminder_days_before), session_timeout: String(data.session_timeout) })
      setLoading(false)
    }
    load()
  }, [])

  function update(field, value) {
    setSettings((current) => ({ ...current, [field]: value }))
    if (message?.type === 'success') setMessage(null)
  }

  function validate() {
    if (!settings.hoa_name.trim()) return 'HOA name is required.'
    if (!settings.address.trim()) return 'Address is required.'
    if (settings.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.contact_email)) return 'Enter a valid contact email.'
    if (Number(settings.dues_amount) < 0) return 'Monthly dues cannot be negative.'
    if (!Number.isInteger(Number(settings.due_day)) || Number(settings.due_day) < 1 || Number(settings.due_day) > 31) return 'Due day must be from 1 to 31.'
    if (Number(settings.grace_period_days) < 0 || Number(settings.late_penalty) < 0 || Number(settings.reminder_days_before) < 0) return 'Days and penalty values cannot be negative.'
    if (Number(settings.session_timeout) < 5 || Number(settings.session_timeout) > 1440) return 'Session timeout must be from 5 to 1,440 minutes.'
    return ''
  }

  async function saveSettings() {
    const errorText = validate()
    if (errorText) return setMessage({ type: 'error', text: errorText })
    setSaving(true)
    setMessage(null)
    const payload = {
      ...settings,
      contact_email: settings.contact_email.trim() || null,
      contact_phone: settings.contact_phone.trim() || null,
      dues_amount: Number(settings.dues_amount),
      due_day: Number(settings.due_day),
      grace_period_days: Number(settings.grace_period_days),
      late_penalty: Number(settings.late_penalty),
      reminder_days_before: Number(settings.reminder_days_before),
      session_timeout: Number(settings.session_timeout),
    }
    delete payload.id
    delete payload.updated_at
    delete payload.updated_by
    const { error } = await supabase.from('system_settings').update(payload).eq('id', 1)
    setSaving(false)
    setMessage(error ? { type: 'error', text: `Unable to save settings: ${error.message}` } : { type: 'success', text: 'System settings saved successfully.' })
  }

  function recordExport(label, filename) {
    const next = [{ label, filename, by: user?.full_name || user?.email || 'Administrator', at: new Date().toISOString() }, ...history].slice(0, 8)
    setHistory(next)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  }

  async function exportTable(table, label) {
    setExporting(table)
    setMessage(null)
    const { data, error } = await supabase.from(table).select('*')
    if (error) setMessage({ type: 'error', text: `Unable to export ${label}: ${error.message}` })
    else {
      const filename = `${table}-${stamp()}.csv`
      downloadFile('\uFEFF' + rowsToCsv(data || []), filename, 'text/csv;charset=utf-8')
      recordExport(`${label} CSV`, filename)
      setMessage({ type: 'success', text: `${label} export downloaded.` })
    }
    setExporting('')
  }

  async function exportLedger() {
    setExporting('ledger')
    setMessage(null)
    const [payments, expenses] = await Promise.all([supabase.from('payments').select('*'), supabase.from('expenses').select('*')])
    const error = payments.error || expenses.error
    if (error) setMessage({ type: 'error', text: `Unable to export ledger: ${error.message}` })
    else {
      const rows = [
        ...(payments.data || []).map((row) => ({ transaction_type: 'Payment', transaction_date: row.paid_at || row.payment_date || row.created_at, description: `${row.homeowner_name || ''} ${row.coverage_period || ''}`.trim(), amount: row.amount_paid ?? row.amount, reference_number: row.receipt_number || row.reference_number, recorded_by: row.recorded_by_name, ...row })),
        ...(expenses.data || []).map((row) => ({ transaction_type: 'Expense', transaction_date: row.expense_date || row.created_at, description: row.description, amount: row.amount, reference_number: row.reference_number, recorded_by: row.recorded_by_name, ...row })),
      ].sort((a, b) => String(b.transaction_date || '').localeCompare(String(a.transaction_date || '')))
      const filename = `combined-ledger-${stamp()}.csv`
      downloadFile('\uFEFF' + rowsToCsv(rows), filename, 'text/csv;charset=utf-8')
      recordExport('Combined Ledger CSV', filename)
      setMessage({ type: 'success', text: 'Combined ledger downloaded.' })
    }
    setExporting('')
  }

  async function exportAll() {
    setExporting('all')
    setMessage(null)
    const results = await Promise.all(TABLES.map(async (table) => ({ table, result: await supabase.from(table).select('*') })))
    const failed = results.find(({ result }) => result.error)
    if (failed) setMessage({ type: 'error', text: `Unable to export ${failed.table}: ${failed.result.error.message}` })
    else {
      const payload = { exported_at: new Date().toISOString(), timezone: 'Asia/Manila', exported_by: user?.email || user?.full_name || null, tables: Object.fromEntries(results.map(({ table, result }) => [table, result.data || []])) }
      const filename = `philam-system-data-${stamp()}.json`
      downloadFile(JSON.stringify(payload, null, 2), filename, 'application/json;charset=utf-8')
      recordExport('Full System Data JSON', filename)
      setMessage({ type: 'success', text: 'Full system data export downloaded.' })
    }
    setExporting('')
  }

  if (loading) return <div className="ss-page"><div className="ss-loading">Loading system settings…</div></div>

  return (
    <div className="ss-page">
      <header className="ss-header">
        <div><h1>System Settings</h1><p>Manage organization, billing, notification, security, and data preferences.</p></div>
        <span className="ss-admin-badge">Admin access</span>
      </header>

      <nav className="ss-tabs" aria-label="Settings sections">
        {tabs.map(([id, label]) => <button key={id} type="button" className={activeTab === id ? 'active' : ''} onClick={() => { setActiveTab(id); setMessage(null) }}><Icon name={id} />{label}</button>)}
      </nav>

      {message && <div className={`ss-message ${message.type}`} role="status">{message.type === 'success' && <Icon name="check" />}{message.text}</div>}

      {activeTab === 'general' && <div className="ss-card-grid">
        <SettingsCard title="Organization details" subtitle="Information shown across the HOA system.">
          <Field label="HOA Name" value={settings.hoa_name} onChange={(v) => update('hoa_name', v)} wide />
          <Field label="Address" value={settings.address} onChange={(v) => update('address', v)} wide />
          <Field label="Contact Email" type="email" value={settings.contact_email || ''} onChange={(v) => update('contact_email', v)} />
          <Field label="Contact Phone" value={settings.contact_phone || ''} onChange={(v) => update('contact_phone', v)} />
        </SettingsCard>
        <SettingsCard title="Billing configuration" subtitle="Default dues and overdue-payment rules.">
          <Field label="Monthly Dues Amount (₱)" type="number" min="0" step="0.01" value={settings.dues_amount} onChange={(v) => update('dues_amount', v)} />
          <Field label="Due Day of Month" type="number" min="1" max="31" value={settings.due_day} onChange={(v) => update('due_day', v)} />
          <Field label="Grace Period (days)" type="number" min="0" value={settings.grace_period_days} onChange={(v) => update('grace_period_days', v)} />
          <Field label="Late-Payment Penalty (₱)" type="number" min="0" step="0.01" value={settings.late_penalty} onChange={(v) => update('late_penalty', v)} />
        </SettingsCard>
        <SettingsCard title="System preferences" subtitle="Regional display defaults." full>
          <SelectField label="Currency" value={settings.currency} onChange={(v) => update('currency', v)} options={[['PHP', 'Philippine Peso (₱)']]} />
          <SelectField label="Time Zone" value={settings.timezone} onChange={(v) => update('timezone', v)} options={[['Asia/Manila', 'Asia/Manila']]} />
          <SelectField label="Date Format" value={settings.date_format} onChange={(v) => update('date_format', v)} options={['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'].map((v) => [v, v])} />
        </SettingsCard>
      </div>}

      {activeTab === 'notifications' && <SettingsCard title="Notification preferences" subtitle="Choose which system notifications should be enabled." full>
        <div className="ss-toggle-list">
          <Toggle label="Payment confirmations" description="Email homeowners after a payment is recorded." checked={settings.email_on_payment} onChange={(v) => update('email_on_payment', v)} />
          <Toggle label="Overdue alerts" description="Email homeowners when their dues become overdue." checked={settings.email_on_overdue} onChange={(v) => update('email_on_overdue', v)} />
          <Toggle label="SMS reminders" description="Enable payment reminders through SMS." checked={settings.sms_reminders} onChange={(v) => update('sms_reminders', v)} />
          <Toggle label="Weekly admin digest" description="Send administrators a weekly collections and activity summary." checked={settings.weekly_digest} onChange={(v) => update('weekly_digest', v)} />
        </div>
        <Field label="Reminder Days Before Due Date" type="number" min="0" value={settings.reminder_days_before} onChange={(v) => update('reminder_days_before', v)} />
        <p className="ss-info">These preferences are saved now. Actual email and SMS delivery requires a notification service.</p>
      </SettingsCard>}

      {activeTab === 'security' && <SettingsCard title="Security preferences" subtitle="Configure account and session policies." full>
        <div className="ss-toggle-list">
          <Toggle label="Require strong passwords" description="Require at least eight characters, uppercase, number, and symbol." checked={settings.require_strong_password} onChange={(v) => update('require_strong_password', v)} />
          <Toggle label="Two-factor authentication" description="Require a verification code for Admin accounts." checked={settings.two_factor} onChange={(v) => update('two_factor', v)} />
        </div>
        <Field label="Session Timeout (minutes)" type="number" min="5" max="1440" value={settings.session_timeout} onChange={(v) => update('session_timeout', v)} />
        <p className="ss-info">These rules are stored as system preferences. Login and session enforcement must also read these values.</p>
      </SettingsCard>}

      {activeTab === 'backup' && <div className="ss-backup-layout">
        <SettingsCard title="Export system data" subtitle="Download the records your Admin account is allowed to read." full>
          <div className="ss-export-feature">
            <div><span className="ss-export-icon"><Icon name="backup" size={22} /></span><div><strong>Full system data</strong><p>All eight public application tables in one JSON file.</p></div></div>
            <button type="button" className="ss-primary" onClick={exportAll} disabled={!!exporting}><Icon name="download" />{exporting === 'all' ? 'Preparing…' : 'Download JSON'}</button>
          </div>
          <div className="ss-export-feature compact">
            <div><span className="ss-export-icon"><Icon name="backup" size={22} /></span><div><strong>Combined ledger</strong><p>Payments and expenses combined in date order.</p></div></div>
            <button type="button" className="ss-secondary" onClick={exportLedger} disabled={!!exporting}>{exporting === 'ledger' ? 'Preparing…' : 'Export CSV'}</button>
          </div>
          <div className="ss-export-grid">
            {EXPORTS.map((item) => <div className="ss-export-item" key={item.table}><div><strong>{item.label}</strong><p>{item.description}</p></div><button type="button" onClick={() => exportTable(item.table, item.label)} disabled={!!exporting}>{exporting === item.table ? 'Preparing…' : 'Export CSV'}</button></div>)}
          </div>
          <p className="ss-info">These downloads are application-data exports, not complete Supabase server backups. Exported rows follow your Row Level Security permissions.</p>
        </SettingsCard>
        <SettingsCard title="Download history" subtitle="Recent exports made in this browser." full>
          {history.length ? <div className="ss-history">{history.map((item, index) => <div key={`${item.at}-${index}`}><span className="ss-history-icon"><Icon name="check" /></span><div><strong>{item.label}</strong><p>{new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(new Date(item.at))} · {item.by}</p></div><span>{item.filename}</span></div>)}</div> : <div className="ss-empty">No exports downloaded from this browser yet.</div>}
        </SettingsCard>
      </div>}

      {activeTab !== 'backup' && <div className="ss-save-bar"><span>Changes apply system-wide after saving.</span><button type="button" className="ss-primary" onClick={saveSettings} disabled={saving}>{saving ? 'Saving…' : <><Icon name="check" />Save Changes</>}</button></div>}
    </div>
  )
}

function SettingsCard({ title, subtitle, children, full = false }) {
  return <section className={`ss-card ${full ? 'full' : ''}`}><div className="ss-card-heading"><h2>{title}</h2><p>{subtitle}</p></div><div className="ss-fields">{children}</div></section>
}

function Field({ label, value, onChange, wide = false, ...props }) {
  return <label className={`ss-field ${wide ? 'wide' : ''}`}><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} {...props} /></label>
}

function SelectField({ label, value, onChange, options }) {
  return <label className="ss-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
}

function Toggle({ label, description, checked, onChange }) {
  return <div className="ss-toggle-row"><div><strong>{label}</strong><p>{description}</p></div><button type="button" role="switch" aria-checked={checked} aria-label={label} className={checked ? 'on' : ''} onClick={() => onChange(!checked)}><span /></button></div>
}