import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import './PaymentsPage.css'

const EMPTY_FORM = {
  homeownerName: '',
  blockName: '',
  lotNumber: '',
  coveragePeriod: '',
  previousBalance: '',
  amountPaid: '',
  paymentMethod: 'Cash',
  referenceNumber: '',
  note: '',
}

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
})

const dateTime = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Manila',
})

export default function PaymentsPage({ user }) {
  const [payments, setPayments] = useState([])
  const [blocks, setBlocks] = useState([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [receipt, setReceipt] = useState(null)

  const isAdmin = user?.role?.toLowerCase() === 'admin'
  const recorderName =
    user?.full_name || user?.name || user?.email || 'Administrator'

  useEffect(() => {
    loadPage()
  }, [])

  async function loadPage() {
    setLoading(true)
    setPageError('')

    const [paymentResult, blockResult] = await Promise.all([
      supabase
        .from('payments')
        .select('*')
        .order('paid_at', { ascending: false }),
      supabase.from('blocks').select('id, name').order('name'),
    ])

    if (paymentResult.error) {
      setPageError(`Could not load payments: ${paymentResult.error.message}`)
    } else {
      setPayments(paymentResult.data || [])
    }

    if (!blockResult.error) setBlocks(blockResult.data || [])
    setLoading(false)
  }

  const remainingBalance = useMemo(() => {
    const previous = Number(form.previousBalance) || 0
    const paid = Number(form.amountPaid) || 0
    return Math.max(previous - paid, 0)
  }, [form.previousBalance, form.amountPaid])

  function updateField(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setFormError('')
  }

  function openForm() {
    setForm(EMPTY_FORM)
    setFormError('')
    setShowForm(true)
  }

  function closeForm() {
    if (saving) return
    setShowForm(false)
    setFormError('')
  }

  async function recordPayment(event) {
    event.preventDefault()

    const previous = Number(form.previousBalance)
    const paid = Number(form.amountPaid)
    const reference = form.referenceNumber.trim()

    if (!form.homeownerName.trim() || !form.blockName || !form.lotNumber.trim()) {
      setFormError('Homeowner name, block, and lot number are required.')
      return
    }

    if (!form.coveragePeriod.trim()) {
      setFormError('Enter the payment purpose or coverage period.')
      return
    }

    if (!Number.isFinite(previous) || previous < 0) {
      setFormError('Previous balance must be zero or greater.')
      return
    }

    if (!Number.isFinite(paid) || paid <= 0) {
      setFormError('Amount paid must be greater than zero.')
      return
    }

    if (paid > previous) {
      setFormError('Amount paid cannot be greater than the previous balance.')
      return
    }

    if (form.paymentMethod !== 'Cash' && !reference) {
      setFormError('A reference number is required for non-cash payments.')
      return
    }

    setSaving(true)
    setFormError('')

   const payload = {
  homeowner_name: form.homeownerName.trim().replace(/\s+/g, ' '),
  block_name: form.blockName,
  lot_number: form.lotNumber.trim().replace(/\s+/g, ' '),
  coverage_period: form.coveragePeriod.trim().replace(/\s+/g, ' '),
  previous_balance: previous,
  amount_paid: paid,
  amount: paid,
  payment_method: form.paymentMethod,
  reference_number: reference || null,
  note: form.note.trim() || null,
  recorded_by: user.id,
  recorded_by_name: recorderName,
}

    const { data, error } = await supabase
      .from('payments')
      .insert(payload)
      .select('*')
      .single()

    if (error) {
      setFormError(error.message)
      setSaving(false)
      return
    }

    setPayments((current) => [data, ...current])
    setShowForm(false)
    setForm(EMPTY_FORM)
    setReceipt(data)
    setSaving(false)
  }

  return (
    <div className="payments-page">
      <header className="payments-header">
        <div>
          <h1>Payments</h1>
          <p>Record homeowner payments and issue official receipts.</p>
        </div>

        {isAdmin && (
          <button className="payments-primary" type="button" onClick={openForm}>
            + Record Payment
          </button>
        )}
      </header>

      {pageError && <p className="payments-error">{pageError}</p>}

      <section className="payments-table-card">
        <table className="payments-table">
          <thead>
            <tr>
              <th>Receipt No.</th>
              <th>Date</th>
              <th>Homeowner</th>
              <th>Block / Lot</th>
              <th>Coverage</th>
              <th>Amount</th>
              <th>Method</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="8" className="payments-empty">Loading payments...</td></tr>
            ) : payments.length === 0 ? (
              <tr><td colSpan="8" className="payments-empty">No payments recorded yet.</td></tr>
            ) : (
              payments.map((payment) => (
                <tr key={payment.id}>
                  <td><strong>{payment.receipt_number}</strong></td>
                  <td>{dateTime.format(new Date(payment.paid_at))}</td>
                  <td>{payment.homeowner_name}</td>
                  <td>{payment.block_name}, {payment.lot_number}</td>
                  <td>{payment.coverage_period}</td>
                  <td>{peso.format(payment.amount_paid)}</td>
                  <td>{payment.payment_method}</td>
                  <td>
                    <button className="payments-link" type="button" onClick={() => setReceipt(payment)}>
                      View receipt
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {showForm && isAdmin && (
        <div className="payments-overlay" onMouseDown={closeForm}>
          <form className="payment-form" onSubmit={recordPayment} onMouseDown={(e) => e.stopPropagation()}>
            <div className="payment-modal-heading">
              <div>
                <h2>Record Payment</h2>
                <p>Check every value before saving. Saved receipts should not be edited casually.</p>
              </div>
              <button type="button" className="payments-close" onClick={closeForm}>×</button>
            </div>

            <div className="payment-form-grid">
              <label className="payment-span-2">Homeowner full name
                <input name="homeownerName" value={form.homeownerName} onChange={updateField} maxLength="120" required />
              </label>

              <label>Block
                <select name="blockName" value={form.blockName} onChange={updateField} required>
                  <option value="">Select block</option>
                  {blocks.map((block) => <option key={block.id} value={block.name}>{block.name}</option>)}
                </select>
              </label>

              <label>Lot number
                <input name="lotNumber" value={form.lotNumber} onChange={updateField} placeholder="e.g., Lot 5" maxLength="50" required />
              </label>

              <label className="payment-span-2">Payment purpose / coverage period
                <input name="coveragePeriod" value={form.coveragePeriod} onChange={updateField} placeholder="e.g., Association dues — July 2026" maxLength="120" required />
              </label>

              <label>Previous balance
                <input name="previousBalance" type="number" min="0" step="0.01" value={form.previousBalance} onChange={updateField} required />
              </label>

              <label>Amount paid
                <input name="amountPaid" type="number" min="0.01" step="0.01" value={form.amountPaid} onChange={updateField} required />
              </label>

              <div className="payment-balance-preview payment-span-2">
                <span>Remaining balance after payment</span>
                <strong>{peso.format(remainingBalance)}</strong>
              </div>

              <label>Payment method
                <select name="paymentMethod" value={form.paymentMethod} onChange={updateField}>
                  <option>Cash</option>
                  <option>GCash</option>
                  <option>Bank Transfer</option>
                  <option>Check</option>
                </select>
              </label>

              <label>Reference number {form.paymentMethod !== 'Cash' && '*'}
                <input name="referenceNumber" value={form.referenceNumber} onChange={updateField} maxLength="100" required={form.paymentMethod !== 'Cash'} />
              </label>

              <label className="payment-span-2">Note (optional)
                <textarea name="note" value={form.note} onChange={updateField} maxLength="250" rows="3" />
              </label>
            </div>

            {formError && <p className="payments-error">{formError}</p>}

            <div className="payment-actions">
              <button type="button" className="payments-secondary" onClick={closeForm} disabled={saving}>Cancel</button>
              <button type="submit" className="payments-primary" disabled={saving}>{saving ? 'Saving...' : 'Save and Create Receipt'}</button>
            </div>
          </form>
        </div>
      )}

      {receipt && (
        <div className="payments-overlay receipt-overlay" onMouseDown={() => setReceipt(null)}>
          <article className="receipt" onMouseDown={(e) => e.stopPropagation()}>
            <div className="receipt-copy">
              <header className="receipt-header">
                <div>
                  <h2>Philam Life Homeowners Association</h2>
                  <p>Official Payment Receipt</p>
                </div>
                <div className="receipt-number"><span>Receipt No.</span><strong>{receipt.receipt_number}</strong></div>
              </header>

              <dl className="receipt-details">
                <div><dt>Date and time</dt><dd>{dateTime.format(new Date(receipt.paid_at))}</dd></div>
                <div><dt>Received from</dt><dd>{receipt.homeowner_name}</dd></div>
                <div><dt>Property</dt><dd>{receipt.block_name}, {receipt.lot_number}</dd></div>
                <div><dt>Payment for</dt><dd>{receipt.coverage_period}</dd></div>
                <div><dt>Payment method</dt><dd>{receipt.payment_method}</dd></div>
                {receipt.reference_number && <div><dt>Reference no.</dt><dd>{receipt.reference_number}</dd></div>}
              </dl>

              <div className="receipt-totals">
                <div><span>Previous balance</span><span>{peso.format(receipt.previous_balance)}</span></div>
                <div className="receipt-paid"><strong>Amount paid</strong><strong>{peso.format(receipt.amount_paid)}</strong></div>
                <div><span>Remaining balance</span><strong>{peso.format(receipt.remaining_balance)}</strong></div>
              </div>

              {receipt.note && <p className="receipt-note"><strong>Note:</strong> {receipt.note}</p>}

              <footer className="receipt-footer">
                <div><span>Recorded by</span><strong>{receipt.recorded_by_name}</strong></div>
                <p>This computer-generated receipt is based on the payment saved in the system.</p>
              </footer>
            </div>

            <div className="receipt-actions">
              <button type="button" className="payments-secondary" onClick={() => setReceipt(null)}>Close</button>
              <button type="button" className="payments-primary" onClick={() => window.print()}>Print / Save as PDF</button>
            </div>
          </article>
        </div>
      )}
    </div>
  )
}