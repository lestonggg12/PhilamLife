import React, { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import './ActionDialog.css'
import './ServiceVoidDialog.css'

// Secretary already has UPDATE permission on payments. Treasurer uses the
// narrow SECURITY DEFINER RPC after its separate migration is deployed.
export default function OfficialRegularVoidDialog({ receipt, role, onClose, onVoided }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  if (!receipt) return null

  async function submit(event) {
    event.preventDefault()
    if (saving) return
    const trimmed = reason.trim()
    if (trimmed.length < 5 || trimmed.length > 500) {
      setError('Enter a reason between 5 and 500 characters.')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (role !== 'secretary' && role !== 'treasurer') throw new Error('Your account cannot void payment receipts.')
      if (role === 'secretary') {
        const { data, error: failure } = await supabase.from('payments')
          .update({ status: 'Voided', void_reason: trimmed })
          .eq('id', receipt.id)
          .or('status.is.null,status.neq.Voided')
          .select('id,status,voided_at')
        if (failure) throw failure
        if (!Array.isArray(data) || data.length !== 1 || String(data[0].id) !== String(receipt.id) ||
            data[0].status !== 'Voided' || !data[0].voided_at) {
          throw new Error('Could not confirm this receipt void. Refresh before retrying.')
        }
      } else {
        const { data, error: failure } = await supabase.rpc('void_regular_payment_receipt', {
          p_payment_id: receipt.id, p_reason: trimmed,
        })
        if (failure) throw failure
        if (!data || String(data.id) !== String(receipt.id) || data.status !== 'Voided' || !data.voided_at) {
          throw new Error('Could not confirm this receipt void. Refresh before retrying.')
        }
      }
      onVoided()
    } catch (failure) {
      setError(failure?.message || 'Could not void this receipt. Refresh before retrying.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="action-dialog-overlay" role="presentation" onMouseDown={(event) => {
      if (!saving && event.target === event.currentTarget) onClose()
    }}>
      <form className="action-dialog svd-dialog" role="alertdialog" aria-modal="true"
        aria-labelledby="official-void-title" onSubmit={submit}>
        <h2 id="official-void-title" className="action-dialog-title">Void regular payment receipt?</h2>
        <p className="action-dialog-message">
          Receipt <strong>{receipt.receipt_number}</strong> for <strong>{receipt.homeowner_name}</strong>.
          This cancellation is audited and will update the account balance. It does not issue a refund.
        </p>
        <label className="svd-label" htmlFor="official-void-reason">Reason for voiding</label>
        <textarea id="official-void-reason" value={reason} disabled={saving}
          minLength={5} maxLength={500} rows={3} required
          onChange={(event) => setReason(event.target.value)}
          placeholder="Enter the reason (5–500 characters)" />
        {error && <p className="svd-error" role="alert">{error}</p>}
        <div className="action-dialog-actions svd-actions">
          <button type="button" className="action-dialog-btn action-dialog-btn-secondary"
            disabled={saving} onClick={onClose}>Cancel</button>
          <button type="submit" className="action-dialog-btn action-dialog-btn-danger"
            disabled={saving || reason.trim().length < 5 || reason.trim().length > 500}>
            {saving ? 'Voiding…' : 'Confirm Void'}
          </button>
        </div>
      </form>
    </div>
  )
}
