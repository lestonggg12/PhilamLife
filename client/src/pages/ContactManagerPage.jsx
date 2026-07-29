import React, { useEffect, useMemo, useState } from 'react'
import { Edit, FileText, Mail, Phone, RefreshCw, Send } from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import './ContactManagerPage.css'

const MAX_PDF_BYTES = 10 * 1024 * 1024
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const EMPTY_FORM = {
  phone: '',
  email: '',
}

const EMPTY_EMAIL_FORM = {
  subject: '',
  message: '',
  file: null,
}

const normalize = (value) => String(value ?? '').trim().toLowerCase()

const formatFileSize = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const formatCampaignDate = (value) =>
  new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(new Date(value))

const safeFileName = (name) =>
  name
    .replace(/[^\w.\-() ]/g, '_')
    .replace(/\s+/g, '-')
    .slice(-180)

export default function ContactManagerPage({ user: suppliedUser }) {
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [contacts, setContacts] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [campaignsLoading, setCampaignsLoading] = useState(false)
  const [pageError, setPageError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedContact, setSelectedContact] = useState(null)
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [emailForm, setEmailForm] = useState(EMPTY_EMAIL_FORM)
  const [formError, setFormError] = useState('')
  const [emailError, setEmailError] = useState('')
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [retryingCampaignId, setRetryingCampaignId] = useState(null)

  const role = currentUser?.role?.trim().toLowerCase()
  const canManageContacts = role === 'admin' || role === 'secretary'
  const canSendPdf = role === 'secretary'
  const actorName =
    currentUser?.full_name ||
    currentUser?.name ||
    currentUser?.email ||
    'Staff member'

  useEffect(() => {
    loadContacts()
    resolveCurrentUser()
  }, [])

  useEffect(() => {
    if (canSendPdf) loadCampaigns()
  }, [canSendPdf])

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

  async function loadCampaigns() {
    setCampaignsLoading(true)

    const { data, error } = await supabase
      .from('email_campaigns')
      .select(
        'id, subject, original_file_name, status, recipient_count, sent_count, failed_count, skipped_count, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(10)

    if (error) {
      setCampaigns([])
      setPageError(`Email history could not be loaded: ${error.message}`)
    } else {
      setCampaigns(data || [])
    }

    setCampaignsLoading(false)
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

  function openEmailModal() {
    setSelectedContact(null)
    setEmailForm(EMPTY_EMAIL_FORM)
    setEmailError('')
    setNotice('')
    setEmailModalOpen(true)
  }

  function closeEmailModal() {
    if (sending) return
    setEmailModalOpen(false)
    setEmailForm(EMPTY_EMAIL_FORM)
    setEmailError('')
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

  async function removeOrphanedUpload(storagePath) {
    const { data: campaign } = await supabase
      .from('email_campaigns')
      .select('id')
      .eq('storage_path', storagePath)
      .maybeSingle()

    if (!campaign) {
      await supabase.storage.from('hoa-documents').remove([storagePath])
    }
  }

  async function getFunctionError(error) {
    try {
      const details = await error?.context?.json()
      return details?.error || error?.message
    } catch {
      return error?.message
    }
  }

  async function sendPdf(event) {
    event.preventDefault()

    if (!canSendPdf || !currentUser?.id) {
      setEmailError('Only the Secretary can send homeowner PDFs.')
      return
    }

    const subject = emailForm.subject.trim()
    const message = emailForm.message.trim()
    const file = emailForm.file

    if (!subject || !message) {
      setEmailError('Enter an email subject and message.')
      return
    }

    if (!file) {
      setEmailError('Choose a PDF file to send.')
      return
    }

    if (
      file.type !== 'application/pdf' &&
      !file.name.toLowerCase().endsWith('.pdf')
    ) {
      setEmailError('Only PDF files are allowed.')
      return
    }

    if (file.size <= 0 || file.size > MAX_PDF_BYTES) {
      setEmailError('The PDF must be between 1 byte and 10 MB.')
      return
    }

    if (validEmailRecipients.length === 0) {
      setEmailError('No valid homeowner email addresses are available.')
      return
    }

    setSending(true)
    setEmailError('')

    const storagePath = `email-campaigns/${currentUser.id}/${crypto.randomUUID()}-${safeFileName(
      file.name,
    )}`

    const { error: uploadError } = await supabase.storage
      .from('hoa-documents')
      .upload(storagePath, file, {
        contentType: 'application/pdf',
        upsert: false,
      })

    if (uploadError) {
      setEmailError(`PDF upload failed: ${uploadError.message}`)
      setSending(false)
      return
    }

    const { data, error } = await supabase.functions.invoke(
      'send-homeowner-pdf',
      {
        body: {
          mode: 'send',
          storagePath,
          subject,
          message,
          fileName: file.name,
          fileSize: file.size,
        },
      },
    )

    if (error) {
      const errorMessage = await getFunctionError(error)
      await removeOrphanedUpload(storagePath)
      setEmailError(errorMessage || 'The PDF could not be sent.')
      setSending(false)
      return
    }

    setSending(false)
    setEmailModalOpen(false)
    setEmailForm(EMPTY_EMAIL_FORM)
    setNotice(data?.message || 'The homeowner PDF campaign is complete.')
    await loadCampaigns()
  }

  async function retryFailedEmails(campaign) {
    if (!canSendPdf || !campaign?.id || retryingCampaignId) return

    setRetryingCampaignId(campaign.id)
    setPageError('')
    setNotice('')

    const { data, error } = await supabase.functions.invoke(
      'send-homeowner-pdf',
      {
        body: { mode: 'retry', campaignId: campaign.id },
      },
    )

    if (error) {
      const errorMessage = await getFunctionError(error)
      setPageError(errorMessage || 'Failed emails could not be retried.')
    } else {
      setNotice(data?.message || 'Failed emails were retried.')
    }

    setRetryingCampaignId(null)
    await loadCampaigns()
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

  const validEmailRecipients = useMemo(() => {
    const uniqueEmails = new Set()

    return contacts.filter((contact) => {
      const email = normalize(contact.contact_email)
      if (!EMAIL_PATTERN.test(email) || uniqueEmails.has(email)) return false
      uniqueEmails.add(email)
      return true
    })
  }, [contacts])

  const skippedEmailCount = contacts.length - validEmailRecipients.length

  return (
    <div className="contact-page">
      <div className="contact-header">
        <div>
          <h1>Contact Manager</h1>
          <p>Homeowner directory and contact information.</p>
        </div>

        <div className="contact-header-actions">
          {canSendPdf && (
            <button
              type="button"
              className="contact-send-button"
              onClick={openEmailModal}
              disabled={loading || validEmailRecipients.length === 0}
            >
              <Send size={17} />
              Send PDF to Homeowners
            </button>
          )}
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

      {canSendPdf && (
        <section className="contact-campaign-section glass-card">
          <div className="contact-campaign-heading">
            <div>
              <h2>PDF Email History</h2>
              <p>Latest sends to the homeowner contact directory.</p>
            </div>
            <span>{campaigns.length} recent campaign(s)</span>
          </div>

          {campaignsLoading ? (
            <p className="contact-campaign-empty">Loading email history...</p>
          ) : campaigns.length === 0 ? (
            <p className="contact-campaign-empty">
              No homeowner PDFs have been sent yet.
            </p>
          ) : (
            <div className="contact-campaign-table-wrap">
              <table className="contact-campaign-table">
                <thead>
                  <tr>
                    <th>Sent</th>
                    <th>Subject and PDF</th>
                    <th>Recipients</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((campaign) => (
                    <tr key={campaign.id}>
                      <td>{formatCampaignDate(campaign.created_at)}</td>
                      <td>
                        <strong>{campaign.subject}</strong>
                        <span>{campaign.original_file_name}</span>
                      </td>
                      <td>
                        {campaign.sent_count}/{campaign.recipient_count} sent
                        {campaign.skipped_count > 0 && (
                          <span>{campaign.skipped_count} without valid email</span>
                        )}
                      </td>
                      <td>
                        <span
                          className={`contact-campaign-status ${campaign.status}`}
                        >
                          {campaign.status}
                        </span>
                      </td>
                      <td>
                        {campaign.failed_count > 0 ? (
                          <button
                            type="button"
                            className="contact-retry-button"
                            onClick={() => retryFailedEmails(campaign)}
                            disabled={Boolean(retryingCampaignId)}
                          >
                            <RefreshCw size={14} />
                            {retryingCampaignId === campaign.id
                              ? 'Retrying...'
                              : `Retry ${campaign.failed_count} failed`}
                          </button>
                        ) : (
                          <span className="contact-no-action">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
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

      {emailModalOpen && (
        <div
          className="contact-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeEmailModal()
          }}
        >
          <form
            className="contact-modal contact-email-modal glass-card"
            onSubmit={sendPdf}
            role="dialog"
            aria-modal="true"
            aria-labelledby="contact-email-modal-title"
          >
            <div className="contact-modal-heading">
              <div>
                <h2 id="contact-email-modal-title">Send PDF to Homeowners</h2>
                <p>
                  Each homeowner receives a separate private email.
                </p>
              </div>
              <button
                type="button"
                className="contact-modal-close"
                onClick={closeEmailModal}
                aria-label="Close PDF email form"
              >
                ×
              </button>
            </div>

            <div className="contact-recipient-summary">
              <Mail size={19} />
              <div>
                <strong>
                  {validEmailRecipients.length} valid recipient
                  {validEmailRecipients.length === 1 ? '' : 's'}
                </strong>
                <span>
                  {skippedEmailCount} homeowner
                  {skippedEmailCount === 1 ? '' : 's'} missing a valid email
                </span>
              </div>
            </div>

            <label htmlFor="campaign-subject">Email Subject</label>
            <input
              id="campaign-subject"
              type="text"
              value={emailForm.subject}
              onChange={(event) => {
                setEmailForm((current) => ({
                  ...current,
                  subject: event.target.value,
                }))
                setEmailError('')
              }}
              maxLength={200}
              placeholder="e.g. July HOA Community Notice"
              disabled={sending}
            />

            <label htmlFor="campaign-message">Message</label>
            <textarea
              id="campaign-message"
              value={emailForm.message}
              onChange={(event) => {
                setEmailForm((current) => ({
                  ...current,
                  message: event.target.value,
                }))
                setEmailError('')
              }}
              maxLength={5000}
              rows={5}
              placeholder="Write the short message that will appear in the email."
              disabled={sending}
            />

            <label htmlFor="campaign-pdf">PDF Attachment</label>
            <label className="contact-file-picker" htmlFor="campaign-pdf">
              <FileText size={22} />
              <span>
                {emailForm.file
                  ? emailForm.file.name
                  : 'Choose a PDF file (maximum 10 MB)'}
              </span>
              {emailForm.file && (
                <small>{formatFileSize(emailForm.file.size)}</small>
              )}
            </label>
            <input
              id="campaign-pdf"
              className="contact-file-input"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => {
                setEmailForm((current) => ({
                  ...current,
                  file: event.target.files?.[0] || null,
                }))
                setEmailError('')
              }}
              disabled={sending}
            />

            <p className="contact-send-warning">
              Confirm the subject, message, PDF, and homeowner email addresses
              before sending. This action emails every valid address on file.
            </p>

            {emailError && <p className="contact-form-error">{emailError}</p>}

            <div className="contact-modal-actions">
              <button
                type="button"
                className="contact-cancel-button"
                onClick={closeEmailModal}
                disabled={sending}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="contact-save-button"
                disabled={sending || validEmailRecipients.length === 0}
              >
                <Send size={16} />
                {sending
                  ? 'Sending PDF...'
                  : `Send to ${validEmailRecipients.length} Homeowner${
                      validEmailRecipients.length === 1 ? '' : 's'
                    }`}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}