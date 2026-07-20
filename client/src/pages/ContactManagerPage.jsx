import React, { useState } from 'react'
import './ContactManagerPage.css'

export default function ContactManagerPage() {
  const [search, setSearch] = useState('')

  const contacts = [
    { id: 1, name: 'John Doe', property: 'Block A, Lot 5', phone: '0917-123-4567', email: 'john.doe@email.com' },
    { id: 2, name: 'Maria Santos', property: 'Block B, Lot 12', phone: '0918-234-5678', email: 'maria.santos@email.com' },
    { id: 3, name: 'Carlos Reyes', property: 'Block C, Lot 8', phone: '0919-345-6789', email: 'carlos.reyes@email.com' },
    { id: 4, name: 'Ana Cruz', property: 'Block A, Lot 2', phone: '0920-456-7890', email: 'ana.cruz@email.com' },
  ]

  const filtered = contacts.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.property.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="contact-page">
      <div className="contact-header">
        <h1>Contact Manager</h1>
        <p>Homeowner directory and contact information.</p>
      </div>

      <input
        type="text"
        placeholder="Search by name or property..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="contact-search"
      />

      <div className="contact-grid">
        {filtered.map((c) => (
          <div key={c.id} className="contact-card glass-card">
            <div className="contact-avatar">{c.name.charAt(0)}</div>
            <p className="contact-name">{c.name}</p>
            <p className="contact-property">{c.property}</p>
            <p className="contact-detail">📞 {c.phone}</p>
            <p className="contact-detail">✉️ {c.email}</p>
          </div>
        ))}
      </div>
    </div>
  )
}