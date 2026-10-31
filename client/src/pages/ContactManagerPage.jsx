import TransferHomeownerPicker from '../components/TransferHomeownerPicker'
import { transferRequest } from '../lib/homeownerTransfer'
import { useSuccessNotice } from '../lib/useSuccessNotice'
import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Edit, FileArchive, Mail, Phone, RefreshCw, Search } from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import { Pager } from '../components/PagerControls'
import useDebouncedValue from '../hooks/useDebouncedValue'
import { ilikeAny, pageWindow, searchTokens } from '../lib/pagedQuery'
import './ContactManagerPage.css'

const EMPTY_FORM = {
  phone: '',
  email: '',
}

const manilaDate = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

const EMPTY_TRANSFER_FORM = {
  status: 'moved',
  effectiveDate: '',
  reason: '',
  newHomeownerName: '',
  transferTo: 'new',
  targetProperty: null,
}

const MIN_SEARCH_LENGTH = 2

const CONTACT_COLUMNS =
  'id, homeowner_id, block, lot_number, homeowner_name, contact_phone, contact_email, contact_updated_at, homeowner_status, status_effective_date, status_reason, status_updated_at'

// Text columns searched for every typed word. lot_number is an INTEGER column, so it is
// matched separately with .eq (never ilike).
const SEARCH_COLUMNS = [
  'homeowner_name',
  'block',
  'contact_phone',
  'contact_email',
  'homeowner_status',
  'status_reason',
]

// Words that describe a field instead of matching one ("Block C Lot 12").
const IGNORED_WORDS = new Set(['lot'])

const normalize = (value) => String(value ?? '').trim().toLowerCase()

