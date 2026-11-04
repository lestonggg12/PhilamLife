import React, { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import './ServiceVoidDialog.css'

export default function ServiceVoidDialog({ receipt, onClose, onVoided }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (!receipt) return null

  async function handleSubmit(event) {
    event.preventDefault()

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
        'Could not void this receipt. Refresh and try again.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="svd-backdrop">
      <form
        className="svd-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Void receipt ${receipt.receipt_number}`}
        onSubmit={handleSubmit}
      >
        <h2>Void Service Receipt</h2>

        <p>
          You are about to void receipt{' '}
          <strong>{receipt.receipt_number}</strong>.
        </p>

        <dl>
          <div>
            <dt>Customer</dt>
            <dd>{receipt.customer_name}</dd>
          </div>
          <div>
            <dt>Service</dt>
            <dd>{receipt.service_name}</dd>
          </div>
          <div>
            <dt>Payment recorded</dt>
            <dd>
              ₱{Number(receipt.amount_paid || 0).toFixed(2)}
            </dd>
          </div>
        </dl>

        <p className="svd-warning">
          This reverses the receipt in revenue reports and keeps an
          audit record. It does not automatically refund money.
          If this receipt has active balance collections, void those
          collection receipts first.
        </p>

        <label htmlFor="svd-reason">
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
          placeholder="Explain why this receipt must be voided"
          onChange={(event) => setReason(event.target.value)}
        />

        {error && <p className="svd-error" role="alert">{error}</p>}

        <div className="svd-actions">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </button>

          <button
            type="submit"
            className="svd-confirm"
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