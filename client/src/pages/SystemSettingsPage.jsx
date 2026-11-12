import { saveSystemSettings as persistSystemSettings } from '../lib/saveSystemSettings'
import { buildSystemSettingsPayload } from '../lib/systemSettingsDraft'
import { notifySuccess } from '../lib/actionFeedback'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import Select from '../components/Select'
import { supabase } from '../lib/supabaseClient'
import { fetchTableVerified } from '../lib/fetchAll'
import { ADMIN_EXPORT_TABLES, buildAdminDataExport, requestAdminDataExport } from '../lib/adminDataExport'
import { useOrganization } from '../context/OrganizationContext'
import './SystemSettingsPage.css'
import PricePerSqmForm from '../components/PricePerSqmForm'
import LatePenaltySettings from '../components/LatePenaltySettings'
import ExpenseBudgetSettings from '../components/ExpenseBudgetSettings'
import Skeleton from '../components/skeleton/Skeleton'

const EXPORTS = [
  { table: 'payments', label: 'Payments', description: 'Payment records, balances, and receipt details' },
  { table: 'service_transactions', label: 'Amenity & Service Revenue', description: 'Bookable service transactions and receipts' },
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
  billing_day: '1',
  due_day: '5',
  grace_period_days: '0',
  require_strong_password: true,
  session_timeout: '30',
  currency: 'PHP',
  timezone: 'Asia/Manila',
  date_format: 'MM/DD/YYYY',
}

const EDITABLE_FIELDS = ['hoa_name', 'address', 'contact_email', 'contact_phone', 'billing_day', 'due_day', 'grace_period_days', 'require_strong_password', 'session_timeout', 'currency', 'timezone', 'date_format']

const GENERAL_SECTIONS = [['organization', 'Organization'], ['dues', 'Dues rate'], ['billing', 'Billing rules'], ['regional', 'Regional'], ['penalties', 'Penalties']]

const HISTORY_KEY = 'philam_settings_export_history'

