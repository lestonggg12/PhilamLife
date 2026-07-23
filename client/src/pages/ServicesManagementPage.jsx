import React, { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle,
  CreditCard,
  Eye,
  FileText,
  Plus,
  RefreshCw,
  X,
} from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import './ServicesManagementPage.css'

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 2,
})

const dateTime = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Manila',
})

const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

function isCurrentManilaMonth(value) {
  if (!value) return false
  const parts = (date) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
    }).format(date)

  return parts(new Date(value)) === parts(new Date())
}

const emptyService = {
  name: '',
  description: '',
  rate: '',
  rate_unit: 'per use',
  is_active: true,
}

const emptyTransaction = {
  service_id: '',
  property_id: '',
  service_date: today(),
  start_time: '',
  quantity: '1',
  amount_paid: '',
  payment_method: 'Cash',
  reference_number: '',
  notes: '',
}

export default function ServicesManagementPage({ user: suppliedUser }) {
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [services, setServices] = useState([])
  const [transactions, setTransactions] = useState([])
  const [properties, setProperties] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pageError, setPageError] = useState('')
  const [search, setSearch] = useState('')
  const [serviceFilter, setServiceFilter] = useState('all')
  const [showServiceForm, setShowServiceForm] = useState(false)
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [editingServiceId, setEditingServiceId] = useState(null)
  const [serviceForm, setServiceForm] = useState(emptyService)
  const [transactionForm, setTransactionForm] = useState(emptyTransaction)
  const [receipt, setReceipt] = useState(null)

  const role = currentUser?.role?.trim().toLowerCase()
  const canManageServices = role === 'secretary'
  const recorderName =
    currentUser?.full_name || currentUser?.name || currentUser?.email || 'Secretary'

  useEffect(() => {
    loadPage()
    resolveCurrentUser()
  }, [])

  async function resolveCurrentUser() {
    if (suppliedUser) {
      setCurrentUser(suppliedUser)
      return
    }

    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !authUser) return

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .single()

    if (!error) setCurrentUser(profile)
  }

  async function loadPage() {
    setLoading(true)
    setPageError('')

    const [serviceResult, transactionResult, propertyResult] = await Promise.all([
      supabase.from('amenity_services').select('*').order('name'),
      supabase
        .from('service_transactions')
        .select('*')
        .order('paid_at', { ascending: false }),
      supabase
        .from('properties')
        .select('id, homeowner_name, block, lot_number')
        .order('homeowner_name'),
    ])

    const errors = [
      serviceResult.error,
      transactionResult.error,
      propertyResult.error,
    ].filter(Boolean)

    if (errors.length) {
      setPageError(
        `Some service records could not be loaded: ${errors
          .map((error) => error.message)
          .join(' ')}`,
      )
    }

    setServices(serviceResult.data || [])
    setTransactions(transactionResult.data || [])
    setProperties(propertyResult.data || [])
    setLoading(false)
  }

  const activeServices = useMemo(
    () => services.filter((service) => service.is_active),
    [services],
  )

  const summary = useMemo(() => {
    const thisMonth = transactions.filter((item) =>
      isCurrentManilaMonth(item.paid_at),
    )

    return {
      activeServices: activeServices.length,
      monthlyTransactions: thisMonth.length,
      monthlyCollections: thisMonth.reduce(
        (sum, item) => sum + (Number(item.amount_paid) || 0),
        0,
      ),
      receipts: transactions.length,
    }
  }, [activeServices, transactions])

  const filteredTransactions = useMemo(() => {
    const query = search.trim().toLowerCase()

    return transactions.filter((item) => {
      const matchesService =
        serviceFilter === 'all' || item.service_id === serviceFilter
      const matchesSearch =
        !query ||
        [
          item.receipt_number,
          item.service_name,
          item.customer_name,
          item.block_name,
          item.lot_number,
        ].some((value) => String(value || '').toLowerCase().includes(query))

      return matchesService && matchesSearch
    })
  }, [search, serviceFilter, transactions])

  const selectedService = services.find(
    (service) => service.id === transactionForm.service_id,
  )
  const amountDue =
    (Number(selectedService?.rate) || 0) *
    Math.max(Number(transactionForm.quantity) || 1, 1)

  function openPaymentForm(service = null) {
    if (!canManageServices) return

    const chosen = service || activeServices[0]
    setTransactionForm({
      ...emptyTransaction,
      service_date: today(),
      service_id: chosen?.id || '',
      amount_paid: chosen?.rate ? String(chosen.rate) : '',
    })
    setShowPaymentForm(true)
  }

  function openServiceForm(service = null) {
    setEditingServiceId(service?.id || null)
    setServiceForm(
      service
        ? {
            name: service.name,
            description: service.description || '',
            rate: String(service.rate),
            rate_unit: service.rate_unit,
            is_active: service.is_active,
          }
        : emptyService,
    )
    setShowServiceForm(true)
  }

  function handleServiceChange(event) {
    const service = services.find((item) => item.id === event.target.value)
    setTransactionForm((current) => ({
      ...current,
      service_id: event.target.value,
      amount_paid: service?.rate ? String(service.rate) : '',
    }))
  }

  async function saveService(event) {
    event.preventDefault()
    if (!canManageServices || !currentUser?.id) {
      setPageError('Only a verified Secretary can add an amenity or service.')
      return
    }

    setSaving(true)
    setPageError('')

    const payload = {
      name: serviceForm.name.trim(),
      description: serviceForm.description.trim() || null,
      rate: Number(serviceForm.rate),
      rate_unit: serviceForm.rate_unit,
      is_active: serviceForm.is_active,
    }

    const query = editingServiceId
      ? supabase
          .from('amenity_services')
          .update(payload)
          .eq('id', editingServiceId)
      : supabase
          .from('amenity_services')
          .insert({ ...payload, created_by: currentUser.id })

    const { data, error } = await query.select('*').single()

    if (error) {
      setPageError(error.message)
      setSaving(false)
      return
    }

    setServices((current) => {
      const updated = editingServiceId
        ? current.map((item) => (item.id === data.id ? data : item))
        : [...current, data]
      return updated.sort((left, right) => left.name.localeCompare(right.name))
    })
    setServiceForm(emptyService)
    setEditingServiceId(null)
    setShowServiceForm(false)
    setSaving(false)

    await supabase.from('activity_log').insert({
      user_id: currentUser.id,
      action: editingServiceId ? 'Service Updated' : 'Service Added',
      target: `${data.name} (${recorderName})`,
    })
  }

  async function saveTransaction(event) {
    event.preventDefault()
    if (!canManageServices || !currentUser?.id) {
      setPageError('Only a verified Secretary can record service payments.')
      return
    }

    const property = properties.find(
      (item) => String(item.id) === transactionForm.property_id,
    )
    const service = services.find(
      (item) => item.id === transactionForm.service_id,
    )

    if (!property || !service) {
      setPageError('Select a valid homeowner and service.')
      return
    }

    setSaving(true)
    setPageError('')

    const paid = Number(transactionForm.amount_paid)
    const payload = {
      service_id: service.id,
      service_name: service.name,
      customer_name: property.homeowner_name,
      block_name: property.block,
      lot_number: String(property.lot_number),
      service_date: transactionForm.service_date,
      start_time: transactionForm.start_time || null,
      quantity: Math.max(Number(transactionForm.quantity) || 1, 1),
      amount_due: amountDue,
      amount_paid: paid,
      payment_method: transactionForm.payment_method,
      reference_number: transactionForm.reference_number.trim() || null,
      notes: transactionForm.notes.trim() || null,
      payment_status: paid >= amountDue ? 'paid' : 'partial',
      recorded_by: currentUser.id,
      recorded_by_name: recorderName,
    }

    const { data, error } = await supabase
      .from('service_transactions')
      .insert(payload)
      .select('*')
      .single()

    if (error) {
      setPageError(error.message)
      setSaving(false)
      return
    }

    setTransactions((current) => [data, ...current])
    setTransactionForm(emptyTransaction)
    setShowPaymentForm(false)
    setReceipt(data)
    setSaving(false)

    const { error: activityError } = await supabase.from('activity_log').insert({
      user_id: currentUser.id,
      action: 'Service Payment Recorded',
      target: `${data.receipt_number} — ${data.service_name} for ${data.customer_name}`,
    })

    if (activityError) {
      console.warn('Service saved, but activity logging failed:', activityError.message)
    }
  }

  return (
    <div className="services-page">
      <header className="services-header">
        <div>
          <p className="services-eyebrow">Secretary workspace</p>
          <h1>Services Management</h1>
          <p>Manage village amenities, process service payments, and issue receipts.</p>
        </div>

        <div className="services-header-actions">
          <button
            type="button"
            className="services-button services-button-secondary"
            onClick={loadPage}
            disabled={loading}
          >
            <RefreshCw size={17} />
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          {canManageServices && (
            <>
              <button
                type="button"
                className="services-button services-button-secondary"
                onClick={() => openServiceForm()}
              >
                <Plus size={17} /> Add Service
              </button>
              <button
                type="button"
                className="services-button services-button-primary"
                onClick={() => openPaymentForm()}
                disabled={activeServices.length === 0}
              >
                <CreditCard size={17} /> Record Payment
              </button>
            </>
          )}
        </div>
      </header>

      {pageError && <p className="services-error">{pageError}</p>}
      {!loading && !canManageServices && (
        <p className="services-notice">
          You have view-only access. Service management and payment actions are
          restricted to the Secretary.
        </p>
      )}

      <section className="services-summary" aria-label="Service summaries">
        <article>
          <span>Active Services</span>
          <strong>{loading ? '—' : summary.activeServices}</strong>
          <small>Available village amenities</small>
        </article>
        <article>
          <span>Transactions This Month</span>
          <strong>{loading ? '—' : summary.monthlyTransactions}</strong>
          <small>Service payments recorded</small>
        </article>
        <article>
          <span>Collections This Month</span>
          <strong>{loading ? '—' : peso.format(summary.monthlyCollections)}</strong>
          <small>Based on Manila time</small>
        </article>
        <article>
          <span>Receipts Issued</span>
          <strong>{loading ? '—' : summary.receipts}</strong>
          <small>Permanent service records</small>
        </article>
      </section>

      <section className="service-catalog">
        <div className="services-section-heading">
          <div>
            <h2>Amenities & Services</h2>
            <p>Select an active amenity to record a payment.</p>
          </div>
        </div>

        {loading ? (
          <div className="services-state">Loading services...</div>
        ) : services.length === 0 ? (
          <div className="services-state">No services have been added yet.</div>
        ) : (
          <div className="service-card-grid">
            {services.map((service) => (
              <article
                className={`service-card${service.is_active ? '' : ' service-card-inactive'}`}
                key={service.id}
              >
                <div className="service-card-top">
                  <span className="service-card-icon"><FileText size={19} /></span>
                  <span className={`service-status ${service.is_active ? 'active' : 'inactive'}`}>
                    {service.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <h3>{service.name}</h3>
                <p>{service.description || 'Village amenity or service.'}</p>
                <div className="service-rate">
                  <strong>{peso.format(Number(service.rate) || 0)}</strong>
                  <span>{service.rate_unit}</span>
                </div>
                {canManageServices && (
                  <div className="service-card-actions">
                    <button type="button" onClick={() => openServiceForm(service)}>
                      Edit
                    </button>
                    {service.is_active && (
                      <button type="button" onClick={() => openPaymentForm(service)}>
                        Record payment
                      </button>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="services-transactions">
        <div className="services-section-heading services-transaction-heading">
          <div>
            <h2>Service Transactions</h2>
            <p>Search payments and open their official receipts.</p>
          </div>
          <div className="services-filters">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search receipt, service, or homeowner..."
            />
            <select
              value={serviceFilter}
              onChange={(event) => setServiceFilter(event.target.value)}
            >
              <option value="all">All services</option>
              {services.map((service) => (
                <option value={service.id} key={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="services-table-wrap">
          <table className="services-table">
            <thead>
              <tr>
                <th>Receipt No.</th>
                <th>Service</th>
                <th>Homeowner</th>
                <th>Schedule</th>
                <th>Amount Paid</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="7" className="services-empty">Loading transactions...</td></tr>
              ) : filteredTransactions.length === 0 ? (
                <tr><td colSpan="7" className="services-empty">No service transactions found.</td></tr>
              ) : (
                filteredTransactions.map((item) => (
                  <tr key={item.id}>
                    <td><strong>{item.receipt_number}</strong></td>
                    <td>{item.service_name}</td>
                    <td>
                      <strong>{item.customer_name}</strong>
                      <span>{item.block_name}, Lot {item.lot_number}</span>
                    </td>
                    <td>
                      {item.service_date}
                      {item.start_time ? ` • ${item.start_time.slice(0, 5)}` : ''}
                    </td>
                    <td>{peso.format(Number(item.amount_paid) || 0)}</td>
                    <td>
                      <span className={`payment-status ${item.payment_status}`}>
                        {item.payment_status}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="receipt-link"
                        onClick={() => setReceipt(item)}
                      >
                        <Eye size={16} /> Receipt
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {showServiceForm && (
        <div className="services-modal-backdrop" role="presentation">
          <form className="services-modal" onSubmit={saveService}>
            <div className="services-modal-header">
              <div>
                <h2>{editingServiceId ? 'Edit Amenity or Service' : 'Add Amenity or Service'}</h2>
                <p>Set its standard rate and availability.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowServiceForm(false)
                  setEditingServiceId(null)
                }}
                aria-label="Close"
              >
                <X size={19} />
              </button>
            </div>
            <label>
              Service name
              <input
                required
                value={serviceForm.name}
                onChange={(event) =>
                  setServiceForm((current) => ({ ...current, name: event.target.value }))
                }
              />
            </label>
            <label>
              Description
              <textarea
                rows="3"
                value={serviceForm.description}
                onChange={(event) =>
                  setServiceForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </label>
            <div className="services-form-row">
              <label>
                Standard rate
                <input
                  required
                  min="0"
                  step="0.01"
                  type="number"
                  value={serviceForm.rate}
                  onChange={(event) =>
                    setServiceForm((current) => ({ ...current, rate: event.target.value }))
                  }
                />
              </label>
              <label>
                Rate unit
                <select
                  value={serviceForm.rate_unit}
                  onChange={(event) =>
                    setServiceForm((current) => ({
                      ...current,
                      rate_unit: event.target.value,
                    }))
                  }
                >
                  <option>per use</option>
                  <option>per hour</option>
                  <option>per person</option>
                  <option>per day</option>
                </select>
              </label>
            </div>
            <label className="services-checkbox">
              <input
                type="checkbox"
                checked={serviceForm.is_active}
                onChange={(event) =>
                  setServiceForm((current) => ({
                    ...current,
                    is_active: event.target.checked,
                  }))
                }
              />
              Active and available for new payments
            </label>
            <div className="services-modal-actions">
              <button
                type="button"
                onClick={() => {
                  setShowServiceForm(false)
                  setEditingServiceId(null)
                }}
              >
                Cancel
              </button>
              <button type="submit" disabled={saving}>
                {saving
                  ? 'Saving...'
                  : editingServiceId
                    ? 'Save Changes'
                    : 'Add Service'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showPaymentForm && (
        <div className="services-modal-backdrop" role="presentation">
          <form className="services-modal services-payment-modal" onSubmit={saveTransaction}>
            <div className="services-modal-header">
              <div>
                <h2>Record Service Payment</h2>
                <p>The official receipt is created only after a successful save.</p>
              </div>
              <button type="button" onClick={() => setShowPaymentForm(false)} aria-label="Close">
                <X size={19} />
              </button>
            </div>

            <div className="services-form-row">
              <label>
                Service
                <select
                  required
                  value={transactionForm.service_id}
                  onChange={handleServiceChange}
                >
                  <option value="">Select service</option>
                  {activeServices.map((service) => (
                    <option value={service.id} key={service.id}>{service.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Homeowner
                <select
                  required
                  value={transactionForm.property_id}
                  onChange={(event) =>
                    setTransactionForm((current) => ({
                      ...current,
                      property_id: event.target.value,
                    }))
                  }
                >
                  <option value="">Select homeowner</option>
                  {properties.map((property) => (
                    <option value={String(property.id)} key={property.id}>
                      {property.homeowner_name} — {property.block}, Lot {property.lot_number}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="services-form-row services-form-row-three">
              <label>
                Service date
                <input
                  required
                  type="date"
                  value={transactionForm.service_date}
                  onChange={(event) =>
                    setTransactionForm((current) => ({
                      ...current,
                      service_date: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Start time
                <input
                  type="time"
                  value={transactionForm.start_time}
                  onChange={(event) =>
                    setTransactionForm((current) => ({
                      ...current,
                      start_time: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Quantity
                <input
                  required
                  min="1"
                  type="number"
                  value={transactionForm.quantity}
                  onChange={(event) =>
                    setTransactionForm((current) => ({
                      ...current,
                      quantity: event.target.value,
                    }))
                  }
                />
              </label>
            </div>

            <div className="services-amount-due">
              <span>Amount due</span>
              <strong>{peso.format(amountDue)}</strong>
            </div>

            <div className="services-form-row">
              <label>
                Amount paid
                <input
                  required
                  min="0.01"
                  step="0.01"
                  type="number"
                  value={transactionForm.amount_paid}
                  onChange={(event) =>
                    setTransactionForm((current) => ({
                      ...current,
                      amount_paid: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Payment method
                <select
                  value={transactionForm.payment_method}
                  onChange={(event) =>
                    setTransactionForm((current) => ({
                      ...current,
                      payment_method: event.target.value,
                    }))
                  }
                >
                  <option>Cash</option>
                  <option>GCash</option>
                  <option>Bank Transfer</option>
                  <option>Check</option>
                </select>
              </label>
            </div>

            <label>
              Reference number
              <input
                value={transactionForm.reference_number}
                onChange={(event) =>
                  setTransactionForm((current) => ({
                    ...current,
                    reference_number: event.target.value,
                  }))
                }
                placeholder="Optional for cash payments"
              />
            </label>
            <label>
              Notes
              <textarea
                rows="2"
                value={transactionForm.notes}
                onChange={(event) =>
                  setTransactionForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
              />
            </label>
            <div className="services-modal-actions">
              <button type="button" onClick={() => setShowPaymentForm(false)}>
                Cancel
              </button>
              <button type="submit" disabled={saving || amountDue <= 0}>
                {saving ? 'Saving...' : 'Save & Issue Receipt'}
              </button>
            </div>
          </form>
        </div>
      )}

      {receipt && (
        <div className="services-modal-backdrop" role="presentation">
          <article className="service-receipt">
            <div className="receipt-success"><CheckCircle size={24} /></div>
            <p className="receipt-kicker">PHILAM Village Homeowners Association</p>
            <h2>Official Service Receipt</h2>
            <strong className="receipt-number">{receipt.receipt_number}</strong>
            <dl>
              <div><dt>Received from</dt><dd>{receipt.customer_name}</dd></div>
              <div><dt>Property</dt><dd>{receipt.block_name}, Lot {receipt.lot_number}</dd></div>
              <div><dt>Service</dt><dd>{receipt.service_name}</dd></div>
              <div><dt>Service date</dt><dd>{receipt.service_date}</dd></div>
              <div><dt>Amount paid</dt><dd>{peso.format(Number(receipt.amount_paid) || 0)}</dd></div>
              <div><dt>Payment method</dt><dd>{receipt.payment_method}</dd></div>
              <div><dt>Date issued</dt><dd>{dateTime.format(new Date(receipt.paid_at))}</dd></div>
              <div><dt>Processed by</dt><dd>{receipt.recorded_by_name}</dd></div>
            </dl>
            <p className="receipt-note">
              This receipt is a permanent transaction record and cannot be deleted
              from the Services Management page.
            </p>
            <div className="services-modal-actions">
              <button type="button" onClick={() => setReceipt(null)}>Close</button>
              <button type="button" onClick={() => window.print()}>Print Receipt</button>
            </div>
          </article>
        </div>
      )}
    </div>
  )
}