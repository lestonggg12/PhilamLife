import React, { useEffect, useMemo, useState } from 'react'
import { Edit, Mail, Phone, RefreshCw } from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import './ContactManagerPage.css'

const EMPTY_FORM = {
  phone: '',
  email: '',
}

const normalize = (value) => String(value ?? '').trim().toLowerCase()

export default function ContactManagerPage({ user: suppliedUser }) {
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [contacts, setContacts] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [pageError, setPageError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedContact, setSelectedContact] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

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

    const { data, error } = await supabase
      .from('properties')
      .select(
        'id, block, lot_number, homeowner_name, contact_phone, contact_email, contact_updated_at',
      )
      .order('homeowner_name')

    if (error) {
      setContacts([])
      setPageError(`Contact directory could not be loaded: ${error.message}`)
    } else {
      setContacts(data || [])
    }

    setLoading(false)
    setRefreshing(false)
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
        'id, block, lot_number, homeowner_name, contact_phone, contact_email, contact_updated_at',
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

  const filteredContacts = useMemo(() => {
    const term = normalize(search)

    if (!term) return contacts

    return contacts.filter((contact) => {
      const property = `${contact.block} lot ${contact.lot_number}`

      return [
        contact.homeowner_name,
        property,
        contact.contact_phone,
        contact.contact_email,
      ].some((value) => normalize(value).includes(term))
    })
  }, [contacts, search])

  const completedContactCount = contacts.filter(
    (contact) => contact.contact_phone || contact.contact_email,
  ).length

  return (
    <div className="contact-page">
      <div className="contact-header">
        <div>
          <h1>Contact Manager</h1>
          <p>Homeowner directory and contact information.</p>
        </div>

        <button
          type="button"
          className="contact-refresh-button"
          onClick={() => loadContacts(true)}
          disabled={refreshing}
        >
          <RefreshCw size={17} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="contact-summary">
        <div className="contact-summary-item">
          <span>Total homeowners</span>
          <strong>{loading ? '—' : contacts.length}</strong>
        </div>
        <div className="contact-summary-item">
          <span>With contact details</span>
          <strong>{loading ? '—' : completedContactCount}</strong>
        </div>
        <div className="contact-summary-item">
          <span>Missing contact details</span>
          <strong>
            {loading ? '—' : contacts.length - completedContactCount}
          </strong>
        </div>
      </div>

      <div className="contact-toolbar">
        <input
          type="search"
          placeholder="Search by name, block, lot, phone, or email..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="contact-search"
          aria-label="Search homeowner contacts"
        />
        <span className="contact-result-count">
          Showing {filteredContacts.length} of {contacts.length}
        </span>
      </div>

      {pageError && <p className="contact-message contact-error">{pageError}</p>}
      {notice && <p className="contact-message contact-success">{notice}</p>}

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
          {filteredContacts.map((contact) => {
            const hasContactDetails =
              contact.contact_phone || contact.contact_email

            return (
              <article key={contact.id} className="contact-card glass-card">
                <div className="contact-card-heading">
                  <div className="contact-avatar">
                    {(contact.homeowner_name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h2 className="contact-name">
                      {contact.homeowner_name || 'Unnamed homeowner'}
                    </h2>
                    <p className="contact-property">
                      {contact.block}, Lot {contact.lot_number}
                    </p>
                  </div>
                </div>

                <div className="contact-details">
                  <div className="contact-detail">
                    <Phone size={17} />
                    {contact.contact_phone ? (
                      <a href={`tel:${contact.contact_phone}`}>
                        {contact.contact_phone}
                      </a>
                    ) : (
                      <span className="contact-missing">Phone not provided</span>
                    )}
                  </div>
                  <div className="contact-detail">
                    <Mail size={17} />
                    {contact.contact_email ? (
                      <a href={`mailto:${contact.contact_email}`}>
                        {contact.contact_email}
                      </a>
                    ) : (
                      <span className="contact-missing">Email not provided</span>
                    )}
                  </div>
                </div>

                {canManageContacts && (
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
                )}
              </article>
            )
          })}
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