function Icon({ name, size = 18 }) {
  const paths = {
    general: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21h-4v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1v4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
    calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></>,
    budget: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9h10M7 14h10" /></>,
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

  const text =
    typeof value === 'object' ? JSON.stringify(value) : String(value)

  // Neutralize formula-like text without converting ordinary negative
  // numeric values (such as -200.00) into text.
  const startsWithFormula = /^[\u0000-\u0020]*[=+\-@]/.test(text)
  const isNumericValue =
    text.trim() !== '' && Number.isFinite(Number(text))

  const safeText =
    startsWithFormula && !isNumericValue ? `'${text}` : text

  return `"${safeText.replace(/"/g, '""')}"`
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
  const { organization, refreshOrganization } = useOrganization()
  const [activeTab, setActiveTab] = useState('general')
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [savedSettings, setSavedSettings] = useState(null)
  const [activeSection, setActiveSection] = useState('organization')
  const pageRef = useRef(null)
  const canEdit = String(user?.role || '').trim().toLowerCase() === 'admin'
  const dirtyCount = savedSettings ? EDITABLE_FIELDS.filter((field) => String(settings[field] ?? '') !== String(savedSettings[field] ?? '')).length : 0
  const [loading, setLoading] = useState(true)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [loadedRevision, setLoadedRevision] = useState(null)
  const saveInFlight = useRef(false)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState('')
  const [message, setMessageState] = useState(null)
  function setMessage(next) {
    setMessageState(next)
    if (next?.type === 'success') notifySuccess(next.text)
  }
  const [history, setHistory] = useState(readHistory)

  const tabs = useMemo(() => [
    ['general', 'General'],
    ['budget', 'Expense Budgets'],
    ['security', 'Security'],
    ['backup', 'Backup & Data'],
  ], [])

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const { data, error } = await supabase.from('system_settings').select('*').eq('id', 1).single()
        if (!active) return
        if (error) throw error
        if (!data) throw new Error('Settings record is missing.')
        setSettings({
          ...DEFAULT_SETTINGS,
          ...data,
          contact_email: data.contact_email || '',
          contact_phone: data.contact_phone || '',
          billing_day: String(data.billing_day ?? 1),
          due_day: String(data.due_day),
          grace_period_days: String(data.grace_period_days),
          session_timeout: String(data.session_timeout),
        })
        if (!Number.isSafeInteger(Number(data.settings_revision))) {
          throw new Error('Settings revision is missing. Apply the required database migration before saving.')
        }
        setSavedSettings({ ...DEFAULT_SETTINGS, ...data, contact_email: data.contact_email || '', contact_phone: data.contact_phone || '' })
        setLoadedRevision(Number(data.settings_revision))
        setSettingsLoaded(true)
      } catch (error) {
        if (active) setMessage({ type: 'error', text: `Unable to load settings: ${error.message}. Reload before saving.` })
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!dirtyCount) return
    const warnBeforeUnload = (event) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [dirtyCount])

  function discardChanges() {
    if (!savedSettings || saving) return
    setSettings((current) => ({ ...current, ...savedSettings }))
    setMessage(null)
  }

  function goToSection(event, id) {
    event.preventDefault()
    setActiveSection(id)
    const section = pageRef.current?.querySelector(`#ss-${id}`)
    section?.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
    section?.focus({ preventScroll: true })
  }

  function update(field, value) {
    setSettings((current) => ({ ...current, [field]: value }))
    if (message?.type === 'success') setMessage(null)
  }

  async function saveSettings() {
    if (saveInFlight.current) return
    if (!settingsLoaded || loading || loadedRevision == null) {
      setMessage({ type: 'error', text: 'Settings are not loaded. Reload the page before saving.' })
      return
    }
    if (String(user?.role || '').trim().toLowerCase() !== 'admin') {
      setMessage({ type: 'error', text: 'Only an Admin can change system settings.' })
      return
    }
    let payload
    try {
      payload = buildSystemSettingsPayload(settings)
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
      return
    }
    saveInFlight.current = true
    setSaving(true)
    setMessage(null)
    try {
      const { settings: saved, refreshError, cacheError } = await persistSystemSettings(supabase, payload, loadedRevision, refreshOrganization)
      // Use the committed server row, not the pre-save draft.
      setSettings((current) => ({
        ...current,
        ...saved,
        billing_day: String(saved.billing_day),
        due_day: String(saved.due_day),
        grace_period_days: String(saved.grace_period_days),
        session_timeout: String(saved.session_timeout),
      }))
      setSavedSettings({ ...saved, contact_email: saved.contact_email || '', contact_phone: saved.contact_phone || '' })
      setLoadedRevision(Number(saved.settings_revision))
      if (refreshError) {
        setMessage({ type: 'error', text: `Settings were saved, but the shared display could not refresh: ${refreshError.message}. Reload the page before continuing.` })
      } else if (cacheError) {
        setMessage({ type: 'error', text: 'Settings were saved and applied to this session, but the browser cache could not be updated. A future session will reload them from the database.' })
      } else {
        setMessage({ type: 'success', text: 'System settings saved and applied to this session.' })
      }
    } catch (error) {
      const stale = error?.code === '40001' || /settings changed|refresh system settings/i.test(error?.message || '')
      setMessage({
        type: 'error',
        text: stale
          ? 'Settings changed in another session. Your draft was not saved; reload and review the latest settings before saving again.'
          : `Unable to save settings: ${error.message}`,
      })
    } finally {
      saveInFlight.current = false
      setSaving(false)
    }
  }

  function recordExport(label, filename) {
    // The server already recorded the export request before data was fetched.
    const next = [{ label, filename, by: user?.full_name || user?.email || 'Administrator', at: new Date().toISOString() }, ...history].slice(0, 8)
    setHistory(next)
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) }
    catch { /* Optional device history must not disguise a completed download request as a failed export. */ }
  }

  async function exportTable(table, label) {
    setExporting(table)
    setMessage(null)
    try {
      await requestAdminDataExport(supabase, table)
      const { data, error, count } = await fetchTableVerified(supabase, table)
      if (error) setMessage({ type: 'error', text: `Unable to export ${label}: ${error.message}` })
      else {
        const filename = `${table}-${stamp()}.csv`
        downloadFile('\uFEFF' + rowsToCsv(data || []), filename, 'text/csv;charset=utf-8')
        recordExport(`${label} CSV`, filename)
        setMessage({ type: 'success', text: `${label} download started (${count} rows, verified complete).` })
      }
    } catch (error) {
      setMessage({ type: 'error', text: `Unable to export: ${error.message}` })
    } finally {
      setExporting('')
    }
  }

  async function exportLedger() {
    setExporting('ledger')
    setMessage(null)
    try {
      await requestAdminDataExport(supabase, 'ledger')
      const [payments, expenses, services] = await Promise.all([
        fetchTableVerified(supabase, 'payments'),
        fetchTableVerified(supabase, 'expenses'),
        fetchTableVerified(supabase, 'service_transactions'),
      ])
      const error = payments.error || expenses.error || services.error
      if (error) setMessage({ type: 'error', text: `Unable to export ledger: ${error.message}` })
      else {
        const rows = [
          ...(payments.data || []).filter((row) => String(row.status || '').toLowerCase() !== 'voided').map((row) => ({ ...row, transaction_type: 'Payment', transaction_date: row.paid_at || row.payment_date || row.created_at, description: `${row.homeowner_name || ''} ${row.coverage_period || ''}`.trim(), amount: row.amount_paid ?? row.amount, reference_number: row.receipt_number || row.reference_number, recorded_by: row.recorded_by_name, recorded_by_id: row.recorded_by, payment_reference: row.reference_number })),
          ...(services.data || []).filter((row) => String(row.payment_status || '').toLowerCase() !== 'voided').map((row) => ({ ...row, transaction_type: 'Amenity/Service Revenue', transaction_date: row.paid_at || row.service_date || row.created_at, description: `${row.service_name || ''} — ${row.customer_name || ''}`.trim(), amount: row.amount_paid, reference_number: row.receipt_number, recorded_by: row.recorded_by_name, recorded_by_id: row.recorded_by, payment_reference: row.reference_number })),
          ...(expenses.data || []).filter((row) => String(row.status || '').toLowerCase() !== 'voided').map((row) => ({ ...row, transaction_type: 'Expense', transaction_date: row.expense_date || row.created_at, description: row.description, amount: row.amount, reference_number: row.reference_number, recorded_by: row.recorded_by_name, recorded_by_id: row.recorded_by })),
        ].sort((a, b) => String(b.transaction_date || '').localeCompare(String(a.transaction_date || '')))
        const filename = `combined-ledger-${stamp()}.csv`
        downloadFile('\uFEFF' + rowsToCsv(rows), filename, 'text/csv;charset=utf-8')
        recordExport('Combined Ledger CSV', filename)
        setMessage({ type: 'success', text: 'Combined ledger download started.' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: `Unable to export: ${error.message}` })
    } finally {
      setExporting('')
    }
  }

  async function exportAll() {
    setExporting('all')
    setMessage(null)
    try {
      await requestAdminDataExport(supabase, 'admin_application_data')
      const payload = await buildAdminDataExport(supabase, {
        exportedBy: user?.email || user?.full_name || null,
      })
      const filename = `philam-system-data-${stamp()}.json`
      const totalRows = Object.values(payload.export_scope.row_counts).reduce((sum, count) => sum + count, 0)
      downloadFile(JSON.stringify(payload, null, 2), filename, 'application/json;charset=utf-8')
      recordExport('Admin Application Data JSON', filename)
      setMessage({ type: 'success', text: `Admin application data download started (${ADMIN_EXPORT_TABLES.length} tables, ${totalRows} rows; counts verified per table).` })
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Unable to export Admin application data. Please try again.' })
    } finally {
      setExporting('')
    }
  }

  if (loading) return <div className="ss-page" aria-busy="true"><Skeleton variant="text" width="42%" lines={2} /><Skeleton variant="rect" width="100%" height="52px" /><div className="ss-card-grid"><Skeleton variant="rect" width="100%" height="240px" /><Skeleton variant="rect" width="100%" height="240px" /><Skeleton variant="rect" width="100%" height="240px" /></div><span className="skeleton-region-status" role="status">Loading</span></div>

  return (
    <div className="ss-page" ref={pageRef}>
      <header className="ss-header">
        <div className="ss-header-intro">
          <span className="ss-header-icon" aria-hidden="true"><Icon name="general" size={26} /></span>
          <div className="ss-header-copy">
            <span className="ss-header-eyebrow">Administration</span>
            <h1>System Settings</h1>
            <p>Manage organization details, billing rules, security, and system data.</p>
          </div>
        </div>
        <div className="ss-header-actions">
          <span className="ss-admin-badge">{canEdit ? 'Admin access' : 'View only'}</span>
          <button type="button" className="ss-secondary" disabled={!dirtyCount || saving} onClick={discardChanges}>Discard</button>
          <button type="button" className="ss-primary" onClick={saveSettings} disabled={!dirtyCount || saving || !settingsLoaded || !canEdit}>{saving ? 'Saving…' : `Save Changes${dirtyCount ? ` (${dirtyCount})` : ''}`}</button>
        </div>
      </header>

      <section className="ss-stat-row" aria-label="Settings summary">
        <article className="ss-stat-card">
          <span className="ss-stat-icon" aria-hidden="true"><Icon name="general" /></span>
          <span className="ss-stat-label">Organization</span>
          <strong>{settings.hoa_name}</strong>
          <small>{settings.address || 'Address not configured'}</small>
        </article>
        <article className="ss-stat-card">
          <span className="ss-stat-icon" aria-hidden="true"><Icon name="calendar" /></span>
          <span className="ss-stat-label">Billing schedule</span>
          <strong>Day {settings.billing_day}</strong>
          <small>Due day {settings.due_day} · {settings.grace_period_days} grace days</small>
        </article>
        <article className="ss-stat-card">
          <span className="ss-stat-icon" aria-hidden="true"><Icon name="security" /></span>
          <span className="ss-stat-label">Security policy</span>
          <strong>{settings.require_strong_password ? 'Strong' : 'Standard'}</strong>
          <small>{settings.session_timeout} minute session timeout</small>
        </article>
        <article className="ss-stat-card">
          <span className="ss-stat-icon" aria-hidden="true"><Icon name="backup" /></span>
          <span className="ss-stat-label">Export history</span>
          <strong>{history.length}</strong>
          <small>Downloads recorded in this browser</small>
        </article>
      </section>

      <nav className="ss-tabs" aria-label="Settings sections">
        {tabs.map(([id, label]) => <button key={id} type="button" className={activeTab === id ? 'active' : ''} aria-current={activeTab === id ? 'page' : undefined} onClick={() => { setActiveTab(id); setMessage(null) }}><Icon name={id} />{label}</button>)}
      </nav>

      {message?.type === 'error' && <div className="ss-message error" role="alert">{message.text}</div>}

      {activeTab === 'general' && <div className="ss-general-layout">
        <nav className="ss-toc" aria-label="On this page">
          <p>On this page</p>
          {GENERAL_SECTIONS.map(([id, label]) => <a key={id} href={`#ss-${id}`} className={activeSection === id ? 'active' : ''} aria-current={activeSection === id ? 'location' : undefined} onClick={(event) => goToSection(event, id)}>{label}{id === 'penalties' && <small>Own save</small>}</a>)}
        </nav>
        <div className="ss-general-sections">
          <SettingsCard id="ss-organization" className="ss-organization-card" title="Organization details" subtitle="Information shown across the HOA system." badge="Save Changes">
            <Field label="HOA name" value={settings.hoa_name} onChange={(v) => update('hoa_name', v)} wide />
            <Field label="Address" value={settings.address} onChange={(v) => update('address', v)} wide />
            <div className="ss-settings-row"><div className="ss-row-label">Contact<small>Email and phone for residents</small></div><div className="ss-row-controls">
              <Field label="Email" type="email" value={settings.contact_email || ''} onChange={(v) => update('contact_email', v)} />
              <Field label="Phone" value={settings.contact_phone || ''} onChange={(v) => update('contact_phone', v)} />
            </div></div>
          </SettingsCard>
          <SettingsCard id="ss-dues" className="ss-dues-card" title="Dues rate" subtitle="Monthly dues = lot size (sqm) × this rate. Prepaid contract prices stay unchanged." badge="Saves on its own" ownSave>
            <PricePerSqmForm canEdit={canEdit} />
          </SettingsCard>
          <SettingsCard id="ss-billing" title="Billing rules" subtitle="Billing day and overdue-payment rules." badge="Save Changes">
            <div className="ss-settings-row"><div className="ss-row-label">Schedule<small>Day of the month</small></div><div className="ss-row-controls ss-three-controls">
              <Field label="Billing day" type="number" min="1" max="31" value={settings.billing_day} onChange={(v) => update('billing_day', v)} />
              <Field label="Due day" type="number" min="1" max="31" value={settings.due_day} onChange={(v) => update('due_day', v)} />
              <Field label="Grace period (days)" type="number" min="0" value={settings.grace_period_days} onChange={(v) => update('grace_period_days', v)} />
            </div></div>
          </SettingsCard>
          <SettingsCard id="ss-regional" className="ss-preferences-card" title="Regional" subtitle="Display defaults." badge="Save Changes">
            <div className="ss-settings-row"><div className="ss-row-label">Format<small>Currency, time zone and date</small></div><div className="ss-row-controls ss-three-controls">
              <SelectField label="Currency" value={settings.currency} onChange={(v) => update('currency', v)} options={[[ 'PHP', 'Philippine Peso (₱)' ]]} />
              <SelectField label="Time zone" value={settings.timezone} onChange={(v) => update('timezone', v)} options={[[ 'Asia/Manila', 'Asia/Manila' ]]} />
              <SelectField label="Date format" value={settings.date_format} onChange={(v) => update('date_format', v)} options={['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'].map((v) => [v, v])} />
            </div></div>
          </SettingsCard>
          <SettingsCard id="ss-penalties" className="ss-penalty-card" title="Annual penalty rates" subtitle="Future annual compounding on unpaid dues. Posted historical amounts remain unchanged." badge="Saves on its own" ownSave>
            <LatePenaltySettings canEdit={canEdit} />
          </SettingsCard>
        </div>
      </div>}

      {activeTab === 'budget' && <ExpenseBudgetSettings canEdit={String(user?.role || '').trim().toLowerCase() === 'admin'} />}

      {activeTab === 'security' && <SettingsCard title="Security preferences" subtitle="Configure account and session policies." full>
        <div className="ss-toggle-list">
          <Toggle label="Require strong passwords" description="Require at least eight characters, uppercase, number, and symbol." checked={settings.require_strong_password} onChange={(v) => update('require_strong_password', v)} />
        </div>
        <Field label="Session Timeout (minutes)" type="number" min="5" max="1440" value={settings.session_timeout} onChange={(v) => update('session_timeout', v)} />
        <p className="ss-info">These rules are stored as system preferences. Login and session enforcement must also read these values.</p>
      </SettingsCard>}

      {activeTab === 'backup' && <div className="ss-backup-layout">
        <SettingsCard title="Export system data" subtitle="Download the records your Admin account is allowed to read." full>
          <div className="ss-export-feature">
            <div><span className="ss-export-icon"><Icon name="backup" size={22} /></span><div><strong>Admin application data</strong><p>All {ADMIN_EXPORT_TABLES.length} Admin-readable application tables in one JSON file, including entered balances and transfers.</p></div></div>
            <button type="button" className="ss-primary" onClick={exportAll} disabled={!!exporting}><Icon name="download" />{exporting === 'all' ? 'Preparing…' : 'Download JSON'}</button>
          </div>
          <div className="ss-export-feature compact">
            <div><span className="ss-export-icon"><Icon name="backup" size={22} /></span><div><strong>Combined ledger</strong><p>Payments, amenity revenue and expenses in date order. Voided records are excluded.</p></div></div>
            <button type="button" className="ss-secondary" onClick={exportLedger} disabled={!!exporting}>{exporting === 'ledger' ? 'Preparing…' : 'Export CSV'}</button>
          </div>
          <div className="ss-export-grid">
            {EXPORTS.map((item) => <div className="ss-export-item" key={item.table}><div><strong>{item.label}</strong><p>{item.description}</p></div><button type="button" onClick={() => exportTable(item.table, item.label)} disabled={!!exporting}>{exporting === item.table ? 'Preparing…' : 'Export CSV'}</button></div>)}
          </div>
          <details className="ss-export-scope"><summary>View included application tables</summary><div>{ADMIN_EXPORT_TABLES.map((table) => <span key={table}>{table}</span>)}</div></details>
          <p className="ss-info">Includes document metadata. Confidential grievance cases and history, Auth accounts, stored files, database schema and server configuration are excluded. Access follows your existing permissions. Table counts are verified independently; changes made during export may span different moments.</p>
        </SettingsCard>
        <SettingsCard title="Download history" subtitle="Recent exports made in this browser." full>
          {history.length ? <div className="ss-history">{history.map((item, index) => <div key={`${item.at}-${index}`}><span className="ss-history-icon"><Icon name="check" /></span><div><strong>{item.label}</strong><p>{organization.formatDate(item.at, { withTime: true })} · {item.by}</p></div><span>{item.filename}</span></div>)}</div> : <div className="ss-empty">No exports downloaded from this browser yet.</div>}
        </SettingsCard>
      </div>}

      {!!dirtyCount && <div className="ss-save-bar" role="status">
        <span><strong>{dirtyCount} unsaved {dirtyCount === 1 ? 'change' : 'changes'}</strong><small>Organization, billing, regional and security preferences. Dues and penalties save separately.</small></span>
        <div className="ss-save-actions"><button type="button" className="ss-secondary" onClick={discardChanges} disabled={saving}>Discard</button><button type="button" className="ss-primary" onClick={saveSettings} disabled={saving || !settingsLoaded || !canEdit}>{saving ? 'Saving…' : 'Save changes'}</button></div>
      </div>}
    </div>
  )
}

function SettingsCard({ id, title, subtitle, children, full = false, className = '', badge, ownSave = false }) {
  return <section id={id} tabIndex={id ? -1 : undefined} className={`ss-card ${full ? 'full' : ''} ${className}`.trim()}><div className="ss-card-heading"><div><h2>{title}</h2><p>{subtitle}</p></div>{badge && <span className={`ss-card-badge ${ownSave ? 'own-save' : ''}`}>{badge}</span>}</div><div className="ss-fields">{children}</div></section>
}

function Field({ label, value, onChange, wide = false, ...props }) {
  return <label className={`ss-field ${wide ? 'wide' : ''}`}><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} onWheel={(event) => event.currentTarget.blur()} {...props} /></label>
}

function SelectField({ label, value, onChange, options }) {
  return <label className="ss-field"><span>{label}</span><Select ariaLabel={label} value={value} onChange={onChange} options={options.map(([key, text]) => ({ value: key, label: text }))} /></label>
}

function Toggle({ label, description, checked, onChange }) {
  return <div className="ss-toggle-row"><div><strong>{label}</strong><p>{description}</p></div><button type="button" role="switch" aria-checked={checked} aria-label={label} className={checked ? 'on' : ''} onClick={() => onChange(!checked)}><span /></button></div>
}