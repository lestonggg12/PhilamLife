import { notifySuccess } from '../lib/actionFeedback'
import { useSuccessNotice } from '../lib/useSuccessNotice'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import Select from '../components/Select'
import './DocumentLibraryPage.css'
import Skeleton from '../components/skeleton/Skeleton'
import {
  AlertCircle,
  Download,
  FileText,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import { fetchAll } from '../lib/fetchAll'
import { deleteDocumentSafely } from '../lib/documentDeletion'
import { DOCUMENT_COLUMNS, documentUploadRequest, uploadDocumentSafely } from '../lib/documentUpload'
import { useOrganization } from '../context/OrganizationContext'
import ActionDialog from '../components/ActionDialog'

const BUCKET = 'hoa-documents'
const MAX_FILE_SIZE = 10 * 1024 * 1024
// Metadata totals below describe library files only, NOT Supabase project usage.
// Other buckets, orphaned objects, and plan-specific storage limits are omitted.
const CATEGORIES = [
  'Minutes',
  'Reports',
  'Legal',
  'Announcements',
  'Forms',
  'Other',
]
const MIME_BY_EXTENSION = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
}
const ACCEPTED_EXTENSIONS = Object.keys(MIME_BY_EXTENSION)

const EMPTY_FORM = {
  title: '',
  category: 'Minutes',
}

