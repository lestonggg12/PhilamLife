import TransferHomeownerPicker from '../components/TransferHomeownerPicker'
import { transferRequest, transferAmountDescription } from '../lib/homeownerTransfer'
import { useSuccessNotice } from '../lib/useSuccessNotice'
import React, { useEffect, useRef, useState } from 'react'
import DateField from '../components/DateField'
import Select from '../components/Select'
import { Link, useSearchParams } from 'react-router-dom'
import { Edit, FileArchive, Mail, Phone, RefreshCw, Search, Users } from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import { Pager } from '../components/PagerControls'
import useDebouncedValue from '../hooks/useDebouncedValue'
import { pageCount, pageWindow } from '../lib/pagedQuery'
import { calendarToday } from '../lib/eventCalendar'
import {
  CONTACT_COLUMNS,
  contactSearchFilters,
  loadContactCounts,
  loadContactPage,
  saveContactDetails,
  moveContact,
  requireEffectiveDate,
  confirmedTransfer,
} from '../lib/contactManager'
import useContactDialog from './useContactDialog'
import './ContactManagerPage.css'
import Skeleton from '../components/skeleton/Skeleton'

const EMPTY_FORM = {
  phone: '',
  email: '',
}

const EMPTY_TRANSFER_FORM = {
  status: 'moved',
  effectiveDate: '',
  reason: '',
  newHomeownerName: '',
  transferTo: 'new',
  targetProperty: null,
}

// Accounts still lacking a phone number or an email address.
const MISSING_DETAILS_FILTER = 'contact_phone.is.null,contact_email.is.null'

const normalize = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()

