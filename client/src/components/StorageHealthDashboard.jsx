import React, { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import './StorageHealthDashboard.css'

const DATABASE_LIMIT = 500 * 1024 * 1024
const STORAGE_LIMIT = 1024 * 1024 * 1024

export function formatStorageBytes(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unavailable'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  )
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`
}

export function capacityStatus(bytes, limit) {
  const percent = Number(bytes) / limit * 100
  if (!Number.isFinite(percent) || percent < 0) return 'unknown'
  if (percent >= 90) return 'critical'
  if (percent >= 75) return 'warning'
  if (percent >= 60) return 'watch'
  return 'healthy'
}

function CapacityCard({ title, bytes, limit, description }) {
  const value = Number(bytes)
  const valid = Number.isFinite(value) && value >= 0
  const percent = valid ? value / limit * 100 : 0
  const status = valid ? capacityStatus(value, limit) : 'unknown'

  return (
    <article className="sh-capacity-card">
      <div className="sh-card-top">
        <h3>{title}</h3>
        <span className={`sh-status sh-${status}`}>{status}</span>
      </div>
      <strong>{formatStorageBytes(bytes)}</strong>
      <p>{description}</p>
      <div
        className="sh-meter"
        role="progressbar"
        aria-label={`${title} allowance used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.round(percent))}
      >
        <div
          className={`sh-meter-fill sh-${status}`}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
      <small>{valid ? `${percent.toFixed(2)}% of ${formatStorageBytes(limit)} allowance` : 'Usage unavailable'}</small>
    </article>
  )
}

export default function StorageHealthDashboard() {
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: rpcError } = await supabase.rpc('admin_storage_health')
      if (rpcError) throw rpcError
      if (!data || typeof data !== 'object') {
        throw new Error('No health metrics returned.')
      }
      setHealth(data)
    } catch (failure) {
      setError(failure.message || 'Health metrics could not be loaded.')
      setHealth(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <section className="sh-dashboard" aria-label="Storage and system health">
      <div className="sh-heading">
        <div>
          <h2>Storage & System Health</h2>
          <p>Admin-only, read-only monitoring for Supabase Free.</p>
        </div>
        <button type="button" onClick={refresh} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh metrics'}
        </button>
      </div>

      {error && <p role="alert" className="sh-error">{error}</p>}
      {loading && !health && <p role="status">Loading database metrics…</p>}

      {health && (
        <>
          <div className="sh-capacity-grid">
            <CapacityCard
              title="Database size"
              bytes={health.database_bytes}
              limit={DATABASE_LIMIT}
              description="PostgreSQL database size, not underlying disk usage."
            />
            <CapacityCard
              title="File storage"
              bytes={health.storage_bytes}
              limit={STORAGE_LIMIT}
              description="Approximate size from Storage object metadata."
            />
          </div>

          <div className="sh-metric-grid">
            <article><span>Stored files</span><strong>{Number(health.storage_objects).toLocaleString()}</strong></article>
            <article><span>HOA document objects</span><strong>{Number(health.document_objects).toLocaleString()}</strong></article>
            <article><span>Live activity logs</span><strong>{Number(health.activity_log_rows).toLocaleString()}</strong></article>
            <article><span>Bell notifications</span><strong>{Number(health.notification_rows).toLocaleString()}</strong></article>
            <article><span>Archived log records</span><strong>{Number(health.archived_records).toLocaleString()}</strong></article>
            <article><span>Logs eligible for archive</span><strong>{Number(health.eligible_archive_rows).toLocaleString()}</strong></article>
          </div>

          <div className="sh-detail-grid">
            <article className="sh-detail">
              <h3>Activity archiving</h3>
              <p>Status: <strong>{health.archive_enabled ? 'Enabled' : 'Disabled'}</strong></p>
              <p>Private archive storage: <strong>{health.archive_ready ? 'Ready' : 'Not verified'}</strong></p>
              <small>Activity logs retain the current month and 12 complete prior Manila calendar months. No archiving controls are available in this panel.</small>
            </article>

            <article className="sh-detail">
              <h3>Largest application tables</h3>
              <ul>
                {(health.largest_tables || []).map((table) => (
                  <li key={table.name}>
                    <span>{table.name}</span>
                    <strong>{formatStorageBytes(table.bytes)}</strong>
                  </li>
                ))}
              </ul>
            </article>
          </div>

          <p className="sh-footnote">
            Refreshed: {new Date(health.sampled_at).toLocaleString('en-PH')}.
            Capacity thresholds (60%, 75%, 90%) are application warnings, not Supabase billing alerts.
            File usage excludes bandwidth and may differ from Supabase's dashboard.
            A verified backup is still outstanding.
          </p>
        </>
      )}
    </section>
  )
}