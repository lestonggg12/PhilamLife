import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import './PaymentsPage.css'

const PAYMENT_PURPOSES = [
  'Association Dues',
  'Special Assessment',
  'Penalty / Late Fee',
  'Sticker / ID Fee',
  'Document / Certification Fee',
  'Other',
]

const EMPTY_FORM = {
  propertyId: '',
  homeownerName: '',
  blockName: '',
  lotNumber: '',
  paymentPurpose: '',
  customPaymentPurpose: '',
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

export default function PaymentsPage({ user: suppliedUser }) {
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [payments, setPayments] = useState([])
  const [properties, setProperties] = useState([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [receipt, setReceipt] = useState(null)
  const [homeownerMenuOpen, setHomeownerMenuOpen] = useState(false)

  const role = currentUser?.role?.trim().toLowerCase()
  const canManagePayments =
    role === 'admin' || role === 'secretary' || role === 'treasurer'
  const recorderName =
    currentUser?.full_name || currentUser?.name || currentUser?.email || 'Staff member'

  useEffect(() => {
    loadPage()
    resolveCurrentUser()
  }, [])

  async function resolveCurrentUser() {
    if (suppliedUser) {
      setCurrentUser(suppliedUser)
      return
    }

    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser()
    if (authError || !authUser) return

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .single()

    if (!profileError) setCurrentUser(profile)
  }

  async function loadPage() {
    setLoading(true)
    setPageError('')

    const [paymentResult, propertyResult] = await Promise.all([
      supabase
        .from('payments')
        .select('*')
        .order('paid_at', { ascending: false }),
      supabase
        .from('properties')
        .select('id, homeowner_name, block, lot_number')
        .order('homeowner_name'),
    ])

    if (paymentResult.error) {
      setPageError(`Could not load payments: ${paymentResult.error.message}`)
    } else {
      setPayments(paymentResult.data || [])
    }

    if (propertyResult.error) {
      setPageError((current) => {
        const message = `Could not load ledger homeowners: ${propertyResult.error.message}`
        return current ? `${current} ${message}` : message
      })
    } else {
      setProperties(propertyResult.data || [])
    }
    setLoading(false)
  }

  const remainingBalance = useMemo(() => {
    const previous = Number(form.previousBalance) || 0
    const paid = Number(form.amountPaid) || 0
    return Math.max(previous - paid, 0)
  }, [form.previousBalance, form.amountPaid])

  const matchingHomeowners = useMemo(() => {
    const search = form.homeownerName.trim().toLowerCase()

    return properties
      .filter((property) => {
        if (!search) return true

        const searchableValue = [
          property.homeowner_name,
          property.block,
          `Lot ${property.lot_number}`,
        ]
          .join(' ')
          .toLowerCase()

        return searchableValue.includes(search)
      })
      .slice(0, 8)
  }, [form.homeownerName, properties])

  function updateField(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setFormError('')
  }

  function updateHomeownerSearch(event) {
    const { value } = event.target

    setForm((current) => ({
      ...current,
      propertyId: '',
      homeownerName: value,
      blockName: '',
      lotNumber: '',
    }))
    setHomeownerMenuOpen(true)
    setFormError('')
  }

  function selectHomeowner(property) {
    setForm((current) => ({
      ...current,
      propertyId: String(property.id),
      homeownerName: property.homeowner_name,
      blockName: property.block,
      lotNumber: String(property.lot_number),
    }))
    setHomeownerMenuOpen(false)
    setFormError('')
  }

  function openForm() {
    if (!canManagePayments) return
    setForm(EMPTY_FORM)
    setFormError('')
    setHomeownerMenuOpen(false)
    setShowForm(true)
  }

  function closeForm() {
    if (saving) return
    setShowForm(false)
    setFormError('')
  }

  async function recordPayment(event) {
    event.preventDefault()

    if (!canManagePayments) {
      setFormError('Only an Admin, Secretary, or Treasurer can record payments.')
      return
    }

    if (!currentUser?.id) {
      setFormError('Your user profile could not be verified. Please sign in again.')
      return
    }

    const previous = Number(form.previousBalance)
    const paid = Number(form.amountPaid)
    const reference = form.referenceNumber.trim()
    const selectedPurpose =
      form.paymentPurpose === 'Other'
        ? form.customPaymentPurpose.trim()
        : form.paymentPurpose

    if (!form.propertyId || !form.homeownerName.trim() || !form.blockName || !form.lotNumber.trim()) {
      setFormError('Select a homeowner from the ledger list.')
      return
    }

    if (!selectedPurpose) {
      setFormError('Select or enter a payment purpose.')
      return
    }

    if (!form.coveragePeriod.trim()) {
      setFormError('Enter the coverage period or payment details.')
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
      property_id: Number(form.propertyId),
      homeowner_name: form.homeownerName.trim().replace(/\s+/g, ' '),
      block_name: form.blockName,
      lot_number: form.lotNumber.trim().replace(/\s+/g, ' '),
      coverage_period: `${selectedPurpose} — ${form.coveragePeriod.trim()}`.replace(/\s+/g, ' '),
      previous_balance: previous,
      amount: paid,
      amount_paid: paid,
      payment_method: form.paymentMethod,
      reference_number: reference || null,
      note: form.note.trim() || null,
      recorded_by: currentUser.id,
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

        {canManagePayments && (
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

      {showForm && canManagePayments && (
        <div className="payments-overlay" onMouseDown={closeForm}>
          <form className="payment-form" onSubmit={recordPayment} onMouseDown={(e) => e.stopPropagation()} autoComplete="off">
            <div className="payment-modal-heading">
              <div>
                <h2>Record Payment</h2>
                <p>Check every value before saving. Saved receipts should not be edited casually.</p>
              </div>
              <button type="button" className="payments-close" onClick={closeForm}>×</button>
            </div>

            <div className="payment-form-grid">
              <div className="payment-homeowner-field payment-span-2">
                <label htmlFor="payment-homeowner-search">Homeowner full name</label>
                <div className="payment-homeowner-combobox">
                  <input
                    id="payment-homeowner-search"
                    name="homeownerName"
                    type="search"
                    value={form.homeownerName}
                    onChange={updateHomeownerSearch}
                    onFocus={() => setHomeownerMenuOpen(true)}
                    onBlur={() => window.setTimeout(() => setHomeownerMenuOpen(false), 120)}
                    placeholder="Search homeowner name, block, or lot..."
                    maxLength="120"
                    autoComplete="off"
                    role="combobox"
                    aria-expanded={homeownerMenuOpen}
                    aria-controls="payment-homeowner-options"
                    required
                  />

                  {homeownerMenuOpen && (
                    <div className="payment-homeowner-options" id="payment-homeowner-options" role="listbox">
                      {loading ? (
                        <p className="payment-homeowner-empty">Loading ledger homeowners...</p>
                      ) : matchingHomeowners.length === 0 ? (
                        <p className="payment-homeowner-empty">No matching homeowner found in the ledger.</p>
                      ) : (
                        matchingHomeowners.map((property) => (
                          <button
                            type="button"
                            className={`payment-homeowner-option ${
                              String(property.id) === form.propertyId ? 'is-selected' : ''
                            }`}
                            key={property.id}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectHomeowner(property)}
                            role="option"
                            aria-selected={String(property.id) === form.propertyId}
                          >
                            <span>{property.homeowner_name}</span>
                            <small>{property.block} · Lot {property.lot_number}</small>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                <small className="payment-homeowner-help">
                  Select a homeowner from the ledger to fill the property details.
                </small>
              </div>

              <label>Block
                <input
                  name="blockName"
                  value={form.blockName}
                  placeholder="Filled from ledger"
                  readOnly
                  required
                />
              </label>

              <label>Lot number
                <input
                  name="lotNumber"
                  value={form.lotNumber}
                  placeholder="Filled from ledger"
                  readOnly
                  required
                />
              </label>

              <label className="payment-purpose-field payment-span-2">
                Payment purpose
                <div className="payment-purpose-select-wrap">
                  <select
                    name="paymentPurpose"
                    value={form.paymentPurpose}
                    onChange={updateField}
                    required
                  >
                    <option value="" disabled>Select payment purpose</option>
                    {PAYMENT_PURPOSES.map((purpose) => (
                      <option value={purpose} key={purpose}>
                        {purpose}
                      </option>
                    ))}
                  </select>
                </div>
              </label>

              {form.paymentPurpose === 'Other' && (
                <label className="payment-span-2">Other payment purpose
                  <input
                    name="customPaymentPurpose"
                    value={form.customPaymentPurpose}
                    onChange={updateField}
                    placeholder="Enter the payment purpose"
                    maxLength="80"
                    required
                  />
                </label>
              )}

              <label className="payment-span-2">Coverage period / payment details
                <input
                  name="coveragePeriod"
                  value={form.coveragePeriod}
                  onChange={updateField}
                  placeholder="e.g., July 2026 or Homeowner ID renewal"
                  maxLength="120"
                  required
                />
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
