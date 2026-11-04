import React, { useState } from 'react'
import { AlertCircle } from './Icons'
import { supabase } from '../lib/supabaseClient'
import './ActionDialog.css'
import './ServiceVoidDialog.css'

export default function ServiceVoidDialog({ receipt, onClose, onVoided }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (!receipt) return null

  async function handleSubmit(event) {
    event.preventDefault()

    if (saving) return

    const trimmedReason = reason.trim()

    if (trimmedReason.length < 5 || trimmedReason.length > 500) {
      setError('Enter a reason between 5 and 500 characters.')
      return
    }

    setSaving(true)
    setError('')

    try {
      const { data, error: rpcError } = await supabase.rpc(
        'void_service_receipt',
        {
          p_receipt_id: receipt.id,
          p_reason: trimmedReason,
        },
      )

      if (rpcError) throw rpcError

      if (
        !data ||
        String(data.id) !== String(receipt.id) ||
        data.payment_status !== 'voided' ||
        !data.voided_at
      ) {
        throw new Error(
          'The void operation could not be confirmed. Refresh receipts before retrying.',
        )
      }

      onVoided(data)
    } catch (failure) {
      setError(
        failure?.message ||
        'Could not void this receipt. Refresh receipts before trying again.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="action-dialog-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (!saving && event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <form
        className="action-dialog svd-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="svd-title"
        onSubmit={handleSubmit}
      >
        <div className="action-dialog-icon action-dialog-icon-danger">
          <AlertCircle size={20} />
        </div>

        <h2 id="svd-title" className="action-dialog-title">
          Void Service Receipt?
        </h2>

        <p className="action-dialog-message">
          Are you sure you want to void receipt{' '}
          <strong>{receipt.receipt_number}</strong>?
          This action will be recorded in the audit history.
        </p>

        <dl className="svd-details">
          <div>
            <dt>Customer</dt>
            <dd>{receipt.customer_name}</dd>
          </div>
          <div>
            <dt>Service</dt>
            <dd>{receipt.service_name}</dd>
          </div>
          <div>
            <dt>Payment</dt>
            <dd>
              ₱{Number(receipt.amount_paid || 0).toFixed(2)}
            </dd>
          </div>
        </dl>

        <p className="svd-warning">
          Voiding removes this receipt from collected revenue but
          does not automatically issue a refund. Active balance
          settlements must be voided first.
        </p>

        <label className="svd-label" htmlFor="svd-reason">
          Reason for voiding
        </label>

        <textarea
          id="svd-reason"
          required
          minLength={5}
          maxLength={500}
          rows={3}
          value={reason}
          disabled={saving}
          placeholder="Enter the reason (5–500 characters)"
          onChange={(event) => setReason(event.target.value)}
        />

        {error && (
          <p className="svd-error" role="alert">
            {error}
          </p>
        )}

        <div className="action-dialog-actions svd-actions">
          <button
            type="button"
            className="action-dialog-btn action-dialog-btn-secondary"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </button>

          <button
            type="submit"
            className="action-dialog-btn action-dialog-btn-danger"
            disabled={
              saving ||
              reason.trim().length < 5 ||
              reason.trim().length > 500
            }
          >
            {saving ? 'Voiding...' : 'Confirm Void'}
          </button>
        </div>
      </form>
    </div>
  )
}