export default function ContactManagerPage({ user: suppliedUser }) {
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState({ active: 0, moved: 0, transferred: 0 })
  const [countsLoading, setCountsLoading] = useState(true)
  const [listLoading, setListLoading] = useState(false)
  const [countError, setCountError] = useState('')
  const [listError, setListError] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [pageState, setPageState] = useState({ key: '', page: 0 })
  const [notice, setNotice] = useSuccessNotice()
  const [selectedContact, setSelectedContact] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [pendingTransferContact, setPendingTransferContact] = useState(null)
  const [transferForm, setTransferForm] = useState(EMPTY_TRANSFER_FORM)
  const [transferringContactId, setTransferringContactId] = useState(null)
  const [transferError, setTransferError] = useState('')

  const role = currentUser?.role?.trim().toLowerCase()
  const canManageContacts = role === 'admin' || role === 'secretary'
  const actorName =
    currentUser?.full_name ||
    currentUser?.name ||
    currentUser?.email ||
    'Staff member'

  // The homeowner list is never loaded up front. It is read from the database only for a
  // search of 2+ characters (or the small Moved / Transferred lists), one page at a time.
  const debouncedSearch = useDebouncedValue(search, 350)
  const tokens = searchTokens(debouncedSearch).filter(
    (token) => !IGNORED_WORDS.has(normalize(token)),
  )
  const hasSearch = debouncedSearch.trim().length >= MIN_SEARCH_LENGTH && tokens.length > 0
  const listsByStatus = statusFilter === 'moved' || statusFilter === 'transferred'
  const shouldList = hasSearch || listsByStatus
  const scopeKey = `${statusFilter}|${debouncedSearch.trim()}`
  const page = pageState.key === scopeKey ? pageState.page : 0

  function goToPage(nextPage) {
    setPageState({ key: scopeKey, page: Math.max(0, nextPage) })
  }

  // Arriving from a homeowner profile ("/contacts?edit=<id>") opens that
  // homeowner's Contact Details dialog straight away. Only that one record is loaded.
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const editId = searchParams.get('edit')
    if (!editId || !role) return undefined

    let cancelled = false

    async function openFromLink() {
      if (canManageContacts && /^\d+$/.test(editId)) {
        const { data } = await supabase
          .from('properties')
          .select(CONTACT_COLUMNS)
          .eq('id', Number(editId))
          .maybeSingle()
        if (!cancelled && data) openContactForm(data)
      }
      if (!cancelled) setSearchParams({}, { replace: true })
    }

    openFromLink()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, role])

  useEffect(() => {
    resolveCurrentUser()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, email, role')
      .eq('id', authUser.id)
      .single()

    if (!profileError) setCurrentUser(profile)
  }

  // Header counts: three tiny count queries, no homeowner rows are downloaded.
  useEffect(() => {
    let cancelled = false

    async function loadCounts() {
      setCountsLoading(true)
      const results = await Promise.all(
        ['active', 'moved', 'transferred'].map((status) =>
          supabase
            .from('properties')
            .select('id', { count: 'exact', head: true })
            .eq('homeowner_status', status),
        ),
      )
      if (cancelled) return

      const failed = results.find((result) => result.error)
      setCountError(
        failed ? `Homeowner counts could not be loaded: ${failed.error.message}` : '',
      )
      setCounts({
        active: results[0].count || 0,
        moved: results[1].count || 0,
        transferred: results[2].count || 0,
      })
      setCountsLoading(false)
    }

    loadCounts()
    return () => { cancelled = true }
  }, [reloadTick])

  // One page of results, read straight from the database.
  useEffect(() => {
    if (!shouldList) {
      setRows([])
      setTotal(0)
      setListError('')
      setListLoading(false)
      return undefined
    }

    let cancelled = false

    async function loadRows() {
      setListLoading(true)
      const { from, to } = pageWindow(page)

      let query = supabase.from('properties').select(CONTACT_COLUMNS, { count: 'exact' })
      if (statusFilter !== 'all') query = query.eq('homeowner_status', statusFilter)

      // Every typed word must match something. Small numbers also match the lot number.
      tokens.forEach((token) => {
        const parts = [ilikeAny(SEARCH_COLUMNS, token)]
        if (/^\d{1,6}$/.test(token)) parts.push(`lot_number.eq.${token}`)
        query = query.or(parts.join(','))
      })

      const { data, error, count } = await query
        .order('homeowner_name', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)

      if (cancelled) return

      if (error) {
        setListError(`Contact directory could not be loaded: ${error.message}`)
        setRows([])
        setTotal(0)
      } else if ((data || []).length === 0 && page > 0 && (count || 0) > 0) {
        // The page emptied (for example after a status change): step back one page.
        goToPage(page - 1)
        return
      } else {
        setListError('')
        setRows(data || [])
        setTotal(count || 0)
      }
      setListLoading(false)
    }

    loadRows()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, page, reloadTick, shouldList])

  function openContactForm(contact) {
    setSelectedContact(contact)
    setForm({
      phone: contact.contact_phone || '',
      email: contact.contact_email || '',
    })
    setFormError('')
    setNotice('')
  }

  function closeContactForm() {
    if (saving) return
    setSelectedContact(null)
    setForm(EMPTY_FORM)
    setFormError('')
  }

  function updateField(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setFormError('')
  }

  async function saveContact(event) {
    event.preventDefault()

    if (!selectedContact || !canManageContacts) {
      setFormError('Only an Admin or Secretary can update contact details.')
      return
    }

    const phone = form.phone.trim().replace(/\s+/g, ' ')
    const email = form.email.trim().toLowerCase()

    if (phone.length > 30) {
      setFormError('Phone number must be 30 characters or fewer.')
      return
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFormError('Enter a valid email address.')
      return
    }

    setSaving(true)
    setFormError('')

    const contactUpdatedAt = new Date().toISOString()
    const { data, error } = await supabase
      .from('properties')
      .update({
        contact_phone: phone || null,
        contact_email: email || null,
        contact_updated_at: contactUpdatedAt,
      })
      .eq('id', selectedContact.id)
      .select(CONTACT_COLUMNS)
      .single()

    if (error) {
      setFormError(error.message)
      setSaving(false)
      return
    }

    // Re-read the current page and the header counts from the database.
    setReloadTick((tick) => tick + 1)

    if (currentUser?.id) {
      const { error: activityError } = await supabase
        .from('activity_log')
        .insert({
          user_id: currentUser.id,
          action: 'Contact Updated',
          target: `${data.homeowner_name} — ${data.block}, Lot ${data.lot_number} (by ${actorName})`,
        })

      if (activityError) {
        console.warn(
          'Contact saved, but activity logging failed:',
          activityError.message,
        )
      }
    }

    setSelectedContact(null)
    setForm(EMPTY_FORM)
    setSaving(false)
    setNotice(`Contact details for ${data.homeowner_name} were saved.`)
  }

  function requestTransferContact(contact) {
    if (!canManageContacts) return
    setTransferError('')
    setTransferForm({
      ...EMPTY_TRANSFER_FORM,
      status: 'moved',
      effectiveDate: manilaDate(),
      reason: '',
      newHomeownerName: '',
    })
    setPendingTransferContact(contact)
  }

  function closeTransferForm() {
    if (transferringContactId) return
    setPendingTransferContact(null)
    setTransferForm(EMPTY_TRANSFER_FORM)
    setTransferError('')
  }

  async function markMovedOrTransferred(event) {
    event.preventDefault()

    const contact = pendingTransferContact
    if (!contact || !canManageContacts) return

    if (!['moved', 'transferred'].includes(transferForm.status)) {
      setTransferError('Choose whether the homeowner moved or transferred.')
      return
    }

    if (!transferForm.effectiveDate) {
      setTransferError('Enter the Effective date.')
      return
    }

    let request
    if (transferForm.status === 'transferred') {
      try { request = transferRequest(contact.id, transferForm) }
      catch (error) { setTransferError(error.message); return }
    }

    setTransferringContactId(contact.id)
    setTransferError('')


    if (transferForm.status === 'transferred') {
      const targetName = transferForm.transferTo === 'existing'
        ? transferForm.targetProperty.homeowner_name : transferForm.newHomeownerName.trim()
      const { data, error } = await supabase.rpc(request.name, request.args)

      if (error) {
        setTransferringContactId(null)
        setTransferError(`Could not transfer homeowner: ${error.message}`)
        return
      }

      const result = Array.isArray(data) ? data[0] : data

      setReloadTick((tick) => tick + 1)
      setTransferringContactId(null)
      setPendingTransferContact(null)
      setTransferForm(EMPTY_TRANSFER_FORM)

      setNotice(
        `${contact.block}, Lot ${contact.lot_number} was transferred to ${targetName}. Balance transferred: ${Number(
          result?.transferred_balance ?? 0
        ).toLocaleString('en-PH', {
          style: 'currency',
          currency: 'PHP',
        })}. Previous payment history was preserved.`
      )

      return
    }


    const statusUpdatedAt = new Date().toISOString()
    const { error } = await supabase
      .from('properties')

      .update({
        homeowner_status: transferForm.status,
        status_effective_date: transferForm.effectiveDate,
        status_reason: transferForm.reason.trim() || null,
        status_updated_at: statusUpdatedAt,
      })
      .eq('id', contact.id)
      .select(
        'id, block, lot_number, homeowner_name, contact_phone, contact_email, contact_updated_at, homeowner_status, status_effective_date, status_reason, status_updated_at',
      )
      .single()

    if (error) {
      setTransferringContactId(null)
      setTransferError(`Could not update homeowner status: ${error.message}`)
      return
    }

    setReloadTick((tick) => tick + 1)

    if (currentUser?.id) {
      const { error: activityError } = await supabase.from('activity_log').insert({
        user_id: currentUser.id,
        action: `Homeowner ${transferForm.status === 'moved' ? 'Moved' : 'Transferred'}`,
        target: `${contact.homeowner_name} — ${contact.block}, Lot ${contact.lot_number}; Effective ${transferForm.effectiveDate} (by ${actorName})`,
      })

      if (activityError) {
        console.warn(
          'Homeowner status updated, but activity logging failed:',
          activityError.message,
        )
      }
    }

    const statusLabel = transferForm.status === 'moved' ? 'Moved' : 'Transferred'
    setTransferringContactId(null)
    setPendingTransferContact(null)
    setTransferForm(EMPTY_TRANSFER_FORM)
    setNotice(
      `${contact.homeowner_name} was marked as ${statusLabel}. Their profile and payment history were preserved.`,
    )
  }

  const { from: pageFrom } = pageWindow(page)
  const rangeStart = total === 0 ? 0 : pageFrom + 1
  const rangeEnd = pageFrom + rows.length
  const pageError = [countError, listError].filter(Boolean).join(' ')

  return (
    <div className="contact-page">
      <div className="contact-header">
        <div>
          <p className="contact-eyebrow">Secretary workspace</p>
          <h1>Contact Manager</h1>
          <p>Homeowner directory and contact information.</p>
        </div>

        <div className="contact-header-actions">
          <button
            type="button"
            className="contact-refresh-button"
            onClick={() => setReloadTick((tick) => tick + 1)}
            disabled={countsLoading || listLoading}
          >
            <RefreshCw size={17} className={countsLoading || listLoading ? 'contact-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      <div className="contact-summary">
        <div className="contact-summary-item is-active">
          <strong>{countsLoading ? '—' : String(counts.active).padStart(2, '0')}</strong>
          <span>Active homeowners</span>
        </div>
        <div className="contact-summary-item is-moved">
          <strong>{countsLoading ? '—' : String(counts.moved).padStart(2, '0')}</strong>
          <span>Moved homeowners</span>
        </div>
        <div className="contact-summary-item is-transferred">
          <strong>{countsLoading ? '—' : String(counts.transferred).padStart(2, '0')}</strong>
          <span>Transferred homeowners</span>
        </div>
      </div>

      <div className="contact-toolbar">
        <div className="contact-search-wrap">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            placeholder="Search by name, block, lot, phone, or email..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="contact-search"
            aria-label="Search homeowner contacts"
          />
        </div>
        <select
          className="contact-status-filter"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          aria-label="Filter homeowners by residency status"
        >
          <option value="active">Active</option>
          <option value="moved">Moved</option>
          <option value="transferred">Transferred</option>
          <option value="all">All statuses</option>
        </select>
        {shouldList && (
          <span className="contact-result-count">
            Showing {rangeStart}-{rangeEnd} of {total}
          </span>
        )}
      </div>

      {pageError && (
        <p className="contact-message contact-error" role="alert">
          {pageError}
        </p>
      )}
      {notice && (
        <p className="contact-message contact-success" role="status" aria-live="polite">
          {notice}
        </p>
      )}
      {transferError && !pendingTransferContact && (
        <p className="contact-message contact-error" role="alert">
          {transferError}
        </p>
      )}

      {!shouldList ? (
        <div className="contact-empty glass-card">
          <span style={{ display: 'inline-flex', opacity: 0.6 }}>
            <Search size={30} aria-hidden="true" />
          </span>
          <h3 style={{ margin: '10px 0 6px', color: 'var(--text-dark)', fontSize: '1.05rem', fontWeight: 600 }}>
            Search for a homeowner
          </h3>
          <p style={{ margin: '0 auto', maxWidth: 460, fontSize: '0.88rem', lineHeight: 1.5 }}>
            Type at least {MIN_SEARCH_LENGTH} characters of a name, block, lot, phone, or email — or
            choose Moved or Transferred — to see homeowners. They aren't listed by default so the
            page stays fast as the roster grows.
          </p>
        </div>
      ) : listLoading && rows.length === 0 ? (
        <div className="contact-empty glass-card">Loading contacts...</div>
      ) : rows.length === 0 ? (
        <div className="contact-empty glass-card">
          {hasSearch
            ? 'No contacts match your search.'
            : `No ${statusFilter} homeowners.`}
        </div>
      ) : (
        <div className="contact-grid">
          {rows.map((contact) => {
            const hasContactDetails =
              contact.contact_phone || contact.contact_email
            const homeownerStatus = normalize(contact.homeowner_status || 'active')
            const isActive = homeownerStatus === 'active'
            const statusLabel =
              homeownerStatus === 'transferred'
                ? 'Transferred'
                : homeownerStatus === 'moved'
                  ? 'Moved'
                  : 'Active'

            return (
              <article key={contact.id} className={`contact-card glass-card is-${homeownerStatus}`}>
                <div className="contact-plaque" aria-hidden="true">
                  <span className="contact-plaque-block">{contact.block}</span>
                  <span className="contact-plaque-lot">Lot {contact.lot_number}</span>
                </div>

                <div className="contact-card-body">
                  <div className="contact-card-heading">
                    <div className="contact-avatar">
                      {(contact.homeowner_name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h2 className="contact-name">
                        {contact.homeowner_name || 'Unnamed homeowner'}
                      </h2>
                      <span className={`contact-status-badge is-${homeownerStatus}`}>
                        {statusLabel}
                      </span>
                    </div>
                  </div>

                  <div className="contact-details">
                    <div className="contact-detail">
                      <Phone size={16} />
                      {contact.contact_phone ? (
                        <a href={`tel:${contact.contact_phone}`}>
                          {contact.contact_phone}
                        </a>
                      ) : (
                        <span className="contact-missing">Phone not provided</span>
                      )}
                    </div>
                    <div className="contact-detail">
                      <Mail size={16} />
                      {contact.contact_email ? (
                        <a href={`mailto:${contact.contact_email}`}>
                          {contact.contact_email}
                        </a>
                      ) : (
                        <span className="contact-missing">Email not provided</span>
                      )}
                    </div>
                  </div>

                  {isActive ? (
                    canManageContacts && (
                      <div className="contact-card-actions">
                        <button
                          type="button"
                          className="contact-edit-button"
                          onClick={() => openContactForm(contact)}
                        >
                          <Edit size={16} />
                          {hasContactDetails
                            ? 'Edit Contact Details'
                            : 'Add Contact Details'}
                        </button>
                        <button
                          type="button"
                          className="contact-transfer-button"
                          onClick={() => requestTransferContact(contact)}
                          disabled={transferringContactId === contact.id}
                          aria-label={`Mark ${contact.homeowner_name} as moved or transferred`}
                          title="Mark as moved or transferred"
                        >
                          <FileArchive size={16} />
                          Move / Transfer
                        </button>
                      </div>
                    )
                  ) : (
                    <div className="contact-card-history-note">
                      <span className="contact-card-history-label">
                        {statusLabel}
                        {contact.status_effective_date
                          ? ` since ${contact.status_effective_date}`
                          : ''}
                      </span>
                      {contact.status_reason && (
                        <span className="contact-card-history-reason">
                          {contact.status_reason}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {shouldList && total > 0 && (
        <Pager page={page} total={total} onPageChange={goToPage} disabled={listLoading} />
      )}

      {pendingTransferContact && (
        <div
          className="contact-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeTransferForm()
          }}
        >
          <form
            className="contact-modal contact-transfer-modal glass-card"
            onSubmit={markMovedOrTransferred}
            role="dialog"
            aria-modal="true"
            aria-labelledby="transfer-homeowner-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="contact-modal-heading">
              <div>
                <h2 id="transfer-homeowner-title">Move or transfer this lot</h2>
                <p>
                  Only this lot changes owner. Previous records are kept.
                </p>
              </div>
              <button
                type="button"
                className="contact-modal-close"
                onClick={closeTransferForm}
                aria-label="Close move or transfer form"
              >
                ×
              </button>
            </div>

            <div className="contact-transfer-homeowner">
              <strong>{pendingTransferContact.homeowner_name}</strong>
              <span>
                {pendingTransferContact.block}, Lot {pendingTransferContact.lot_number}
              </span>
            </div>

            <fieldset className="contact-transfer-fields" disabled={Boolean(transferringContactId)}>
            <div className="contact-form-row">
              <div>
                <label htmlFor="homeowner-new-status">Action</label>
                <select
                  id="homeowner-new-status"
                  value={transferForm.status === 'moved' ? 'moved' : transferForm.transferTo}
                  onChange={(event) =>
                    setTransferForm((current) => ({
                      ...current,
                      status: event.target.value === 'moved' ? 'moved' : 'transferred',
                      transferTo: event.target.value === 'existing' ? 'existing' : 'new',
                      targetProperty: null,
                    }))
                  }
                  required
                >
                  <option value="moved">Mark as moved</option>
                  <option value="existing">Transfer to an Existing homeowner</option>
                  <option value="new">Transfer to a New homeowner</option>
                </select>
              </div>
              <div>
                <label htmlFor="homeowner-status-date">Effective date</label>
                <input
                  id="homeowner-status-date"
                  type="date"
                  value={transferForm.effectiveDate}
                  max={manilaDate()}
                  onChange={(event) =>
                    setTransferForm((current) => ({
                      ...current,
                      effectiveDate: event.target.value,
                    }))
                  }
                  required
                />
              </div>
            </div>

                  
            {transferForm.status === 'transferred' && transferForm.transferTo === 'new' && (
              <>
                <label htmlFor="homeowner-new-owner-name">
                  New homeowner name
                </label>
                <input
                  id="homeowner-new-owner-name"
                  type="text"
                  value={transferForm.newHomeownerName}
                  maxLength={120}
                  placeholder="Enter the new owner's full name"
                  onChange={(event) =>
                    setTransferForm((current) => ({
                      ...current,
                      newHomeownerName: event.target.value,
                    }))
                  }
                  required
                />
              </>
            )}



            {transferForm.status === 'transferred' && transferForm.transferTo === 'existing' && (
              <TransferHomeownerPicker previousProperty={pendingTransferContact}
                selected={transferForm.targetProperty} disabled={Boolean(transferringContactId)}
                onSelect={(person) => setTransferForm((current) => ({ ...current, targetProperty: person }))} />
            )}

            <label htmlFor="homeowner-status-reason">Reason or note (optional)</label>
            <textarea
              id="homeowner-status-reason"
              value={transferForm.reason}
              maxLength={500}
              placeholder="Add a short note about the move or property transfer."
              onChange={(event) =>
                setTransferForm((current) => ({
                  ...current,
                  reason: event.target.value,
                }))
              }
            />

            <p className="contact-transfer-note">
              {transferForm.status === 'transferred' ? 'This lot’s balance or advance payment moves to its new owner. Other lots keep their own balances. Previous records are kept.' : 'This frees the lot while keeping the homeowner’s records.'}
            </p>

            </fieldset>
            {transferError && <p className="contact-form-error" role="alert">{transferError}</p>}

            <div className="contact-modal-actions">
              <button
                type="button"
                className="contact-cancel-button"
                onClick={closeTransferForm}
                disabled={Boolean(transferringContactId)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="contact-save-button"
                disabled={Boolean(transferringContactId)}
              >
                {transferringContactId ? 'Saving...' : transferForm.status === 'transferred' ? 'Confirm transfer' : 'Confirm move'}
              </button>
            </div>
          </form>
        </div>
      )}

      {selectedContact && (
        <div
          className="contact-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeContactForm()
          }}
        >
          <form
            className="contact-modal glass-card"
            onSubmit={saveContact}
            role="dialog"
            aria-modal="true"
            aria-labelledby="contact-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="contact-modal-heading">
              <div>
                <h2 id="contact-modal-title">Contact Details</h2>
                <p>
                  {selectedContact.homeowner_name} — {selectedContact.block}, Lot{' '}
                  {selectedContact.lot_number}
                </p>
              </div>
              <button
                type="button"
                className="contact-modal-close"
                onClick={closeContactForm}
                aria-label="Close contact form"
              >
                ×
              </button>
            </div>

            <label htmlFor="contact-phone">Phone Number</label>
            <input
              id="contact-phone"
              name="phone"
              type="tel"
              value={form.phone}
              onChange={updateField}
              placeholder="e.g. 0917 123 4567"
              maxLength={30}
            />

            <label htmlFor="contact-email">Email Address</label>
            <input
              id="contact-email"
              name="email"
              type="email"
              value={form.email}
              onChange={updateField}
              placeholder="e.g. homeowner@email.com"
            />

            <p className="contact-form-note">
              Leave a field blank if that contact method is unavailable.
            </p>

            {formError && <p className="contact-form-error">{formError}</p>}

            <div className="contact-modal-actions">
              <button
                type="button"
                className="contact-cancel-button"
                onClick={closeContactForm}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="contact-save-button"
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save Contact'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}