function ContactRows({
  rows,
  viewMode,
  canManageContacts,
  canTransferContacts,
  transferringContactId,
  onEdit,
  onTransfer,
  initialsOf,
}) {
  const describe = (contact) => {
    const status = normalize(contact.homeowner_status || 'active')
    return {
      status,
      isActive: status === 'active',
      label: status === 'transferred' ? 'Transferred' : status === 'moved' ? 'Moved' : 'Active',
      hasDetails: Boolean(contact.contact_phone || contact.contact_email),
    }
  }

  const actions = (contact, { isActive, hasDetails, label }) =>
    isActive ? (
      canManageContacts && (
        <div className="contact-row-actions" onClick={(event) => event.stopPropagation()}>
          <button type="button" className="contact-row-btn is-primary" onClick={() => onEdit(contact)}>
            <Edit size={15} />
            {hasDetails ? 'Edit' : '+ Add details'}
          </button>
          {canTransferContacts && (
            <button
              type="button"
              className="contact-row-btn"
              onClick={() => onTransfer(contact)}
              disabled={transferringContactId === contact.id}
              aria-label={`Mark ${contact.homeowner_name} as moved or transferred`}
              title="Mark as moved or transferred"
            >
              <FileArchive size={15} />
              Move / Transfer
            </button>
          )}
        </div>
      )
    ) : (
      <span className="contact-history-note">
        {label}
        {contact.status_effective_date ? ` since ${contact.status_effective_date}` : ''}
        {contact.status_reason && <small>{contact.status_reason}</small>}
      </span>
    )

  const phone = (contact) =>
    contact.contact_phone ? (
      <a href={`tel:${contact.contact_phone}`} onClick={(event) => event.stopPropagation()}>
        {contact.contact_phone}
      </a>
    ) : (
      <span className="contact-missing">Not provided</span>
    )
  const email = (contact) =>
    contact.contact_email ? (
      <a href={`mailto:${contact.contact_email}`} onClick={(event) => event.stopPropagation()}>
        {contact.contact_email}
      </a>
    ) : (
      <span className="contact-missing">Not provided</span>
    )

  const openRow = (contact, info) => {
    if (info.isActive && canManageContacts) onEdit(contact)
  }

  if (viewMode === 'grid') {
    return (
      <div className="contact-grid">
        {rows.map((contact) => {
          const info = describe(contact)
          return (
            <article
              key={contact.id}
              className={`contact-tile is-${info.status}`}
              onClick={() => openRow(contact, info)}
            >
              <div className="contact-tile-top">
                <span className="contact-avatar" aria-hidden="true">
                  {initialsOf(contact.homeowner_name)}
                </span>
                <div className="contact-tile-who">
                  <h2 className="contact-name">{contact.homeowner_name || 'Unnamed homeowner'}</h2>
                  <span className="contact-loc">
                    {contact.block}, Lot {contact.lot_number}
                  </span>
                </div>
                <span className={`contact-status-badge is-${info.status}`}>{info.label}</span>
              </div>
              <ul className="contact-tile-details">
                <li>
                  <Phone size={15} />{' '}
                  {contact.contact_phone ? phone(contact) : <span className="contact-missing">Phone not provided</span>}
                </li>
                <li>
                  <Mail size={15} />{' '}
                  {contact.contact_email ? email(contact) : <span className="contact-missing">Email not provided</span>}
                </li>
              </ul>
              {actions(contact, info)}
            </article>
          )
        })}
      </div>
    )
  }

  return (
    <div className="contact-table-wrap">
      <table className="contact-table">
        <thead>
          <tr>
            <th>Homeowner</th>
            <th>Block / Lot</th>
            <th>Phone</th>
            <th>Email</th>
            <th>Status</th>
            <th className="is-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((contact) => {
            const info = describe(contact)
            const clickable = info.isActive && canManageContacts
            return (
              <tr
                key={contact.id}
                className={clickable ? 'is-clickable' : ''}
                tabIndex={clickable ? 0 : undefined}
                aria-label={clickable ? `Edit ${contact.homeowner_name}` : undefined}
                onClick={() => openRow(contact, info)}
                onKeyDown={(event) => {
                  if (
                    clickable &&
                    event.target === event.currentTarget &&
                    (event.key === 'Enter' || event.key === ' ')
                  ) {
                    event.preventDefault()
                    onEdit(contact)
                  }
                }}
              >
                <td>
                  <div className="contact-who">
                    <span className="contact-avatar" aria-hidden="true">
                      {initialsOf(contact.homeowner_name)}
                    </span>
                    <b>{contact.homeowner_name || 'Unnamed homeowner'}</b>
                  </div>
                </td>
                <td>
                  {contact.block}, Lot {contact.lot_number}
                </td>
                <td>{phone(contact)}</td>
                <td>{email(contact)}</td>
                <td>
                  <span className={`contact-status-badge is-${info.status}`}>{info.label}</span>
                </td>
                <td className="is-right">{actions(contact, info)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function ContactManagerPage({ user: suppliedUser }) {
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [directory, setDirectory] = useState(null)
  const [counts, setCounts] = useState(null)
  const [countsLoading, setCountsLoading] = useState(true)
  const [countError, setCountError] = useState('')
  const [identityError, setIdentityError] = useState('')
  const [linkError, setLinkError] = useState('')
  const submitting = useRef(false)
  const [reloadTick, setReloadTick] = useState(0)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [missingOnly, setMissingOnly] = useState(false)
  const [viewMode, setViewMode] = useState(() => {
    try {
      return localStorage.getItem('contact-view') === 'grid' ? 'grid' : 'list'
    } catch {
      return 'list'
    }
  })
  const [pageState, setPageState] = useState({ key: '', page: 0 })
  const [, setNotice] = useSuccessNotice()
  const [selectedContact, setSelectedContact] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [pendingTransferContact, setPendingTransferContact] = useState(null)
  const [transferForm, setTransferForm] = useState(EMPTY_TRANSFER_FORM)
  const [transferringContactId, setTransferringContactId] = useState(null)
  const [transferError, setTransferError] = useState('')

  const role = currentUser?.is_active === true ? currentUser.role?.trim().toLowerCase() : ''
  const canManageContacts = role === 'admin' || role === 'secretary' || role === 'treasurer'
  const canTransferContacts = role === 'admin' || role === 'secretary'
  const contactDialogRef = useContactDialog(Boolean(selectedContact), saving, closeContactForm)
  const transferDialogRef = useContactDialog(
    Boolean(pendingTransferContact),
    Boolean(transferringContactId),
    closeTransferForm,
  )

  // The homeowner list is never loaded up front. It is read from the database only for a
  // search (or the small Moved / Transferred lists), one page at a time.
  const debouncedSearch = useDebouncedValue(search.trim(), 350)
  const filters = contactSearchFilters(debouncedSearch)
  const hasSearch = filters.length > 0 && (debouncedSearch.length >= 2 || /^\d$/.test(debouncedSearch))
  const searchPending = search.trim() !== debouncedSearch
  const listsByStatus = statusFilter === 'moved' || statusFilter === 'transferred'
  const shouldList = hasSearch || listsByStatus || missingOnly
  const scopeKey = `${statusFilter}|${hasSearch ? debouncedSearch : ''}|${missingOnly ? 'missing' : ''}`
  const page = pageState.key === scopeKey ? pageState.page : 0
  const resultKey = JSON.stringify([scopeKey, page, reloadTick])
  const result = !searchPending && directory?.key === resultKey ? directory : null
  const rows = result?.rows ?? []
  const total = result?.total ?? 0
  const listError = result?.error ?? ''
  const listLoading = searchPending || (shouldList && !result)

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
        if (canManageContacts) {
          if (!/^\d+$/.test(editId)) throw new Error('The link does not contain a valid lot account.')
          const { data, error } = await supabase
            .from('properties')
            .select(CONTACT_COLUMNS)
            .eq('id', editId)
            .maybeSingle()
          if (error) throw error
          if (!data) throw new Error('This contact was not found. Refresh the directory.')
          if (!cancelled) openContactForm(data)
        }
      } catch (error) {
        if (!cancelled) setLinkError(`Could not open the contact: ${error.message || 'Please retry.'}`)
      } finally {
        if (!cancelled) {
          const next = new URLSearchParams(searchParams)
          next.delete('edit')
          setSearchParams(next, { replace: true })
        }
      }
    }

    openFromLink()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, role])

  useEffect(() => {
    let cancelled = false
    async function resolveCurrentUser() {
      try {
        setIdentityError('')
        if (suppliedUser) {
          setCurrentUser(suppliedUser)
          return
        }
        const { data, error } = await supabase.auth.getUser()
        if (error) throw error
        if (!data?.user) throw new Error('Sign in again to load your account.')
        const result = await supabase
          .from('profiles')
          .select('id, full_name, email, role, is_active')
          .eq('id', data.user.id)
          .single()
        if (result.error) throw result.error
        if (!cancelled) setCurrentUser(result.data)
      } catch (error) {
        if (!cancelled) {
          setCurrentUser(null)
          setIdentityError(`Account details could not be loaded: ${error.message || 'Please retry.'}`)
        }
      }
    }
    resolveCurrentUser()
    return () => {
      cancelled = true
    }
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
        if (!cancelled) {
          setCounts(null)
          setCountError(`Property-account counts could not be loaded: ${error.message || 'Please retry.'}`)
        }
      } finally {
        if (!cancelled) setCountsLoading(false)
      }
    }

    loadCounts()
    return () => {
      cancelled = true
    }
  }, [reloadTick])

  // One page of results, read straight from the database.
  useEffect(() => {
    if (!shouldList || searchPending) return undefined

    let cancelled = false
    async function loadRows() {
      try {
        const result = await loadContactPage(
          supabase,
          statusFilter,
          [...(hasSearch ? filters : []), ...(missingOnly ? [MISSING_DETAILS_FILTER] : [])],
          page,
        )
        if (cancelled) return
        if (result.pageOutOfRange) {
          goToPage(0)
          return
        }
        const lastPage = pageCount(result.total) - 1
        if (page > lastPage) {
          goToPage(lastPage)
          return
        }
        setDirectory({ key: resultKey, ...result })
      } catch (error) {
        if (!cancelled)
          setDirectory({
            key: resultKey,
            error: `Contact directory could not be loaded: ${error.message || 'Please retry.'}`,
          })
      }
    }

    loadRows()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultKey, shouldList, searchPending])

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
    if (!selectedContact || !canManageContacts) {
      setFormError('Only an Admin, Secretary, or Treasurer can update contact details.')
      return
    }
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
      setFormError(
        `${error.message || 'Could not save this contact.'} If the connection was interrupted, reload before retrying.`,
      )
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
      effectiveDate: calendarToday(),
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
      if (!['moved', 'transferred'].includes(transferForm.status))
        throw new Error('Choose whether the homeowner moved or transferred.')
      requireEffectiveDate(transferForm.effectiveDate)
      let message
      if (transferForm.status === 'transferred') {
        const request = transferRequest(contact, transferForm)
        const { data, error } = await supabase.rpc(request.name, request.args)
        if (error) throw error
        const result = confirmedTransfer(data)
        const targetName =
          transferForm.transferTo === 'existing'
            ? transferForm.targetProperty.homeowner_name
            : transferForm.newHomeownerName.trim()
        const transferred = transferAmountDescription(result.transferred_balance)
        const amountText =
          transferred.kind === 'debt'
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
      setTransferError(
        `${error.message || 'Could not save the account status.'} If the connection was interrupted, reload before retrying.`,
      )
    } finally {
      submitting.current = false
      setTransferringContactId(null)
    }
  }

  const { from: pageFrom } = pageWindow(page)
  const rangeStart = total === 0 ? 0 : pageFrom + 1
  const rangeEnd = total === 0 ? 0 : pageFrom + rows.length
  const filtersActive = Boolean(search.trim()) || missingOnly
  const statusLabelFor = (key) => ({ active: 'Active', moved: 'Moved', transferred: 'Transferred', all: 'All' })[key]
  const statusCount = (key) => {
    if (countsLoading || !counts) return '—'
    const value = key === 'all' ? counts.active + counts.moved + counts.transferred : counts[key]
    return value.toLocaleString('en-PH')
  }
  function clearFilters() {
    setSearch('')
    setMissingOnly(false)
  }
  function chooseView(mode) {
    setViewMode(mode)
    try {
      localStorage.setItem('contact-view', mode)
    } catch {
      /* ignore */
    }
  }
  const initialsOf = (name) =>
    String(name || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0].toUpperCase())
      .join('') || '?'
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
        <button
          type="button"
          className="contact-summary-item is-active"
          aria-pressed={statusFilter === 'all'}
          onClick={() => setStatusFilter('all')}
        >
          <div className="contact-summary-top">
            <span>Total Lot Accounts</span>
            <span className="contact-summary-icon">
              <Users size={18} />
            </span>
          </div>
          <strong>{statusCount('all')}</strong>
          <small>All property accounts</small>
        </button>
        <button
          type="button"
          className="contact-summary-item is-moved"
          aria-pressed={statusFilter === 'active'}
          onClick={() => setStatusFilter('active')}
        >
          <div className="contact-summary-top">
            <span>Active</span>
            <span className="contact-summary-icon contact-summary-icon-green">
              <Users size={18} />
            </span>
          </div>
          <strong>{statusCount('active')}</strong>
          <small>Active property accounts</small>
        </button>
        <button
          type="button"
          className="contact-summary-item is-transferred"
          aria-pressed={statusFilter === 'moved'}
          onClick={() => setStatusFilter('moved')}
        >
          <div className="contact-summary-top">
            <span>Moved</span>
            <span className="contact-summary-icon contact-summary-icon-warning">
              <Users size={18} />
            </span>
          </div>
          <strong>{statusCount('moved')}</strong>
          <small>Lot accounts marked as moved</small>
        </button>
        <button
          type="button"
          className="contact-summary-item is-categories"
          aria-pressed={statusFilter === 'transferred'}
          onClick={() => setStatusFilter('transferred')}
        >
          <div className="contact-summary-top">
            <span>Transferred</span>
            <span className="contact-summary-icon contact-summary-icon-muted">
              <FileArchive size={18} />
            </span>
          </div>
          <strong>{statusCount('transferred')}</strong>
          <small>Former accounts after a transfer</small>
        </button>
      </div>

      <section className="contact-directory" aria-label="Contacts">
        <div className="contact-filters">
          <div className="contact-filter-row">
            <div className="contact-search-wrap">
              <Search size={18} aria-hidden="true" />
              <input
                type="search"
                placeholder="Search by name, block, lot, phone, or email"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="contact-search"
                aria-label="Search homeowner contacts"
                autoComplete="off"
              />
              {search && (
                <button
                  type="button"
                  className="contact-search-clear"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </div>
            <div className="contact-seg contact-view-toggle" role="group" aria-label="Layout">
              <button type="button" aria-pressed={viewMode === 'list'} onClick={() => chooseView('list')}>
                ☰ List
              </button>
              <button type="button" aria-pressed={viewMode === 'grid'} onClick={() => chooseView('grid')}>
                ▦ Cards
              </button>
            </div>
          </div>
          <div className="contact-filter-row">
            <div className="contact-seg" role="group" aria-label="Residency status">
              {['active', 'moved', 'transferred', 'all'].map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={statusFilter === key}
                  onClick={() => setStatusFilter(key)}
                >
                  {statusLabelFor(key)}
                  <span className="contact-seg-count">{statusCount(key)}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="contact-missing-toggle"
              aria-pressed={missingOnly}
              onClick={() => setMissingOnly((value) => !value)}
            >
              ⚠ Missing details only
            </button>
          </div>
          <div className="contact-filter-meta">
            <span className="contact-result-count">
              {shouldList && !listError && !listLoading
                ? `Showing ${rangeStart}-${rangeEnd} of ${total}`
                : 'Search to list homeowners, or pick Moved / Transferred'}
            </span>
            <span className="contact-chips">
              {missingOnly && (
                <span className="contact-chip">
                  Missing details
                  <button
                    type="button"
                    onClick={() => setMissingOnly(false)}
                    aria-label="Remove missing details filter"
                  >
                    ×
                  </button>
                </span>
              )}
              {filtersActive && (
                <button type="button" className="contact-linkbtn" onClick={clearFilters}>
                  Clear all filters
                </button>
              )}
            </span>
          </div>
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

        {!shouldList && !listLoading ? (
          <div className="contact-empty">
            <span style={{ display: 'inline-flex', opacity: 0.6 }}>
              <Search size={30} aria-hidden="true" />
            </span>
            <h3>Search for a homeowner</h3>
            <p>
              Search by name, phone, email, or address (for example, Block 3 Lot 4). Choose Moved or Transferred to
              browse those records without a search.
            </p>
          </div>
        ) : listLoading ? (
          <div className="contact-empty" aria-busy="true">
            <Skeleton variant="rect" width="100%" height="56px" />
            <Skeleton variant="rect" width="100%" height="56px" />
            <Skeleton variant="rect" width="100%" height="56px" />
            <span className="skeleton-region-status" role="status">
              Loading
            </span>
          </div>
        ) : listError ? (
          <div className="contact-empty">Contacts could not be loaded. Use Refresh to try again.</div>
        ) : rows.length === 0 ? (
          <div className="contact-empty">
            {hasSearch || missingOnly ? 'No contacts match your search.' : `No ${statusFilter} homeowners.`}
          </div>
        ) : (
          <ContactRows
            rows={rows}
            viewMode={viewMode}
            canManageContacts={canManageContacts}
            canTransferContacts={canTransferContacts}
            transferringContactId={transferringContactId}
            onEdit={openContactForm}
            onTransfer={requestTransferContact}
            initialsOf={initialsOf}
          />
        )}

        {shouldList && !listError && !listLoading && total > 0 && (
          <div className="contact-pager">
            <Pager page={page} total={total} onPageChange={goToPage} disabled={listLoading} />
          </div>
        )}
      </section>

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
                <p>Choose an action for this lot. Its previous records are kept.</p>
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
                  <Select
                    ariaLabel="Action"
                    value={transferForm.status === 'moved' ? 'moved' : transferForm.transferTo}
                    onChange={(value) =>
                      setTransferForm((current) => ({
                        ...current,
                        status: value === 'moved' ? 'moved' : 'transferred',
                        transferTo: value === 'existing' ? 'existing' : 'new',
                        targetProperty: null,
                      }))
                    }
                    options={[
                      ['moved', 'Mark as moved'],
                      ['existing', 'Transfer to an Existing homeowner'],
                      ['new', 'Transfer to a New homeowner'],
                    ].map(([value, label]) => ({ value, label }))}
                  />
                </div>
                <div>
                  <label htmlFor="homeowner-status-date">Effective date</label>
                  <DateField
                    ariaLabel="Effective date"
                    name="effective_date"
                    value={transferForm.effectiveDate}
                    max={calendarToday()}
                    onChange={(value) => setTransferForm((current) => ({ ...current, effectiveDate: value }))}
                    required
                  />
                </div>
              </div>

              {transferForm.status === 'transferred' && transferForm.transferTo === 'new' && (
                <>
                  <label htmlFor="homeowner-new-owner-name">New homeowner name</label>
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
                <TransferHomeownerPicker
                  previousProperty={pendingTransferContact}
                  selected={transferForm.targetProperty}
                  disabled={Boolean(transferringContactId)}
                  onSelect={(person) => setTransferForm((current) => ({ ...current, targetProperty: person }))}
                />
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

              {transferForm.status === 'transferred' &&
                (() => {
                  const balance = pendingTransferContact.current_balance
                  const preview =
                    balance == null || balance === ''
                      ? { label: 'Account amount unavailable' }
                      : transferAmountDescription(balance)
                  return (
                    <div className="contact-transfer-balance-preview" aria-label="Balance and credit transfer preview">
                      <strong>Balance or credit to carry over</strong>
                      <span>
                        {preview.label}:{' '}
                        {preview.amount == null
                          ? 'Unavailable'
                          : preview.amount.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })}
                      </span>
                      <small>
                        Preview from the last loaded account record. The server transfers the latest signed balance when
                        you confirm. This is not a separate payment.
                      </small>
                    </div>
                  )
                })()}
              <p className="contact-transfer-note">
                {transferForm.status === 'transferred'
                  ? 'Only this lot’s current signed account balance moves to the new lot account: an amount owed stays an amount owed, and an advance credit stays a credit. Payment receipts and prior history remain with the former owner. The actual amount is determined at confirmation.'
                  : 'This marks the selected lot account as moved. Any outstanding balance or advance credit and payment history stay on that account.'}
              </p>
            </fieldset>
            {transferError && (
              <p className="contact-form-error" role="alert">
                {transferError}
              </p>
            )}

            <div className="contact-modal-actions">
              <button
                type="button"
                className="contact-cancel-button"
                onClick={closeTransferForm}
                disabled={Boolean(transferringContactId)}
              >
                Cancel
              </button>
              <button type="submit" className="contact-save-button" disabled={Boolean(transferringContactId)}>
                {transferringContactId
                  ? 'Saving...'
                  : transferForm.status === 'transferred'
                    ? 'Confirm transfer'
                    : 'Confirm move'}
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
                  {selectedContact.homeowner_name} — {selectedContact.block}, Lot {selectedContact.lot_number}
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
                These contact details are shared across every lot linked to this homeowner. Leave a field blank if that
                contact method is unavailable.
              </p>
            </fieldset>
            {formError && (
              <p className="contact-form-error" role="alert">
                {formError}
              </p>
            )}

            <div className="contact-modal-actions">
              <button type="button" className="contact-cancel-button" onClick={closeContactForm} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="contact-save-button" disabled={saving}>
                {saving ? 'Saving...' : 'Save Contact'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}