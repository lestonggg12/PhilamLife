import React, { useEffect, useMemo, useState } from 'react'
import './DocumentLibraryPage.css'
import {
  AlertCircle,
  Download,
  FileText,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import ActionDialog from '../components/ActionDialog'

const BUCKET = 'hoa-documents'
const MAX_FILE_SIZE = 10 * 1024 * 1024
// Supabase's free tier includes 1 GiB of Storage across the whole project,
// shared by every bucket. This isn't just this library's own budget.
const STORAGE_LIMIT = 1024 * 1024 * 1024
const STORAGE_WARNING_THRESHOLD = 0.8 // start warning at 80% used
const CATEGORIES = [
  'Minutes',
  'Reports',
  'Legal',
  'Announcements',
  'Forms',
  'Other',
]
const ACCEPTED_EXTENSIONS = [
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.jpg',
  '.jpeg',
  '.png',
]
const ACCEPTED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
])

const dateTime = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Manila',
})

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
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [documents, setDocuments] = useState([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [pageError, setPageError] = useState('')
  const [notice, setNotice] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [selectedFile, setSelectedFile] = useState(null)
  const [formError, setFormError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [downloadingId, setDownloadingId] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  const role = currentUser?.role?.trim().toLowerCase()
  const canUploadDocuments = role === 'secretary'
  const canDeleteDocuments = ['admin', 'secretary'].includes(role)
  const actorName =
    currentUser?.full_name ||
    currentUser?.name ||
    currentUser?.email ||
    'Secretary'

  useEffect(() => {
    loadDocuments()
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

  async function loadDocuments(isRefresh = false) {
    if (isRefresh) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }

    setPageError('')
    setNotice('')

    const { data, error } = await supabase
      .from('documents')
      .select(
        'id, title, category, storage_path, original_file_name, mime_type, file_size, uploaded_by, uploaded_by_name, created_at',
      )
      .order('created_at', { ascending: false })

    if (error) {
      setDocuments([])
      setPageError(`Documents could not be loaded: ${error.message}`)
    } else {
      setDocuments(data || [])
    }

    setLoading(false)
    setRefreshing(false)
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
        title: titleFromFileName(file.name),
      }))
    }
  }

  function validateFile(file) {
    if (!file) return 'Choose a document to upload.'
    if (file.size <= 0) return 'The selected file is empty.'
    if (file.size > MAX_FILE_SIZE) return 'The file must be 10 MB or smaller.'

    const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()

    if (
      !ACCEPTED_EXTENSIONS.includes(extension) ||
      !ACCEPTED_MIME_TYPES.has(file.type)
    ) {
      return 'Use a PDF, Word, Excel, JPG, or PNG file.'
    }

    return ''
  }

  async function uploadDocument(event) {
    event.preventDefault()

    if (!canUploadDocuments || !currentUser?.id) {
      setFormError('Only a verified Secretary can upload documents.')
      return
    }

    const title = form.title.trim().replace(/\s+/g, ' ')
    const fileError = validateFile(selectedFile)

    if (selectedFile && totalSize + selectedFile.size > STORAGE_LIMIT) {
      setFormError(
        `This upload would exceed the ${formatFileSize(STORAGE_LIMIT)} storage limit. Free up space or ask your administrator to upgrade the plan.`,
      )
      return
    }

    if (!title) {
      setFormError('Enter a document title.')
      return
    }

    if (title.length > 160) {
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

    setUploading(true)
    setFormError('')

    const objectPath = `documents/${Date.now()}-${crypto.randomUUID()}-${safeFileName(
      selectedFile.name,
    )}`

    const { error: storageError } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, selectedFile, {
        cacheControl: '3600',
        contentType: selectedFile.type,
        upsert: false,
      })

    if (storageError) {
      setFormError(storageError.message)
      setUploading(false)
      return
    }

    const payload = {
      title,
      category: form.category,
      storage_path: objectPath,
      original_file_name: selectedFile.name,
      mime_type: selectedFile.type,
      file_size: selectedFile.size,
      uploaded_by: currentUser.id,
      uploaded_by_name: actorName,
    }

    const { data, error: metadataError } = await supabase
      .from('documents')
      .insert(payload)
      .select(
        'id, title, category, storage_path, original_file_name, mime_type, file_size, uploaded_by, uploaded_by_name, created_at',
      )
      .single()

    if (metadataError) {
      const { error: cleanupError } = await supabase.storage
        .from(BUCKET)
        .remove([objectPath])

      if (cleanupError) {
        console.warn('Failed upload could not be cleaned up:', cleanupError.message)
      }

      setFormError(metadataError.message)
      setUploading(false)
      return
    }

    const { error: activityError } = await supabase
      .from('activity_log')
      .insert({
        user_id: currentUser.id,
        action: 'Document Uploaded',
        target: `${data.title} — ${data.original_file_name} (by ${actorName})`,
      })

    if (activityError) {
      console.warn(
        'Document uploaded, but activity logging failed:',
        activityError.message,
      )
    }

    setDocuments((current) => [data, ...current])
    setShowUpload(false)
    setForm(EMPTY_FORM)
    setSelectedFile(null)
    setUploading(false)
    setNotice(`“${data.title}” was uploaded successfully.`)
  }

  async function downloadDocument(document) {
    setDownloadingId(document.id)
    setPageError('')
    setNotice('')

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .download(document.storage_path)

    if (error) {
      setPageError(`Download failed: ${error.message}`)
      setDownloadingId(null)
      return
    }

    const downloadUrl = URL.createObjectURL(data)
    const link = window.document.createElement('a')
    link.href = downloadUrl
    link.download = document.original_file_name
    window.document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0)
    setDownloadingId(null)
  }

  function requestDeleteDocument(document) {
    if (!canDeleteDocuments) return
    setPendingDelete(document)
  }

  async function deleteDocument(document) {
    if (!canDeleteDocuments || !document || !currentUser?.id) {
      setPendingDelete(null)
      setPageError('Only an Admin or Secretary can delete documents.')
      return
    }

    setPendingDelete(null)
    setDeletingId(document.id)
    setPageError('')
    setNotice('')

    // Remove the actual file from Storage first — that's what frees up
    // space against the 1 GB limit. The metadata row alone takes up
    // negligible space, so removing only that wouldn't help.
    const { error: storageError } = await supabase.storage
      .from(BUCKET)
      .remove([document.storage_path])

    if (storageError) {
      setPageError(`Could not delete file: ${storageError.message}`)
      setDeletingId(null)
      return
    }

    const { error: metadataError } = await supabase
      .from('documents')
      .delete()
      .eq('id', document.id)

    if (metadataError) {
      setPageError(
        `The file was removed, but its record could not be deleted: ${metadataError.message}`,
      )
      setDeletingId(null)
      return
    }

    if (currentUser?.id) {
      const { error: activityError } = await supabase
        .from('activity_log')
        .insert({
          user_id: currentUser.id,
          action: 'Document Deleted',
          target: `${document.title} — ${document.original_file_name} (by ${actorName})`,
        })

      if (activityError) {
        console.warn(
          'Document deleted, but activity logging failed:',
          activityError.message,
        )
      }
    }

    setDocuments((current) => current.filter((doc) => doc.id !== document.id))
    setDeletingId(null)
    setNotice(`“${document.title}” was deleted and its storage space freed.`)
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

  const totalSize = documents.reduce(
    (sum, document) => sum + (Number(document.file_size) || 0),
    0,
  )
  const categoryCount = new Set(documents.map((document) => document.category)).size
  const storageUsedRatio = totalSize / STORAGE_LIMIT
  const storageIsFull = totalSize >= STORAGE_LIMIT
  const storageIsNearlyFull = storageUsedRatio >= STORAGE_WARNING_THRESHOLD

  return (
    <div className="doc-library">
      <div className="doc-header">
        <div>
          <p className="doc-eyebrow">Secretary workspace</p>
          <h1>Document Library</h1>
          <p>Store and download official HOA documents securely.</p>
        </div>

        <div className="doc-header-actions">
          <button
            type="button"
            className="doc-refresh-button"
            onClick={() => loadDocuments(true)}
            disabled={refreshing}
          >
            <RefreshCw size={17} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="doc-summary">
        <div className="doc-summary-item">
          <span>Total documents</span>
          <strong>{loading ? '—' : documents.length}</strong>
        </div>
        <div className="doc-summary-item">
          <span>Storage used</span>
          <strong>
            {loading
              ? '—'
              : `${formatFileSize(totalSize)} of ${formatFileSize(STORAGE_LIMIT)} (${Math.round(storageUsedRatio * 100)}%)`}
          </strong>
        </div>
        <div className="doc-summary-item">
          <span>Categories used</span>
          <strong>{loading ? '—' : categoryCount}</strong>
        </div>
      </div>

      {!loading && storageIsFull && (
        <p className="doc-storage-alert doc-storage-alert-full">
          <AlertCircle size={16} />
          Storage is full. Delete some documents to free up space before uploading more.
        </p>
      )}
      {!loading && !storageIsFull && storageIsNearlyFull && (
        <p className="doc-storage-alert doc-storage-alert-warning">
          <AlertCircle size={16} />
          Storage is {Math.round(storageUsedRatio * 100)}% full. Consider removing unneeded files soon.
        </p>
      )}

      <div className="doc-toolbar">
        <input
          type="search"
          placeholder="Search by title, file name, category, or uploader..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="doc-search"
          aria-label="Search documents"
        />

        <select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className="doc-filter"
          aria-label="Filter documents by category"
        >
          <option value="All">All Categories</option>
          {CATEGORIES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="doc-upload-button"
          onClick={openUploadForm}
          disabled={!canUploadDocuments || storageIsFull}
          title={storageIsFull ? 'Storage is full — delete files to free up space' : undefined}
        >
          <Plus size={18} />
          Upload Document
        </button>
      </div>

      <div className="doc-result-row">
        <span>
          Showing {filteredDocuments.length} of {documents.length} documents
        </span>
      </div>

      {pageError && <p className="doc-message doc-error">{pageError}</p>}
      {notice && <p className="doc-message doc-success">{notice}</p>}

      <div className="doc-list glass-card" aria-live="polite">
        {loading ? (
          <p className="doc-empty">Loading documents...</p>
        ) : filteredDocuments.length === 0 ? (
          <p className="doc-empty">
            {documents.length === 0
              ? 'No documents have been uploaded yet.'
              : 'No documents match your filters.'}
          </p>
        ) : (
          filteredDocuments.map((document) => (
            <article key={document.id} className="doc-row">
              <div className="doc-icon">
                <FileText size={21} />
              </div>
              <div className="doc-info">
                <p className="doc-name">{document.title}</p>
                <p className="doc-file-name">{document.original_file_name}</p>
                <p className="doc-meta">
                  <span className="doc-category">{document.category}</span>
                  <span>{formatFileSize(document.file_size)}</span>
                  <span>{dateTime.format(new Date(document.created_at))}</span>
                  <span>Uploaded by {document.uploaded_by_name}</span>
                </p>
              </div>

              <div className="doc-actions">
                <button
                  type="button"
                  className="doc-download-button"
                  onClick={() => downloadDocument(document)}
                  disabled={downloadingId === document.id}
                  aria-label={`Download ${document.title}`}
                >
                  <Download size={17} />
                  {downloadingId === document.id ? 'Downloading...' : 'Download'}
                </button>

                {canDeleteDocuments && (
                  <button
                    type="button"
                    className="doc-delete-button"
                    onClick={() => requestDeleteDocument(document)}
                    disabled={deletingId === document.id}
                    aria-label={`Delete ${document.title}`}
                    title="Delete this document"
                  >
                    <Trash2 size={17} />
                  </button>
                )}
              </div>
            </article>
          ))
        )}
      </div>

      <ActionDialog
        open={!!pendingDelete}
        title="Delete Document?"
        message={
          pendingDelete
            ? `Delete "${pendingDelete.title}" (${pendingDelete.original_file_name})? This cannot be undone and will free up ${formatFileSize(pendingDelete.file_size)} of storage.`
            : ''
        }
        confirmLabel="Delete"
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
                <select
                  name="category"
                  value={form.category}
                  onChange={updateForm}
                  disabled={uploading}
                >
                  {CATEGORIES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
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
