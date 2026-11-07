import TransferHomeownerPicker from '../components/TransferHomeownerPicker'
import { transferRequest, transferAmountDescription } from '../lib/homeownerTransfer'
import { useSuccessNotice } from '../lib/useSuccessNotice'
import React, { useEffect, useRef, useState } from 'react'
import DateField from '../components/DateField'
import Select from '../components/Select'
import { useSearchParams } from 'react-router-dom'
import { Edit, FileArchive, Mail, Phone, RefreshCw, Search, Users } from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import { Pager } from '../components/PagerControls'
import useDebouncedValue from '../hooks/useDebouncedValue'
import { pageWindow } from '../lib/pagedQuery'
import { CONTACT_COLUMNS, contactSearchTokens, loadContactCounts, loadContactPage, saveContactDetails, moveContact, requireEffectiveDate, confirmedTransfer } from '../lib/contactManager'
import useContactDialog from './useContactDialog'
import './ContactManagerPage.css'
import Skeleton from '../components/skeleton/Skeleton'

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

const normalize = (value) => String(value ?? '').trim().toLowerCase()

export default function ContactManagerPage({ user: suppliedUser }) {
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState(null)
  const [countsLoading, setCountsLoading] = useState(true)
  const [listLoading, setListLoading] = useState(false)
  const [countError, setCountError] = useState('')
  const [listError, setListError] = useState('')
  const [identityError, setIdentityError] = useState('')
  const [linkError, setLinkError] = useState('')
  const submitting = useRef(false)
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

  const role = currentUser?.is_active === false ? '' : currentUser?.role?.trim().toLowerCase()
  const canManageContacts = role === 'admin' || role === 'secretary' || role === 'treasurer'
  const canTransferContacts = role === 'admin' || role === 'secretary'
  const contactDialogRef = useContactDialog(Boolean(selectedContact), saving, closeContactForm)
  const transferDialogRef = useContactDialog(Boolean(pendingTransferContact), Boolean(transferringContactId), closeTransferForm)


  // The homeowner list is never loaded up front. It is read from the database only for a
  // search of 2+ characters (or the small Moved / Transferred lists), one page at a time.
  const debouncedSearch = useDebouncedValue(search, 350)
  const tokens = contactSearchTokens(debouncedSearch)
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
      try {
        setLinkError('')
        if (canManageContacts && /^\d+$/.test(editId)) {
          const { data, error } = await supabase.from('properties').select(CONTACT_COLUMNS)
            .eq('id', editId).maybeSingle()
          if (error) throw error
          if (!data) throw new Error('This contact was not found. Refresh the directory.')
          if (!cancelled) openContactForm(data)
        }
      } catch (error) {
        if (!cancelled) setLinkError(`Could not open the contact: ${error.message || 'Please retry.'}`)
      } finally {
        if (!cancelled) { const next = new URLSearchParams(searchParams); next.delete('edit'); setSearchParams(next, { replace: true }) }
      }
    }

    openFromLink()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, role])

  useEffect(() => {
    let cancelled = false
    async function resolveCurrentUser() {
      try {
        setIdentityError('')
        if (suppliedUser) { setCurrentUser(suppliedUser); return }
        const { data, error } = await supabase.auth.getUser()
        if (error) throw error
        if (!data?.user) throw new Error('Sign in again to load your account.')
        const result = await supabase.from('profiles').select('id, full_name, email, role, is_active').eq('id', data.user.id).single()
        if (result.error) throw result.error
        if (!cancelled) setCurrentUser(result.data)
      } catch (error) {
        if (!cancelled) { setCurrentUser(null); setIdentityError(`Account details could not be loaded: ${error.message || 'Please retry.'}`) }
      }
    }
    resolveCurrentUser()
    return () => { cancelled = true }
  }, [suppliedUser, reloadTick])

  // Header counts: three tiny count queries, no homeowner rows are downloaded.
  useEffect(() => {
    let cancelled = false

    async function loadCounts() {
      setCountsLoading(true)
      setCountError('')
      try {
        const next = await loadContactCounts(supabase)
        if (!cancelled) setCounts(next)
      } catch (error) {
        if (!cancelled) { setCounts(null); setCountError(`Property-account counts could not be loaded: ${error.message || 'Please retry.'}`) }
      } finally {
        if (!cancelled) setCountsLoading(false)
      }
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
      setListError('')
      setRows([])
      try {
        const result = await loadContactPage(supabase, statusFilter, tokens, page)
        if (cancelled) return
        if (!result.rows.length && page > 0 && result.total > 0) { goToPage(page - 1); return }
        setRows(result.rows)
        setTotal(result.total)
      } catch (error) {
        if (!cancelled) { setRows([]); setTotal(0); setListError(`Contact directory could not be loaded: ${error.message || 'Please retry.'}`) }
      } finally {
        if (!cancelled) setListLoading(false)
      }
    }

    loadRows()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, page, reloadTick, shouldList])

  function openContactForm(contact) {
    if (!canManageContacts || submitting.current) return
    setPendingTransferContact(null)
    setSelectedContact(contact)
    setForm({
      phone: contact.contact_phone || '',
      email: contact.contact_email || '',
    })
    setFormError('')
    setNotice('')
  }

  function closeContactForm() {
    if (submitting.current) return
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
    if (submitting.current) return
    if (!selectedContact || !canManageContacts) { setFormError('Only an Admin, Secretary, or Treasurer can update contact details.'); return }
    submitting.current = true
    setSaving(true)
    setFormError('')
    try {
      const data = await saveContactDetails(supabase, selectedContact, form)
      setReloadTick((tick) => tick + 1)
      setSelectedContact(null)
      setForm(EMPTY_FORM)
      setNotice(`Contact details for ${data.homeowner_name} were saved across their linked lots.`)
    } catch (error) {
      setFormError(`${error.message || 'Could not save this contact.'} If the connection was interrupted, reload before retrying.`)
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  function requestTransferContact(contact) {
    if (!canTransferContacts || submitting.current) return
    setSelectedContact(null)
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
    if (submitting.current) return
    setPendingTransferContact(null)
    setTransferForm(EMPTY_TRANSFER_FORM)
    setTransferError('')
  }

  async function markMovedOrTransferred(event) {
    event.preventDefault()
    if (submitting.current) return
    const contact = pendingTransferContact
    if (!contact || !canTransferContacts) return
    submitting.current = true
    setTransferringContactId(contact.id)
    setTransferError('')
    try {
      if (!['moved', 'transferred'].includes(transferForm.status)) throw new Error('Choose whether the homeowner moved or transferred.')
      requireEffectiveDate(transferForm.effectiveDate)
      let message
      if (transferForm.status === 'transferred') {
        const request = transferRequest(contact, transferForm)
        const { data, error } = await supabase.rpc(request.name, request.args)
        if (error) throw error
        const result = confirmedTransfer(data)
        const targetName = transferForm.transferTo === 'existing' ? transferForm.targetProperty.homeowner_name : transferForm.newHomeownerName.trim()
        const transferred = transferAmountDescription(result.transferred_balance)
        const amountText = transferred.kind === 'debt'
          ? `Outstanding balance transferred to the new lot account: ${transferred.amount.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })}`
          : transferred.kind === 'credit'
            ? `Advance credit transferred to the new lot account: ${transferred.amount.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })}`
            : 'No balance or advance credit was transferred'
        message = `${contact.block}, Lot ${contact.lot_number} was transferred to ${targetName}. ${amountText}. Previous payment history remains with the former owner's archived account.`
      } else {
        await moveContact(supabase, contact, transferForm)
        message = `${contact.homeowner_name} was marked as Moved. Their profile and payment history were preserved.`
      }
      setReloadTick((tick) => tick + 1)
      setPendingTransferContact(null)
      setTransferForm(EMPTY_TRANSFER_FORM)
      setNotice(message)
    } catch (error) {
      setTransferError(`${error.message || 'Could not save the account status.'} If the connection was interrupted, reload before retrying.`)
    } finally {
      submitting.current = false
      setTransferringContactId(null)
    }
  }

  const { from: pageFrom } = pageWindow(page)
  const rangeStart = total === 0 ? 0 : pageFrom + 1
  const rangeEnd = pageFrom + rows.length
  const pageError = [identityError, linkError, countError, listError].filter(Boolean).join(' ')

  return (
    <div className="contact-page">
      <div className="contact-header">
        <div>
          <p className="contact-eyebrow">Homeowner contacts</p>
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

      <div className="contact-summary" aria-label="Contact summaries" aria-busy={countsLoading}>
        <div className="contact-summary-item is-active">
          <div className="contact-summary-top"><span>Total Contacts</span><span className="contact-summary-icon"><Users size={18} /></span></div>
          <strong>{countsLoading || !counts ? '—' : (counts.active + counts.moved + counts.transferred).toLocaleString('en-PH')}</strong>
          <small>All property accounts</small>
        </div>
        <div className="contact-summary-item is-moved">
          <div className="contact-summary-top"><span>Active</span><span className="contact-summary-icon contact-summary-icon-green"><Users size={18} /></span></div>
          <strong>{countsLoading || !counts ? '—' : counts.active.toLocaleString('en-PH')}</strong>
          <small>Active property accounts</small>
        </div>
        <div className="contact-summary-item is-transferred">
          <div className="contact-summary-top"><span>Inactive</span><span className="contact-summary-icon contact-summary-icon-warning"><Users size={18} /></span></div>
          <strong>{countsLoading || !counts ? '—' : (counts.moved + counts.transferred).toLocaleString('en-PH')}</strong>
          <small>Moved and transferred accounts</small>
        </div>
        <div className="contact-summary-item is-categories">
          <div className="contact-summary-top"><span>Categories</span><span className="contact-summary-icon contact-summary-icon-muted"><FileArchive size={18} /></span></div>
          <strong>{countsLoading || !counts ? '—' : Object.keys(counts).length.toLocaleString('en-PH')}</strong>
          <small>Active, moved, transferred</small>
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
        <Select ariaLabel="Filter homeowners by residency status" value={statusFilter} onChange={setStatusFilter} options={[['active', 'Active'], ['moved', 'Moved'], ['transferred', 'Transferred'], ['all', 'All statuses']].map(([value, label]) => ({ value, label }))} />
        {shouldList && !listError && !listLoading && (
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
      ) : listLoading ? (
        <div className="contact-empty glass-card" aria-busy="true"><Skeleton variant="rect" width="100%" height="72px" /><Skeleton variant="rect" width="100%" height="72px" /><Skeleton variant="rect" width="100%" height="72px" /><span className="skeleton-region-status" role="status">Loading</span></div>
      ) : listError ? (
        <div className="contact-empty glass-card">Contacts could not be loaded. Use Refresh to try again.</div>
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
                        {canTransferContacts && (
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
                        )}
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

      {shouldList && !listError && !listLoading && total > 0 && (
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
            ref={transferDialogRef}
            tabIndex={-1}
            aria-busy={Boolean(transferringContactId)}
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
                disabled={Boolean(transferringContactId)}
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
                <Select ariaLabel="Action" value={transferForm.status === 'moved' ? 'moved' : transferForm.transferTo} onChange={(value) => setTransferForm((current) => ({ ...current, status: value === 'moved' ? 'moved' : 'transferred', transferTo: value === 'existing' ? 'existing' : 'new', targetProperty: null }))} options={[['moved', 'Mark as moved'], ['existing', 'Transfer to an Existing homeowner'], ['new', 'Transfer to a New homeowner']].map(([value, label]) => ({ value, label }))} />
              </div>
              <div>
                <label htmlFor="homeowner-status-date">Effective date</label>
                <DateField ariaLabel="Effective date" name="effective_date" value={transferForm.effectiveDate} max={manilaDate()} onChange={(value) => setTransferForm((current) => ({ ...current, effectiveDate: value }))} required />
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

            {transferForm.status === 'transferred' && (() => {
              const preview = transferAmountDescription(pendingTransferContact.current_balance)
              return (
                <div className="contact-transfer-balance-preview" aria-label="Balance and credit transfer preview">
                  <strong>Balance or credit to carry over</strong>
                  <span>{preview.label}: {preview.amount == null ? 'Unavailable' : preview.amount.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })}</span>
                  <small>Preview from the last loaded account record. The server transfers the latest signed balance when you confirm. This is not a separate payment.</small>
                </div>
              )
            })()}
            <p className="contact-transfer-note">
              {transferForm.status === 'transferred' ? 'Only this lot’s current signed account balance moves to the new lot account: an amount owed stays an amount owed, and an advance credit stays a credit. Payment receipts and prior history remain with the former owner. The actual amount is determined at confirmation.' : 'This frees the lot while keeping the homeowner’s records.'}
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
            ref={contactDialogRef}
            tabIndex={-1}
            aria-busy={saving}
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
                disabled={saving}
                aria-label="Close contact form"
              >
                ×
              </button>
            </div>

            <fieldset className="contact-edit-fields" disabled={saving}>
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
              These contact details are shared across every lot linked to this homeowner. Leave a field blank if that contact method is unavailable.
            </p>

            </fieldset>
            {formError && <p className="contact-form-error" role="alert">{formError}</p>}

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