import React from 'react'
import { AlertCircle, CheckCircle, Clock, Eye, DollarSign, Send } from './Icons'
import './ExpandedBlockView.css'

export default function ExpandedBlockView({
  block,
  homeowners,
  onViewLedger,
  onPayDues,
}) {
  const getStatusIcon = (status) => {
    switch (status) {
      case 'paid':
        return <CheckCircle size={16} className="status-icon paid" />
      case 'overdue':
        return <AlertCircle size={16} className="status-icon overdue" />
      case 'pending':
        return <Clock size={16} className="status-icon pending" />
      default:
        return null
    }
  }

  const getStatusLabel = (status) => {
    const labels = {
      paid: { text: 'PAID', class: 'paid' },
      overdue: { text: 'OVERDUE', class: 'overdue' },
      pending: { text: 'PENDING', class: 'pending' },
    }
    return labels[status] || { text: status, class: '' }
  }

  return (
    <div className="expanded-block-view">
      <div className="expanded-header">
        <h4>Homeowners in {block.name}</h4>
        <span className="lot-count">{homeowners.length} lots</span>
      </div>

      <div className="homeowners-table-wrapper">
        <table className="homeowners-table">
          <thead>
            <tr>
              <th>Lot #</th>
              <th>Homeowner Name</th>
              <th>Status</th>
              <th>Last Payment</th>
              <th>Amount Due</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {homeowners.map((homeowner) => {
              const statusLabel = getStatusLabel(homeowner.status)
              return (
                <tr key={homeowner.id} className={`status-${homeowner.status}`}>
                  <td className="lot-cell">
                    <span className="lot-badge">{homeowner.lot}</span>
                  </td>
                  <td className="name-cell">
                    <div className="homeowner-info">
                      <span className="avatar">{homeowner.avatar}</span>
                      <div className="name-details">
                        <span className="name">{homeowner.name}</span>
                        <span className="email">{homeowner.email}</span>
                      </div>
                    </div>
                  </td>
                  <td className="status-cell">
                    <span className={`status-badge ${statusLabel.class}`}>
                      {getStatusIcon(homeowner.status)}
                      {statusLabel.text}
                      {homeowner.daysOverdue > 0 && (
                        <span className="days-overdue">{homeowner.daysOverdue}d</span>
                      )}
                    </span>
                  </td>
                  <td className="date-cell">
                    {homeowner.lastPayment || '—'}
                  </td>
                  <td className="amount-cell">
                    <span className={homeowner.amountDue > 0 ? 'amount-due' : 'amount-paid'}>
                      ₱{homeowner.amountDue.toLocaleString()}
                    </span>
                  </td>
                  <td className="actions-cell">
                    <div className="action-buttons">
                      <button
                        className="action-btn view-btn"
                        onClick={() => onViewLedger(homeowner)}
                        title="View Ledger"
                      >
                        <Eye size={16} />
                      </button>
                      {homeowner.amountDue > 0 && (
                        <button
                          className="action-btn pay-btn"
                          onClick={() => onPayDues(homeowner)}
                          title="Pay Dues"
                        >
                          <DollarSign size={16} />
                        </button>
                      )}
                      <button
                        className="action-btn reminder-btn"
                        title="Send Reminder"
                      >
                        <Send size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