function formatFileSize(bytes) {
  const size = Number(bytes) || 0

  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`

  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function safeFileName(fileName) {
  const extensionIndex = fileName.lastIndexOf('.')
  const extension =
    extensionIndex >= 0 ? fileName.slice(extensionIndex).toLowerCase() : ''
  const baseName = extensionIndex >= 0 ? fileName.slice(0, extensionIndex) : fileName
  const safeBase =
    baseName
      .normalize('NFKD')
      .replace(/[^\w-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 90) || 'document'

  return `${safeBase}${extension}`
}

function titleFromFileName(fileName) {
  return fileName.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim()
}

export default function DocumentLibraryPage({ user: suppliedUser }) {
  const { organization } = useOrganization()
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [documents, setDocuments] = useState([])
  const [hasSnapshot, setHasSnapshot] = useState(false)
  const hasSnapshotRef = useRef(false)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [pageError, setPageError] = useState('')
  const [notice, setNotice] = useSuccessNotice()
  const [showUpload, setShowUpload] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [selectedFile, setSelectedFile] = useState(null)
  const [formError, setFormError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [downloadingId, setDownloadingId] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [highlightedDocumentId, setHighlightedDocumentId] = useState(null)
  const loadSequence = useRef(0)
  const mutationVersion = useRef(0)
  const pendingUploads = useRef(new Map())
  const deleteInProgress = useRef(false)
  const downloadInProgress = useRef(false)
  const uploadInProgress = useRef(false)

  const role = currentUser?.is_active === false ? '' : currentUser?.role?.trim().toLowerCase()
  const canUploadDocuments = role === 'secretary'
  const canDeleteDocuments = ['admin', 'secretary'].includes(role)
  const canReadDocuments = ['admin', 'secretary', 'treasurer'].includes(role) && Boolean(currentUser?.id)

  useEffect(() => { resolveCurrentUser() }, [])

  useEffect(() => {
    if (!canReadDocuments) return undefined
    loadDocuments()
    return () => { loadSequence.current += 1 }
  }, [canReadDocuments, currentUser?.id])

  async function resolveCurrentUser() {
    if (suppliedUser) {
      setCurrentUser(suppliedUser)
      if (!canReadDocuments) setLoading(false)
      return
    }

    try {
      const { data, error: authError } = await supabase.auth.getUser()
      if (authError) throw authError
      if (!data?.user) throw new Error('Sign in again to verify document access.')
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, is_active')
        .eq('id', data.user.id)
        .single()
      if (profileError) throw profileError
      if (!profile?.id || profile.is_active === false) throw new Error('Your staff account is unavailable or inactive.')
      if (!['admin', 'secretary', 'treasurer'].includes(profile.role?.trim().toLowerCase())) {
        throw new Error('This account does not have Document Library access.')
      }
      setCurrentUser(profile)
    } catch (error) {
      setCurrentUser(null)
      setLoading(false)
      setPageError(`Document access could not be verified: ${error.message || 'Please sign in again.'}`)
    }
  }

  async function loadDocuments(isRefresh = false) {
    const requestId = ++loadSequence.current
    const version = mutationVersion.current
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setPageError('')
    try {
      const { data, error } = await fetchAll(() => supabase
        .from('documents')
        .select(DOCUMENT_COLUMNS)
        .order('created_at', { ascending: false }))
      if (requestId !== loadSequence.current || version !== mutationVersion.current) return
      if (error) throw error
      if (!Array.isArray(data)) throw new Error('The document list response was incomplete.')
      setDocuments(data)
      hasSnapshotRef.current = true
      setHasSnapshot(true)
    } catch (error) {
      // Never replace an authoritative document list with a failed/partial response.
      if (requestId === loadSequence.current && version === mutationVersion.current) {
        setPageError(`Documents could not be loaded: ${error.message || 'Connection failed.'}${hasSnapshotRef.current ? ' Showing the last loaded list.' : ''}`)
      }
    } finally {
      if (requestId === loadSequence.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }

  function openUploadForm() {
    setForm(EMPTY_FORM)
    setSelectedFile(null)
    setFormError('')
    setNotice('')
    setShowUpload(true)
  }

  function closeUploadForm() {
    if (uploading) return
    setShowUpload(false)
    setForm(EMPTY_FORM)
    setSelectedFile(null)
    setFormError('')
  }

  function updateForm(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setFormError('')
  }

  function selectFile(event) {
    const file = event.target.files?.[0] || null
    setSelectedFile(file)
    setFormError('')

    if (file && !form.title.trim()) {
      setForm((current) => ({
        ...current,
        title: Array.from(titleFromFileName(file.name)).slice(0, 160).join(''),
      }))
    }
  }

  function validateFile(file) {
    if (!file) return 'Choose a document to upload.'
    if (file.size <= 0) return 'The selected file is empty.'
    if (file.size > MAX_FILE_SIZE) return 'The file must be 10 MB or smaller.'

    const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()

    const type = file.type.trim().toLowerCase()
    if (Array.from(file.name).length > 255) return 'The file name must be 255 characters or fewer.'
    if (!Object.hasOwn(MIME_BY_EXTENSION, extension) ||
        (type && type !== 'application/octet-stream' && type !== MIME_BY_EXTENSION[extension])) {
      return 'Use a PDF, Word, Excel, JPG, or PNG file.'
    }

    return ''
  }

  async function uploadDocument(event) {
    event.preventDefault()
    if (uploadInProgress.current || deleteInProgress.current) return

    if (!canUploadDocuments || !currentUser?.id) {
      setFormError('Only a verified Secretary can upload documents.')
      return
    }

    const title = form.title.trim().replace(/\s+/g, ' ')
    const fileError = validateFile(selectedFile)

    if (!title) {
      setFormError('Enter a document title.')
      return
    }

    if (Array.from(title).length > 160) {
      setFormError('Document title must be 160 characters or fewer.')
      return
    }

    if (!CATEGORIES.includes(form.category)) {
      setFormError('Choose a valid document category.')
      return
    }

    if (fileError) {
      setFormError(fileError)
      return
    }

    uploadInProgress.current = true
    mutationVersion.current += 1
    setUploading(true)
    setFormError('')
    let request

    try {
      if (!globalThis.crypto?.randomUUID || !globalThis.crypto?.subtle) {
        throw new Error('Secure document uploads require HTTPS or localhost.')
      }
      const extension = selectedFile.name.slice(selectedFile.name.lastIndexOf('.')).toLowerCase()
      const payload = {
        title,
        category: form.category,
        original_file_name: selectedFile.name,
        mime_type: MIME_BY_EXTENSION[extension],
        file_size: selectedFile.size,
        uploaded_by: currentUser.id,
      }
      request = await documentUploadRequest(selectedFile, payload, safeFileName(selectedFile.name), pendingUploads.current)
      const data = await uploadDocumentSafely(supabase, BUCKET, request.path, selectedFile, payload)
      request.clear()
      mutationVersion.current += 1
      setDocuments(current => [data, ...current.filter(document => document.id !== data.id)])
      setHighlightedDocumentId(data.id)
      setShowUpload(false)
      setForm(EMPTY_FORM)
      setSelectedFile(null)
      setNotice(`“${data.title}” was uploaded successfully.`)
      await loadDocuments(true)
    } catch (error) {
      if (error.code === 'PHD01') request?.clear()
      setFormError(error.message || 'Document upload failed. Try again.')
    } finally {
      uploadInProgress.current = false
      setUploading(false)
    }
  }

  async function downloadDocument(document) {
    if (document.deletion_requested_at) {
      setPageError('This document is pending deletion and cannot be downloaded.')
      return
    }
    if (downloadInProgress.current) return
    downloadInProgress.current = true
    setDownloadingId(document.id)
    setPageError('')
    setNotice('')

    let downloadUrl
    try {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .download(document.storage_path)
      if (error) throw error
      if (!data) throw new Error('No file was returned by Storage.')

      downloadUrl = URL.createObjectURL(data)
      const link = window.document.createElement('a')
      link.href = downloadUrl
      link.download = document.original_file_name
      window.document.body.appendChild(link)
      try {
        link.click()
      } finally {
        link.remove()
      }
      notifySuccess(`Download started for “${document.title}”.`)
    } catch (error) {
      setPageError(`Download failed: ${error.message || 'Please try again.'}`)
    } finally {
      if (downloadUrl) window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
      downloadInProgress.current = false
      setDownloadingId(null)
    }
  }

  function requestDeleteDocument(document) {
    if (!canDeleteDocuments || deleteInProgress.current || uploadInProgress.current) return
    setPendingDelete(document)
  }

  async function deleteDocument(document) {
    if (deleteInProgress.current || uploadInProgress.current) return
    if (!canDeleteDocuments || !document || !currentUser?.id) {
      setPendingDelete(null)
      setPageError('Only an Admin or Secretary can delete documents.')
      return
    }

    deleteInProgress.current = true
    mutationVersion.current += 1
    setPendingDelete(null)
    setDeletingId(document.id)
    setPageError('')
    setNotice('')

    try {
      const result = await deleteDocumentSafely(supabase, document.id, (pending) => {
        setDocuments((current) => current.map((item) => item.id === pending.id ? pending : item))
      })
      mutationVersion.current += 1
      setDocuments((current) => current.filter((doc) => doc.id !== document.id))
      setNotice(result.alreadyDeleted
        ? `“${document.title}” was already removed. The list has been updated.`
        : `“${document.title}” was permanently deleted from the library.`)
      await loadDocuments(true)
    } catch (error) {
      await loadDocuments(true)
      setPageError(error.message)
    } finally {
      deleteInProgress.current = false
      setDeletingId(null)
    }
  }

  const filteredDocuments = useMemo(() => {
    const term = search.trim().toLowerCase()

    return documents.filter((document) => {
      const matchesCategory =
        category === 'All' || document.category === category
      const matchesSearch =
        !term ||
        [
          document.title,
          document.original_file_name,
          document.category,
          document.uploaded_by_name,
        ].some((value) => String(value || '').toLowerCase().includes(term))

      return matchesCategory && matchesSearch
    })
  }, [category, documents, search])

  const availableDocuments = filteredDocuments.filter(document => !document.deletion_requested_at)
  const filteredTotalSize = availableDocuments.reduce((sum, document) => sum + Number(document.file_size), 0)
  const filteredCategoryCount = new Set(availableDocuments.map(document => document.category)).size
  const filteredPendingCount = filteredDocuments.filter((document) => document.deletion_requested_at).length

  return (
    <div className="doc-library">
      <div className="doc-header">
        <div>
          <p className="doc-eyebrow">
            {canUploadDocuments ? 'Secretary workspace' : 'Document access'}
          </p>
          <h1>Document Library</h1>
          <p>Store and download official HOA documents securely.</p>
        </div>

        <div className="doc-header-actions">
          {canUploadDocuments && (
            <button
              type="button"
              className="doc-upload-button"
              onClick={openUploadForm}
            >
              <Plus size={18} />
              Upload Document
            </button>
          )}
          <button
            type="button"
            className="doc-refresh-button"
            onClick={() => loadDocuments(true)}
            disabled={refreshing || uploading || Boolean(deletingId) || !canReadDocuments}
          >
            <RefreshCw size={17} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="doc-summary" aria-label="Document summaries" aria-busy={loading || refreshing}>
        <div className="doc-summary-item">
          <span><FileText size={18} /> Available documents</span>
          <strong>{loading ? <Skeleton variant="rect" width="36px" height="1.2em" /> : hasSnapshot ? availableDocuments.length : '—'}</strong>
        </div>
        <div className="doc-summary-item">
          <span><Download size={18} /> Available file size</span>
          <strong>{hasSnapshot ? formatFileSize(filteredTotalSize) : '—'}</strong>
        </div>
        <div className="doc-summary-item">
          <span><Search size={18} /> Categories in view</span>
          <strong>{loading ? <Skeleton variant="rect" width="36px" height="1.2em" /> : hasSnapshot ? filteredCategoryCount : '—'}</strong>
        </div>
        <div className="doc-summary-item">
          <span><AlertCircle size={18} /> Deletion pending</span>
          <strong>{loading ? <Skeleton variant="rect" width="36px" height="1.2em" /> : hasSnapshot ? filteredPendingCount : '—'}</strong>
        </div>
      </div>

      {!loading && canUploadDocuments && (
        <p className="doc-storage-note">
          Library totals are calculated from document records, not total Supabase Storage usage.
          Storage quota is checked by Supabase during upload.
        </p>
      )}

      <div className="doc-toolbar">
        <label className="doc-search-wrap">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            placeholder="Search by title, file name, category, or uploader..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="doc-search"
            aria-label="Search documents"
          />
        </label>

        <Select ariaLabel="Filter documents by category" value={category} onChange={setCategory} options={[{ value: 'All', label: 'All Categories' }, ...CATEGORIES.map((item) => ({ value: item, label: item }))]} />

      </div>

      <div className="doc-result-row">
        <span>
          {hasSnapshot ? `Showing ${filteredDocuments.length} of ${documents.length} library entries` : 'Document totals unavailable'}
        </span>
      </div>

      {pageError && <p className="doc-message doc-error">{pageError}</p>}
      <div className="doc-list glass-card" aria-live="polite">
        {loading ? (
          <div className="doc-empty" aria-busy="true"><Skeleton variant="rect" width="100%" height="64px" /><Skeleton variant="rect" width="100%" height="64px" /><Skeleton variant="rect" width="100%" height="64px" /><Skeleton variant="rect" width="100%" height="64px" /><span className="skeleton-region-status" role="status">Loading</span></div>
        ) : !hasSnapshot ? (
          <p className="doc-empty" role="alert">Unable to display the document list. Use Refresh to retry.</p>
        ) : filteredDocuments.length === 0 ? (
          <p className="doc-empty">
            {documents.length === 0
              ? 'No documents have been uploaded yet.'
              : 'No documents match your filters.'}
          </p>
        ) : (
          filteredDocuments.map((document) => (
            <article key={document.id} className={`doc-row${document.id === highlightedDocumentId ? ' motion-record-highlight' : ''}`}>
              <div className="doc-icon">
                <FileText size={21} />
              </div>
              <div className="doc-info">
                <p className="doc-name">{document.title}</p>
                <p className="doc-file-name">{document.original_file_name}</p>
                <p className="doc-meta">
                  <span className="doc-category">{document.category}</span>
                  {document.deletion_requested_at && <span role="status">Deletion pending</span>}
                  <span>{formatFileSize(document.file_size)}</span>
                  <span>{organization.formatDate(document.created_at, { withTime: true })}</span>
                  <span>Uploaded by {document.uploaded_by_name}</span>
                </p>
              </div>

              <div className="doc-actions">
                <button
                  type="button"
                  className="doc-download-button"
                  onClick={() => downloadDocument(document)}
                  disabled={Boolean(downloadingId || document.deletion_requested_at || deletingId)}
                  aria-label={`Download ${document.title}`}
                >
                  <Download size={17} />
                  {downloadingId === document.id ? 'Downloading...' : 'Download'}
                </button>

                {canDeleteDocuments && (
                  <button
                    type="button"
                    className={`doc-delete-button${document.deletion_requested_at ? ' doc-delete-retry' : ''}`}
                    onClick={() => requestDeleteDocument(document)}
                    disabled={Boolean(deletingId || uploading)}
                    aria-label={`${document.deletion_requested_at ? 'Retry deletion of' : 'Delete'} ${document.title}`}
                    title={document.deletion_requested_at ? 'Retry deletion' : 'Delete this document'}
                  >
                    <Trash2 size={17} />
                    {document.deletion_requested_at && 'Retry deletion'}
                  </button>
                )}
              </div>
            </article>
          ))
        )}
      </div>

      <ActionDialog
        open={!!pendingDelete}
        title={pendingDelete?.deletion_requested_at ? 'Finish Document Deletion?' : 'Delete Document?'}
        message={
          pendingDelete
            ? pendingDelete.deletion_requested_at
              ? `Finish deleting "${pendingDelete.title}"? The previous attempt is pending. This cannot be undone.`
              : `Delete "${pendingDelete.title}" (${pendingDelete.original_file_name})? The stored file will be permanently removed. You can upload it again as a new entry.`
            : ''
        }
        confirmLabel={pendingDelete?.deletion_requested_at ? 'Retry deletion' : 'Delete'}
        tone="danger"
        onConfirm={() => deleteDocument(pendingDelete)}
        onCancel={() => setPendingDelete(null)}
      />

      {showUpload && (
        <div
          className="doc-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeUploadForm()
          }}
        >
          <section
            className="doc-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="doc-upload-title"
          >
            <div className="doc-modal-header">
              <div>
                <h2 id="doc-upload-title">Upload Document</h2>
                <p>Add an official file to the private HOA library.</p>
              </div>
              <button
                type="button"
                className="doc-close-button"
                onClick={closeUploadForm}
                disabled={uploading}
                aria-label="Close upload form"
              >
                <X size={20} />
              </button>
            </div>

            <form className="doc-form" onSubmit={uploadDocument}>
              <label>
                Document file
                <input
                  type="file"
                  accept={ACCEPTED_EXTENSIONS.join(',')}
                  onChange={selectFile}
                  disabled={uploading}
                  required
                />
                <small>PDF, Word, Excel, JPG, or PNG. Maximum 10 MB.</small>
              </label>

              <label>
                Document title
                <input
                  type="text"
                  name="title"
                  value={form.title}
                  onChange={updateForm}
                  maxLength={160}
                  placeholder="Enter a clear document title"
                  disabled={uploading}
                  required
                />
              </label>

              <label>
                Category
                <Select ariaLabel="Category" value={form.category} onChange={(value) => updateForm({ target: { name: 'category', value } })} disabled={uploading} options={CATEGORIES.map((item) => ({ value: item, label: item }))} />
              </label>

              {formError && <p className="doc-form-error">{formError}</p>}

              <div className="doc-form-actions">
                <button
                  type="button"
                  className="doc-cancel-button"
                  onClick={closeUploadForm}
                  disabled={uploading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="doc-submit-button"
                  disabled={uploading}
                >
                  {uploading ? 'Uploading...' : 'Upload Document'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}