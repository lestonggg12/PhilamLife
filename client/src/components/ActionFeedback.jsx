import React, { useEffect, useState } from 'react'
import { subscribeActionFeedback } from '../lib/actionFeedback'
import './ActionFeedback.css'

function Notice({ notice, onDismiss }) {
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (paused) return
    const timer = window.setTimeout(() => onDismiss(notice.id), 8000)
    return () => window.clearTimeout(timer)
  }, [notice.id, paused, onDismiss])
  return (
    <article className={`action-feedback-item action-feedback-${notice.tone}`}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false)
      }}>
      <span className="action-feedback-mark" aria-hidden="true">{notice.tone === 'warning' ? '!' : '✓'}</span>
      <div><strong>{notice.tone === 'warning' ? 'Please check' : 'Done'}</strong><p>{notice.message}</p></div>
      <button type="button" aria-label="Dismiss notification" onClick={() => onDismiss(notice.id)}>×</button>
    </article>
  )
}

export default function ActionFeedback() {
  const [notices, setNotices] = useState([])
  const dismiss = React.useCallback((id) => setNotices((items) => items.filter((item) => item.id !== id)), [])
  useEffect(() => subscribeActionFeedback((notice) => setNotices((items) => [...items, notice])), [])
  return <aside className="action-feedback" aria-label="Action updates" role="status" aria-live="polite" aria-relevant="additions">
    {notices.map((notice) => <Notice key={notice.id} notice={notice} onDismiss={dismiss} />)}
  </aside>
}
