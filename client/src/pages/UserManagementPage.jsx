import React, { useState } from 'react'
import './UserManagementPage.css'
import { Users, Lock, Trash2, UserPlus } from '../components/Icons'

export default function UserManagementPage() {
  const [users, setUsers] = useState([
    { id: 1, name: 'Mario Lim', email: 'admin@philamvillage.hoa', role: 'Admin', status: 'Active' },
    { id: 2, name: 'Angela Santos', email: 'secretary@philamvillage.hoa', role: 'Secretary', status: 'Active' },
    { id: 3, name: 'John Reyes', email: 'treasurer@philamvillage.hoa', role: 'Treasurer', status: 'Active' },
  ])

  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', role: 'Secretary' })
  const [confirmDelete, setConfirmDelete] = useState(null)

  const filtered = users.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  )

  const handleAddUser = (e) => {
    e.preventDefault()
    if (!form.name || !form.email) return
    setUsers([...users, { id: Date.now(), ...form, status: 'Active' }])
    setForm({ name: '', email: '', role: 'Secretary' })
    setShowForm(false)
  }

  const handleRoleChange = (id, newRole) => {
    setUsers(users.map((u) => (u.id === id ? { ...u, role: newRole } : u)))
  }

  const handleResetPassword = (id) => {
    alert(`Password reset link sent for user ID ${id}. (mock action)`)
  }

  const handleDelete = (id) => {
    setUsers(users.filter((u) => u.id !== id))
    setConfirmDelete(null)
  }

  return (
    <div className="um-page">
      <div className="um-header">
        <div>
          <h1>User Management</h1>
          <p>Manage Admin, Secretary, and Treasurer accounts.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          <UserPlus size={16} /> {showForm ? 'Cancel' : 'Add User'}
        </button>
      </div>

      {showForm && (
        <form className="um-form glass-card" onSubmit={handleAddUser}>
          <input
            placeholder="Full name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <input
            type="email"
            placeholder="Email address"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="Admin">Admin</option>
            <option value="Secretary">Secretary</option>
            <option value="Treasurer">Treasurer</option>
          </select>
          <button type="submit" className="btn btn-primary">Create Account</button>
        </form>
      )}

      <input
        type="text"
        placeholder="Search by name or email..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="um-search"
      />

      <div className="um-table-wrap glass-card">
        <table className="um-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan="5" className="um-empty">No users found.</td>
              </tr>
            ) : (
              filtered.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="um-user-cell">
                      <div className="um-avatar">{u.name.charAt(0)}</div>
                      <strong>{u.name}</strong>
                    </div>
                  </td>
                  <td>{u.email}</td>
                  <td>
                    <select
                      value={u.role}
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      className="um-role-select"
                    >
                      <option value="Admin">Admin</option>
                      <option value="Secretary">Secretary</option>
                      <option value="Treasurer">Treasurer</option>
                    </select>
                  </td>
                  <td>
                    <span className="um-badge um-badge-active">{u.status}</span>
                  </td>
                  <td>
                    <div className="um-actions">
                      <button
                        className="um-icon-btn"
                        title="Reset Password"
                        onClick={() => handleResetPassword(u.id)}
                      >
                        <Lock size={16} />
                      </button>
                      <button
                        className="um-icon-btn um-icon-btn-danger"
                        title="Remove User"
                        onClick={() => setConfirmDelete(u.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {confirmDelete && (
        <div className="um-modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="um-modal glass-card" onClick={(e) => e.stopPropagation()}>
            <h3>Remove this user?</h3>
            <p>This will revoke their access immediately. This action cannot be undone.</p>
            <div className="um-modal-actions">
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => handleDelete(confirmDelete)}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}