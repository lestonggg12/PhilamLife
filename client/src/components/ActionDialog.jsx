import React, { useEffect, useRef } from 'react'
import { AlertCircle, CheckCircle, Trash2, X } from './Icons'
import './ActionDialog.css'

const ICONS = {
  danger: Trash2,
  warning: AlertCircle,
  info: AlertCircle,
  success: CheckCircle,
}

export default function ActionDialog({
  open,
  title,
  message,
  details = [],
  variant = 'info',
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  loading = false,
  onConfirm,
  onCancel,
}) {
  const cancelButtonRef = useRef(null)
  const confirmButtonRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusTimer = window.setTimeout(() => {
      ;(onCancel ? cancelButtonRef : confirmButtonRef).current?.focus()
    }, 0)

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && onCancel && !loading) onCancel()
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      window.clearTimeout(focusTimer)
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [loading, onCancel, open])

  if (!open) return null

  const Icon = ICONS[variant] || AlertCircle

  return (
    <div
      className="action-dialog-backdrop"
      role="presentation"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && onCancel && !loading) {
          onCancel()
        }
      }}
    >
      <section
        className={`action-dialog action-dialog-${variant}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="action-dialog-title"
        aria-describedby="action-dialog-message"
      >
        {onCancel && (
          <button
            type="button"
            className="action-dialog-close"
            onClick={onCancel}
            disabled={loading}
            aria-label="Close dialog"
          >
            <X size={19} />
          </button>
        )}

        <div className="action-dialog-icon" aria-hidden="true">
          <Icon size={25} />
        </div>

        <div className="action-dialog-copy">
          <p className="action-dialog-eyebrow">
            {variant === 'danger'
              ? 'Please confirm'
              : variant === 'success'
                ? 'Completed'
                : variant === 'warning'
                  ? 'Attention needed'
                  : 'System notice'}
          </p>
          <h2 id="action-dialog-title">{title}</h2>
          <p id="action-dialog-message">{message}</p>
        </div>

        {details.length > 0 && (
          <dl className="action-dialog-details">
            {details.map(({ label, value }) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="action-dialog-actions">
          {onCancel && (
            <button
              ref={cancelButtonRef}
              type="button"
              className="action-dialog-button action-dialog-cancel"
              onClick={onCancel}
              disabled={loading}
            >
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmButtonRef}
            type="button"
            className="action-dialog-button action-dialog-confirm"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'Please wait...' : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}