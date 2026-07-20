import React, { useState } from 'react'
import './DocumentLibraryPage.css'
import { FileText } from '../components/Icons'

export default function DocumentLibraryPage() {
  const [search, setSearch] = useState('')

  const documents = [
    { id: 1, name: 'Board Meeting Minutes - March 2026', category: 'Minutes', date: '2026-03-15', size: '245 KB' },
    { id: 2, name: 'Annual Financial Report 2025', category: 'Reports', date: '2026-01-20', size: '1.2 MB' },
    { id: 3, name: 'HOA Bylaws (Amended)', category: 'Legal', date: '2025-11-02', size: '890 KB' },
    { id: 4, name: 'Community Announcement - Water Maintenance', category: 'Announcements', date: '2026-07-10', size: '120 KB' },
    { id: 5, name: 'Homeowner Survey Results', category: 'Reports', date: '2026-07-05', size: '340 KB' },
  ]

  const filtered = documents.filter((doc) =>
    doc.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="doc-library">
      <div className="doc-header">
        <h1>Document Library</h1>
        <p>Access and manage all HOA documents.</p>
      </div>

      <div className="doc-toolbar">
        <input
          type="text"
          placeholder="Search documents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="doc-search"
        />
        <button className="btn btn-primary">Upload Document</button>
      </div>

      <div className="doc-list glass-card">
        {filtered.length === 0 ? (
          <p className="doc-empty">No documents found.</p>
        ) : (
          filtered.map((doc) => (
            <div key={doc.id} className="doc-row">
              <div className="doc-icon"><FileText size={20} /></div>
              <div className="doc-info">
                <p className="doc-name">{doc.name}</p>
                <p className="doc-meta">{doc.category} • {doc.date} • {doc.size}</p>
              </div>
              <button className="btn btn-secondary">Download</button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}