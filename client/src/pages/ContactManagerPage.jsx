import React, { useEffect, useMemo, useState } from 'react'
import { Edit, FileArchive, Mail, Phone, RefreshCw, UserPlus, Trash2, Settings } from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import ActionDialog from '../components/ActionDialog'
import './ContactManagerPage.css'

const EMPTY_FORM = {
  phone: '',
  email: '',
}

const EMPTY_BLOCK_FORM = {
  name: '',
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
}

const ADD_BLOCK_OPTION = '__add_block__'

const PAGE_SIZE = 24

const normalize = (value) => String(value ?? '').trim().toLowerCase()

export default function ContactManagerPage({ user: suppliedUser }) {
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [contacts, setContacts] = useState([])
  const [blocks, setBlocks] = useState([])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [pageError, setPageError] = useState('')
  const [notice, setNotice] = useState('')
  const [showAddHomeowner, setShowAddHomeowner] = useState(false)
  const [homeownerForm, setHomeownerForm] = useState({
    homeownerName: '',
    blockName: '',
    lotNumber: '',
  })
  const [homeownerFormError, setHomeownerFormError] = useState('')
  const [savingHomeowner, setSavingHomeowner] = useState(false)
  const [showAddBlock, setShowAddBlock] = useState(false)
  const [blockForm, setBlockForm] = useState(EMPTY_BLOCK_FORM)
  const [blockFormError, setBlockFormError] = useState('')
  const [savingBlock, setSavingBlock] = useState(false)
  const [selectedContact, setSelectedContact] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [statusFilter, setStatusFilter] = useState('active')
  const [pendingTransferContact, setPendingTransferContact] = useState(null)
  const [transferForm, setTransferForm] = useState(EMPTY_TRANSFER_FORM)
  const [transferringContactId, setTransferringContactId] = useState(null)
  const [transferError, setTransferError] = useState('')
  const [showManageBlocks, setShowManageBlocks] = useState(false)
  const [pendingDeleteBlock, setPendingDeleteBlock] = useState(null)
  const [deletingBlockId, setDeletingBlockId] = useState(null)
  const [deleteBlockError, setDeleteBlockError] = useState('')

  const role = currentUser?.role?.trim().toLowerCase()
  const canManageContacts = role === 'admin' || role === 'secretary'
  const actorName =
    currentUser?.full_name ||
    currentUser?.name ||
    currentUser?.email ||
    'Staff member'

  useEffect(() => {
    loadContacts()
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

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, email, role')
      .eq('id', authUser.id)
      .single()

    if (!profileError) setCurrentUser(profile)
  }

  async function loadContacts(isRefresh = false) {
    if (isRefresh) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }

    setPageError('')
    setNotice('')

    const [contactsResult, blocksResult] = await Promise.all([
      supabase
        .from('properties')
        .select(
          'id, block, lot_number, homeowner_name, contact_phone, contact_email, contact_updated_at, homeowner_status, status_effective_date, status_reason, status_updated_at',
        )
        .order('homeowner_name'),
      supabase.from('blocks').select('id, name').order('name'),
    ])

    if (contactsResult.error) {
      setContacts([])
      setPageError(`Contact directory could not be loaded: ${contactsResult.error.message}`)
    } else {
      setContacts(contactsResult.data || [])
    }

    if (blocksResult.error) {
      setBlocks([])
      setPageError((current) =>
        current
          ? `${current} Block list could not be loaded: ${blocksResult.error.message}`
          : `Block list could not be loaded: ${blocksResult.error.message}`,
      )
    } else {
      setBlocks(blocksResult.data || [])
    }

    setLoading(false)
    setRefreshing(false)
  }

  function openHomeownerForm() {
    setHomeownerForm({
      homeownerName: '',
      blockName: '',
      lotNumber: '',
    })
    setHomeownerFormError('')
    setNotice('')
    setShowAddHomeowner(true)
  }

  function closeHomeownerForm() {
    if (savingHomeowner) return
    setShowAddHomeowner(false)
    setHomeownerFormError('')
  }

  function openBlockForm() {
    setBlockForm(EMPTY_BLOCK_FORM)
    setBlockFormError('')
    setShowAddBlock(true)
  }

  function closeBlockForm() {
    if (savingBlock) return
    setShowAddBlock(false)
    setBlockFormError('')
  }

  function updateHomeownerField(event) {
    const { name, value } = event.target

    if (name === 'blockName' && value === ADD_BLOCK_OPTION) {
      setHomeownerForm((current) => ({ ...current, blockName: '' }))
      setHomeownerFormError('')
      openBlockForm()
      return
    }

    setHomeownerForm((current) => ({ ...current, [name]: value }))
    setHomeownerFormError('')
  }

  function updateBlockField(event) {
    const { value } = event.target
    setBlockForm({ name: value })
    setBlockFormError('')
  }

  async function saveBlock(event) {
    event.preventDefault()

    if (!canManageContacts) {
      setBlockFormError('Only an Admin or Secretary can add blocks.')
      return
    }

    const name = blockForm.name.trim().replace(/\s+/g, ' ')

    if (!name) {
      setBlockFormError('Enter a block name.')
      return
    }

    if (blocks.some((block) => normalize(block.name) === normalize(name))) {
      setBlockFormError('That block already exists.')
      return
    }

    setSavingBlock(true)
    setBlockFormError('')

    const { data, error } = await supabase
      .from('blocks')
      .insert({ name })
      .select('id, name')
      .single()

    if (error) {
      setBlockFormError(error.code === '23505' ? 'That block already exists.' : error.message)
      setSavingBlock(false)
      return
    }

    setBlocks((current) => [...current, data].sort((a, b) => a.name.localeCompare(b.name)))
    setSavingBlock(false)
    setShowAddBlock(false)
    setBlockForm(EMPTY_BLOCK_FORM)
    setHomeownerForm((current) => ({ ...current, blockName: data.name }))

    if (currentUser?.id) {
      const { error: activityError } = await supabase.from('activity_log').insert({
        user_id: currentUser.id,
        action: 'Block Added',
        target: `${data.name} (by ${actorName})`,
      })

      if (activityError) {
        console.warn('Block saved, but activity logging failed:', activityError.message)
      }
    }

    setNotice(`Block ${name} was added.`)
  }

  async function saveHomeowner(event) {
    event.preventDefault()

    if (!canManageContacts) {
      setHomeownerFormError('Only an Admin or Secretary can add homeowners.')
      return
    }

    const homeownerName = homeownerForm.homeownerName.trim().replace(/\s+/g, ' ')
    const blockName = homeownerForm.blockName
    const lotNumber = Number(homeownerForm.lotNumber)

    if (!homeownerName || !blockName || !homeownerForm.lotNumber) {
      setHomeownerFormError('Homeowner name, block, and lot number are required.')
      return
    }

    if (!Number.isInteger(lotNumber) || lotNumber <= 0) {
      setHomeownerFormError('Lot number must be a whole number greater than zero.')
      return
    }

    // Only currently-active occupants block a lot from being reused. Once a
    // homeowner has been marked Moved/Transferred, the lot is vacant again
    // and should be assignable to a new homeowner.
    const lotIsOccupied = contacts.some(
      (contact) =>
        normalize(contact.block) === normalize(blockName) &&
        Number(contact.lot_number) === lotNumber &&
        normalize(contact.homeowner_status || 'active') === 'active',
    )

    if (lotIsOccupied) {
      setHomeownerFormError('That block and lot already has an active homeowner.')
      return
    }

    setSavingHomeowner(true)
    setHomeownerFormError('')

    const { data, error } = await supabase
      .from('properties')
      .insert({
        homeowner_name: homeownerName,
        block: blockName,
        lot_number: lotNumber,
      })
      .select(
        'id, block, lot_number, homeowner_name, contact_phone, contact_email, contact_updated_at, homeowner_status, status_effective_date, status_reason, status_updated_at',
      )
      .single()

    if (error) {
      setHomeownerFormError(
        error.code === '23505'
          ? 'That block and lot already has a homeowner record. Check Manage Blocks or search all statuses.'
          : error.message,
      )
      setSavingHomeowner(false)
      return
    }

    setContacts((current) =>
      [...current, data].sort((a, b) =>
        (a.homeowner_name || '').localeCompare(b.homeowner_name || ''),
      ),
    )
    setShowAddHomeowner(false)
    setHomeownerForm({ homeownerName: '', blockName: '', lotNumber: '' })
    setSavingHomeowner(false)

    if (currentUser?.id) {
      const { error: activityError } = await supabase.from('activity_log').insert({
        user_id: currentUser.id,
        action: 'Homeowner Added',
        target: `${homeownerName} — ${blockName}, Lot ${lotNumber} (by ${actorName})`,
      })

      if (activityError) {
        console.warn('Homeowner saved, but activity logging failed:', activityError.message)
      }
    }

    setNotice(`Homeowner ${homeownerName} was added.`)
  }

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
      .select(
        'id, block, lot_number, homeowner_name, contact_phone, contact_email, contact_updated_at, homeowner_status, status_effective_date, status_reason, status_updated_at',
      )
      .single()

    if (error) {
      setFormError(error.message)
      setSaving(false)
      return
    }

    setContacts((current) =>
      current
        .map((contact) => (contact.id === data.id ? data : contact))
        .sort((a, b) =>
          (a.homeowner_name || '').localeCompare(b.homeowner_name || ''),
        ),
    )

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
      status: 'moved',
      effectiveDate: manilaDate(),
      reason: '',
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

    setTransferringContactId(contact.id)
    setTransferError('')

    const statusUpdatedAt = new Date().toISOString()
    const { data, error } = await supabase
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

    setContacts((current) =>
      current.map((item) => (item.id === data.id ? data : item)),
    )

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

  function requestDeleteBlock(block) {
    if (!canManageContacts) return
    setDeleteBlockError('')

    const homeownersInBlock = contacts.filter(
      (contact) => normalize(contact.block) === normalize(block.name),
    ).length

    if (homeownersInBlock > 0) {
      setDeleteBlockError(
        `${block.name} cannot be deleted — ${homeownersInBlock} homeowner record(s) (active or historical) are still assigned to it. Delete or reassign them first.`,
      )
      return
    }

    setPendingDeleteBlock(block)
  }

  async function deleteBlock(block) {
    setPendingDeleteBlock(null)
    setDeletingBlockId(block.id)
    setDeleteBlockError('')

    const { error } = await supabase.from('blocks').delete().eq('id', block.id)

    setDeletingBlockId(null)

    if (error) {
      setDeleteBlockError(`Could not delete block: ${error.message}`)
      return
    }

    setBlocks((current) => current.filter((item) => item.id !== block.id))

    if (currentUser?.id) {
      const { error: activityError } = await supabase.from('activity_log').insert({
        user_id: currentUser.id,
        action: 'Block Deleted',
        target: `${block.name} (by ${actorName})`,
      })

      if (activityError) {
        console.warn('Block deleted, but activity logging failed:', activityError.message)
      }
    }
  }

  const filteredContacts = useMemo(() => {
    const term = normalize(search)

    return contacts.filter((contact) => {
      const property = `${contact.block} lot ${contact.lot_number}`

      const contactStatus = normalize(contact.homeowner_status || 'active')
      const matchesStatus = statusFilter === 'all' || contactStatus === statusFilter
      if (!matchesStatus) return false

      if (!term) return true

      return [
        contact.homeowner_name,
        property,
        contact.contact_phone,
        contact.contact_email,
        contactStatus,
        contact.status_reason,
      ].some((value) => normalize(value).includes(term))
    })
  }, [contacts, search, statusFilter])

  // Whenever the search term (or the underlying contact list) changes, the
  // previously selected page may no longer exist — jump back to page 1 so
  // search results always start from the top, same as before pagination.
  useEffect(() => {
    setPage(1)
  }, [search, statusFilter, contacts])

  const totalPages = Math.max(1, Math.ceil(filteredContacts.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageStartIndex = (safePage - 1) * PAGE_SIZE
  const pagedContacts = filteredContacts.slice(
    pageStartIndex,
    pageStartIndex + PAGE_SIZE,
  )
  const rangeStart = filteredContacts.length === 0 ? 0 : pageStartIndex + 1
  const rangeEnd = Math.min(pageStartIndex + PAGE_SIZE, filteredContacts.length)

  const goToPage = (nextPage) => {
    setPage(Math.min(Math.max(nextPage, 1), totalPages))
  }

  const activeContactCount = contacts.filter(
    (contact) => normalize(contact.homeowner_status || 'active') === 'active',
  ).length
  const movedContactCount = contacts.filter(
    (contact) => normalize(contact.homeowner_status) === 'moved',
  ).length
  const transferredContactCount = contacts.filter(
    (contact) => normalize(contact.homeowner_status) === 'transferred',
  ).length

  return (
    <div className="contact-page">
      <div className="contact-header">
        <div>
          <p className="contact-eyebrow">Secretary workspace</p>
          <h1>Contact Manager</h1>
          <p>Homeowner directory and contact information.</p>
        </div>

        <div className="contact-header-actions">
          {canManageContacts && (
            <button
              type="button"
              className="contact-manage-blocks-button"
              onClick={() => setShowManageBlocks(true)}
            >
              <Settings size={17} />
              Manage Blocks
            </button>
          )}
          {canManageContacts && (
            <button
              type="button"
              className="contact-add-homeowner-button"
              onClick={openHomeownerForm}
            >
              <UserPlus size={17} />
              Add New Homeowner
            </button>
          )}
          <button
            type="button"
            className="contact-refresh-button"
            onClick={() => loadContacts(true)}
            disabled={refreshing}
          >
            <RefreshCw size={17} className={refreshing ? 'contact-spin' : ''} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="contact-summary">
        <div className="contact-summary-item is-active">
          <strong>{loading ? '—' : String(activeContactCount).padStart(2, '0')}</strong>
          <span>Active homeowners</span>
        </div>
        <div className="contact-summary-item is-moved">
          <strong>{loading ? '—' : String(movedContactCount).padStart(2, '0')}</strong>
          <span>Moved homeowners</span>
        </div>
        <div className="contact-summary-item is-transferred">
          <strong>{loading ? '—' : String(transferredContactCount).padStart(2, '0')}</strong>
          <span>Transferred homeowners</span>
        </div>
      </div>

      <div className="contact-toolbar">
        <div className="contact-search-wrap">
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
        <span className="contact-result-count">
          Showing {rangeStart}-{rangeEnd} of {filteredContacts.length}
        </span>
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

      {loading ? (
        <div className="contact-empty glass-card">Loading contacts...</div>
      ) : filteredContacts.length === 0 ? (
        <div className="contact-empty glass-card">
          {contacts.length === 0
            ? 'No homeowners are available in the ledger.'
            : 'No contacts match your search.'}
        </div>
      ) : (
        <div className="contact-grid">
          {pagedContacts.map((contact) => {
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

      {!loading && filteredContacts.length > PAGE_SIZE && (
        <div className="contact-pagination">
          <button
            type="button"
            className="contact-page-button"
            onClick={() => goToPage(safePage - 1)}
            disabled={safePage === 1}
          >
            Previous
          </button>
          <span className="contact-page-indicator">
            Page {safePage} of {totalPages}
          </span>
          <button
            type="button"
            className="contact-page-button"
            onClick={() => goToPage(safePage + 1)}
            disabled={safePage === totalPages}
          >
            Next
          </button>
        </div>
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
                <h2 id="transfer-homeowner-title">Move or Transfer Homeowner</h2>
                <p>
                  The profile and all payment history will remain in the system.
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

            <div className="contact-form-row">
              <div>
                <label htmlFor="homeowner-new-status">New status</label>
                <select
                  id="homeowner-new-status"
                  value={transferForm.status}
                  onChange={(event) =>
                    setTransferForm((current) => ({
                      ...current,
                      status: event.target.value,
                    }))
                  }
                  required
                >
                  <option value="moved">Moved</option>
                  <option value="transferred">Transferred</option>
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
              This does not delete the homeowner. Previous dues, amenity payments,
              service records, and receipts stay connected to this profile.
            </p>

            {transferError && <p className="contact-form-error">{transferError}</p>}

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
                {transferringContactId ? 'Saving...' : 'Confirm Status'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showManageBlocks && (
        <div
          className="contact-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowManageBlocks(false)
          }}
        >
          <div
            className="contact-modal glass-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manage-blocks-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="contact-modal-heading">
              <div>
                <h2 id="manage-blocks-title">Manage Blocks</h2>
                <p>Blocks with homeowners still assigned to them can't be deleted.</p>
              </div>
              <button
                type="button"
                className="contact-modal-close"
                onClick={() => setShowManageBlocks(false)}
                aria-label="Close manage blocks"
              >
                ×
              </button>
            </div>

            {deleteBlockError && <p className="contact-form-error">{deleteBlockError}</p>}

            {blocks.length === 0 ? (
              <p className="contact-form-note">No blocks have been added yet.</p>
            ) : (
              <ul className="contact-blocks-list">
                {blocks.map((block) => (
                  <li key={block.id} className="contact-blocks-list-item">
                    <span>{block.name}</span>
                    <button
                      type="button"
                      className="contact-delete-button"
                      onClick={() => requestDeleteBlock(block)}
                      disabled={deletingBlockId === block.id}
                      aria-label={`Delete ${block.name}`}
                      title="Delete this block"
                    >
                      <Trash2 size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="contact-modal-actions">
              <button
                type="button"
                className="contact-cancel-button"
                onClick={() => setShowManageBlocks(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <ActionDialog
        open={!!pendingDeleteBlock}
        title="Delete Block?"
        message={pendingDeleteBlock ? `Delete "${pendingDeleteBlock.name}"? This cannot be undone.` : ''}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => deleteBlock(pendingDeleteBlock)}
        onCancel={() => setPendingDeleteBlock(null)}
      />

      {showAddHomeowner && (
        <div
          className="contact-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeHomeownerForm()
          }}
        >
          <form
            className="contact-modal glass-card"
            onSubmit={saveHomeowner}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-homeowner-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="contact-modal-heading">
              <div>
                <h2 id="add-homeowner-title">Add New Homeowner</h2>
                <p>Add the homeowner and assign an available block and lot.</p>
              </div>
              <button
                type="button"
                className="contact-modal-close"
                onClick={closeHomeownerForm}
                aria-label="Close homeowner form"
              >
                ×
              </button>
            </div>

            <label htmlFor="homeowner-name">Homeowner full name</label>
            <input
              id="homeowner-name"
              name="homeownerName"
              value={homeownerForm.homeownerName}
              onChange={updateHomeownerField}
              maxLength={120}
              autoFocus
              required
            />

            <div className="contact-form-row">
              <div>
                <label htmlFor="homeowner-block">Block</label>
                <select
                  id="homeowner-block"
                  name="blockName"
                  value={homeownerForm.blockName}
                  onChange={updateHomeownerField}
                  required
                >
                  <option value="">Select block</option>
                  {blocks.map((block) => (
                    <option key={block.id} value={block.name}>
                      {block.name}
                    </option>
                  ))}
                  <option value={ADD_BLOCK_OPTION}>+ Add Block</option>
                </select>
              </div>
              <div>
                <label htmlFor="homeowner-lot">Lot number</label>
                <input
                  id="homeowner-lot"
                  name="lotNumber"
                  type="number"
                  min="1"
                  step="1"
                  value={homeownerForm.lotNumber}
                  onChange={updateHomeownerField}
                  placeholder="e.g. 12"
                  required
                />
              </div>
            </div>

            {homeownerFormError && (
              <p className="contact-form-error">{homeownerFormError}</p>
            )}

            {blocks.length === 0 && !homeownerFormError && (
              <p className="contact-form-note">
                No blocks exist yet — use "+ Add Block" in the dropdown above to create one.
              </p>
            )}

            <div className="contact-modal-actions">
              <button
                type="button"
                className="contact-cancel-button"
                onClick={closeHomeownerForm}
                disabled={savingHomeowner}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="contact-save-button"
                disabled={savingHomeowner || blocks.length === 0}
              >
                {savingHomeowner ? 'Saving...' : 'Save Homeowner'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showAddBlock && (
        <div
          className="contact-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeBlockForm()
          }}
        >
          <form
            className="contact-modal glass-card"
            onSubmit={saveBlock}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-block-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="contact-modal-heading">
              <div>
                <h2 id="add-block-title">Add Block</h2>
                <p>Create a new block before assigning homeowners to it.</p>
              </div>
              <button
                type="button"
                className="contact-modal-close"
                onClick={closeBlockForm}
                aria-label="Close block form"
              >
                ×
              </button>
            </div>

            <label htmlFor="block-name">Block name</label>
            <input
              id="block-name"
              value={blockForm.name}
              onChange={updateBlockField}
              placeholder="e.g. Block F"
              maxLength={50}
              autoFocus
              required
            />

            {blockFormError && (
              <p className="contact-form-error">{blockFormError}</p>
            )}

            <div className="contact-modal-actions">
              <button
                type="button"
                className="contact-cancel-button"
                onClick={closeBlockForm}
                disabled={savingBlock}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="contact-save-button"
                disabled={savingBlock}
              >
                {savingBlock ? 'Saving...' : 'Save Block'}
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