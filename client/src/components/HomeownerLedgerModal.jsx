import React from 'react'
import { X, Phone, Mail, DollarSign, AlertCircle } from './Icons'
import './HomeownerLedgerModal.css'

export default function HomeownerLedgerModal({
  homeowner,
  ledger,
  onClose,
  onPayClick,
}) {
  const daysOverdueText =
    homeowner.daysOverdue > 0 ? `${homeowner.daysOverdue} days overdue` : 'Current'

  return (
    <div className="ledger-modal-overlay" onClick={onClose}>
      <div className="ledger-modal" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}>
          <X size={24} />
        </button>

        {/* Header */}
        <div className="ledger-header">
          <div className="homeowner-header-info">
            <div className="avatar-large">{homeowner.avatar}</div>
            <div className="homeowner-details">
              <h2>{homeowner.name}</h2>
              <p className="lot-number">{homeowner.lot}</p>
              <p className="address">{homeowner.address}</p>
            </div>
          </div>

          <div className="header-contact">
            <div className="contact-item">
              <Phone size={16} />
              <span>{homeowner.phone}</span>
            </div>
            <div className="contact-item">
              <Mail size={16} />
              <span>{homeowner.email}</span>
            </div>
          </div>
        </div>

        {/* Status Banner */}
        {homeowner.daysOverdue > 0 && (
          <div className="status-banner overdue">
            <AlertCircle size={18} />
            <div>
              <strong>Account Overdue</strong>
              <p>
                ₱{homeowner.amountDue.toLocaleString()} due • {daysOverdueText}
              </p>
            </div>
          </div>
        )}

        {homeowner.status === 'paid' && (
          <div className="status-banner paid">
            <div>
              <strong>✓ Account Current</strong>
              <p>Last payment: {homeowner.lastPayment}</p>
            </div>
          </div>
        )}

        {/* Ledger Table */}
        <div className="ledger-section">
          <h3>Transaction History</h3>
          <div className="ledger-table-wrapper">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((item, idx) => (
                  <tr key={idx} className={item.type.toLowerCase()}>
                    <td className="date">{item.date}</td>
                    <td className="type-badge">
                      <span className={item.type.toLowerCase()}>
                        {item.type}
                      </span>
                    </td>
                    <td className="description">{item.description}</td>
                    <td className="amount">
                      <span className={item.amount < 0 ? 'payment' : 'charge'}>
                        {item.amount < 0 ? '-' : '+'}₱
                        {Math.abs(item.amount).toLocaleString()}
                      </span>
                    </td>
                    <td className="balance">
                      <strong>₱{item.balance.toLocaleString()}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="ledger-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          {homeowner.amountDue > 0 && (
            <button className="btn btn-primary" onClick={onPayClick}>
              <DollarSign size={16} /> Pay Now (₱{homeowner.amountDue.toLocaleString()})
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
