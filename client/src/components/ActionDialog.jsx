import React from 'react'
import { AlertCircle } from './Icons'
import './ActionDialog.css'

/**
 * A styled replacement for window.confirm() / window.alert().
 *
 * Usage as a confirm dialog (Cancel + Confirm):
 *   <ActionDialog
 *     open={!!pendingAction}
 *     title="Delete Event?"
 *     message={`Delete "${event.title}"? This cannot be undone.`}
 *     confirmLabel="Delete"
 *     tone="danger"
 *     onConfirm={() => { doDelete(); setPendingAction(null) }}
 *     onCancel={() => setPendingAction(null)}
 *   />
 *
 * Usage as a simple alert/notice (OK only) — just omit onCancel:
 *   <ActionDialog
 *     open={!!notice}
 *     title="Heads up"
 *     message={notice}
 *     onConfirm={() => setNotice('')}
 *   />
 */
export default function ActionDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  tone = 'default', // 'default' | 'danger'
}) {
  if (!open) return null

  const isConfirmStyle = Boolean(onCancel)
  const resolvedConfirmLabel = confirmLabel || (isConfirmStyle ? 'Confirm' : 'OK')

  return (
    <div
      className="action-dialog-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && onCancel) onCancel()
      }}
    >
      <div
        className="action-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="action-dialog-title"
      >
        {tone === 'danger' && (
          <div className="action-dialog-icon action-dialog-icon-danger">
            <AlertCircle size={20} />
          </div>
        )}

        {title && (
          <h2 id="action-dialog-title" className="action-dialog-title">
            {title}
          </h2>
        )}

        {message && (
          <p className="action-dialog-message">
            {String(message)
              .split('\n')
              .map((line, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <br />}
                  {line}
                </React.Fragment>
              ))}
          </p>
        )}

        <div className="action-dialog-actions">
          {isConfirmStyle && (
            <button
              type="button"
              className="action-dialog-btn action-dialog-btn-secondary"
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            className={`action-dialog-btn ${
              tone === 'danger'
                ? 'action-dialog-btn-danger'
                : 'action-dialog-btn-primary'
            }`}
            onClick={onConfirm}
            autoFocus
          >
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}