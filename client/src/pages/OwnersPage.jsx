import React from 'react'
import './OwnersPage.css'

export default function OwnersPage() {
  const owners = [
    { id: 1, name: 'John Doe', property: 'Block A, Lot 1', email: 'john@email.com', balance: '₱2,500' },
    { id: 2, name: 'Maria Santos', property: 'Block A, Lot 2', email: 'maria@email.com', balance: '₱0' },
    { id: 3, name: 'Carlos Reyes', property: 'Block B, Lot 5', email: 'carlos@email.com', balance: '₱8,000' },
  ]

  return (
    <div className="page">
      <div className="page-header glass-card">
        <div>
          <h2>Homeowners Management</h2>
          <p>Manage homeowner records and assignments</p>
        </div>
        <button className="btn btn-primary">+ Add Homeowner</button>
      </div>

      <div className="page-content glass-card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Property</th>
              <th>Email</th>
              <th>Balance</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {owners.map((owner) => (
              <tr key={owner.id}>
                <td><strong>{owner.name}</strong></td>
                <td>{owner.property}</td>
                <td>{owner.email}</td>
                <td className="balance">{owner.balance}</td>
                <td>
                  <button className="btn btn-secondary">View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
