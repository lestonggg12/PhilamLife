import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Bell, Coins, TriangleAlert, UserRound, Settings, Ban } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { activityTimestamp, fetchAccountActivity } from '../lib/accountActivity'
import { watchStaffInserts } from '../lib/notificationRealtime'
import { staffNotificationCopy } from '../lib/staffActivityText'
import './AccountActivity.css'

const icons = { transaction_voided: Ban, ownership_changed: UserRound, settings_changed: Settings, credit_applied: Coins, penalty_applied: TriangleAlert, balance_added: Coins }

export default function AccountActivity({ propertyId, month, year, refreshKey }) {
  const heading = useId()
  const request = useRef(0)
  const [state, setState] = useState({ scope: '', items: [], total: 0, page: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const scope = `${propertyId}:${month || ''}:${year || ''}`
  const validState = state.scope === scope
  const items = validState ? state.items : []

  const load = useCallback(async (page = 0) => {
    const token = ++request.current
    setLoading(true)
    try {
      const result = await fetchAccountActivity(supabase, propertyId, { month, year, page })
      if (token !== request.current) return
      setState((previous) => ({ scope, total: result.total, page,
        items: page > 0 && previous.scope === scope
          ? [...new Map([...previous.items, ...result.items].map((item) => [item.id, item])).values()]
          : result.items,
      }))
      setError('')
    } catch {
      if (token === request.current) setError('Account activity could not be loaded. Please retry.')
    } finally {
      if (token === request.current) setLoading(false)
    }
  }, [propertyId, month, year, scope])

  useEffect(() => {
    const refresh = () => load(0)
    const stopRealtime = watchStaffInserts(supabase, {
      table: 'account_activity', propertyId, refresh,
      onInsert: () => { request.current++ },
    })
    refresh()
    window.addEventListener('focus', refresh)
    const timer = window.setInterval(refresh, 60000)
    return () => { request.current++; stopRealtime(); window.removeEventListener('focus', refresh); window.clearInterval(timer) }
  }, [load, refreshKey])

  return <section className="account-activity" aria-labelledby={heading}>
    <header className="account-activity-heading"><Bell size={19} aria-hidden="true" /><div>
      <h3 id={heading}>Account Activity</h3>
      <p>{month ? `Events recorded in ${month}` : year ? `Events recorded in ${year}` : 'Permanent activity for this property account'} · Philippine time</p>
    </div><button type="button" onClick={() => load(0)} disabled={loading}>Refresh</button></header>
    <p className="account-activity-note">Entered balances, credit deductions, penalties, voids, moves, and ownership changes. These entries are not additional payments.</p>
    {error && <p className="account-activity-error" role="alert">{error} <button type="button" onClick={() => load(0)}>Retry</button></p>}
    {loading && items.length === 0 ? <div className="account-activity-skeleton" role="status">Loading account activity…</div>
      : !items.length ? <p className="account-activity-empty">{error ? 'Activity is unavailable.' : 'No account activity recorded for this period.'}</p>
        : <ol>{items.map((item) => {
          const Icon = icons[item.kind] || Bell
          const copy = staffNotificationCopy(item)
          return <li key={item.id}><span className={`account-activity-icon is-${item.kind}`}><Icon size={17} aria-hidden="true" /></span>
            <div className="account-activity-content"><strong>{copy.title}</strong><p>{copy.body}</p>
              <small><time dateTime={item.occurred_at}>{activityTimestamp(item.occurred_at)}</time> · {item.payload?.actor_name || 'Actor not recorded'}</small>
              {!!item.payload?.related_reversals?.length && <details><summary>Changes included with this cancellation</summary>
                <ul>{copy.related.map((description, index) => <li key={index}>{description}</li>)}</ul>
              </details>}
            </div>
          </li>
        })}</ol>}
    {validState && items.length < state.total && <button className="account-activity-more" type="button" disabled={loading} onClick={() => load(state.page + 1)}>{loading ? 'Loading…' : 'Load older activity'}</button>}
  </section>
}
