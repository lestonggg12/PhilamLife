import React, { useEffect, useRef } from 'react'

export default function ExpenseVoidDialog({ expense, reason, onReason, error, busy, onConfirm, onCancel }) {
  const dialog = useRef(null)
  useEffect(() => {
    if (!expense) return undefined
    const previous = document.activeElement
    dialog.current?.querySelector('input')?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [expense?.id])
  if (!expense) return null
  return <div className="tex-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel() }}>
    <section ref={dialog} className="tex-modal" role="dialog" aria-modal="true" aria-labelledby="expense-void-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) { event.stopPropagation(); onCancel() }
        if (event.key === 'Tab') {
          const controls = Array.from(dialog.current.querySelectorAll('input:not(:disabled), button:not(:disabled)'))
          if (!controls.length) { event.preventDefault(); return }
          const target = event.shiftKey ? controls.at(-1) : controls[0]
          if ((event.shiftKey && event.target === controls[0]) || (!event.shiftKey && event.target === controls.at(-1))) { event.preventDefault(); target.focus() }
        }
      }}>
      <h2 id="expense-void-title">Void this expense?</h2>
      <p>{expense.description}</p>
      <form className="tex-form" onSubmit={(event) => { event.preventDefault(); if (!busy) onConfirm() }}>
        <label htmlFor="expense-void-reason">Cancellation reason
          <input id="expense-void-reason" value={reason} onChange={(event) => onReason(event.target.value)} required minLength={5} maxLength={500} disabled={busy} />
        </label>
        <p>The original expense stays on record. Your account, time and reason will be saved.</p>
        {error && <p className="tex-form-error" role="alert">{error}</p>}
        <div className="tex-form-footer">
          <button type="button" className="tex-btn tex-btn-secondary button-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" className="tex-btn tex-btn-primary" disabled={busy || reason.trim().length < 5}>{busy ? 'Voiding…' : 'Void expense'}</button>
        </div>
      </form>
    </section>
  </div>
}
