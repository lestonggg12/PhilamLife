import React from 'react'
import { AlertCircle, CheckCircle, Clock, Eye, DollarSign, Send, ChevronDown } from './Icons'
import './BlockPayablesSection.css'

const STATUS_META = {
  paid: { label: 'PAID', icon: CheckCircle },
  overdue: { label: 'OVERDUE', icon: AlertCircle },
  pending: { label: 'PENDING', icon: Clock },
}

export default function BlockPayablesSection({
  block,
  homeowners,
  canRecordPayment,
  isExpanded,
  onToggle,
  onViewLedger,
  onPayDues,
}) {
  return (
    <section className="block-payables-section">
      <header className="block-section-header">
        <div className="block-title-row">
          <div className="block-title">
            <span className="block-icon">🏘️</span>
            <h3>{block.name}</h3>
          </div>

          <button
            type="button"
            className="view-block-btn"
            onClick={onToggle}
            aria-expanded={isExpanded}
          >
            <span>{isExpanded ? 'Hide' : 'View'} {block.name}</span>
            <ChevronDown size={16} className={isExpanded ? 'rotated' : ''} />
          </button>
        </div>

        <div className="block-summary-strip">
          <div className="summary-chip">
            <span className="chip-label">Units</span>
            <span className="chip-value">{block.totalUnits}</span>
          </div>
          <div className="summary-chip">
            <span className="chip-label">Paid</span>
            <span className="chip-value paid">{block.paidAccounts}</span>
          </div>
          <div className="summary-chip">
            <span className="chip-label">Unpaid</span>
            <span className="chip-value unpaid">{block.unpaidAccounts}</span>
          </div>
          <div className="summary-chip wide">
            <span className="chip-label">Collection Rate</span>
            <span className="chip-value">{block.collectionRate}%</span>
          </div>
          <div className="summary-chip wide outstanding">
            <span className="chip-label">Outstanding</span>
            <span className="chip-value">
              ₱{block.totalOutstanding.toLocaleString()}
            </span>
          </div>
        </div>
      </header>

      {isExpanded && (
        homeowners.length === 0 ? (
          <p className="block-empty-state">No homeowners recorded in this block.</p>
        ) : (
          <ul className="homeowner-list">
            {homeowners.map((homeowner) => {
              const meta = STATUS_META[homeowner.status] || {}
              const StatusIcon = meta.icon

              return (
                <li key={homeowner.id} className="homeowner-row">
                  <div className="homeowner-identity">
                    <span className="avatar" aria-hidden="true">
                      {homeowner.avatar}
                    </span>
                    <div className="identity-text">
                      <span className="homeowner-name">{homeowner.name}</span>
                      <span className="homeowner-lot">{homeowner.lot}</span>
                    </div>
                    <span className={`status-pill ${homeowner.status}`}>
                      {StatusIcon && <StatusIcon size={16} />}
                      {meta.label || homeowner.status}
                    </span>
                  </div>

                  <div className="homeowner-details">
                    <div className="detail-item">
                      <span className="detail-label">Last Payment</span>
                      <span className="detail-value">
                        {homeowner.lastPayment || '—'}
                      </span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Amount Due</span>
                      <span
                        className={`detail-value ${
                          homeowner.amountDue > 0 ? 'amount-due' : 'amount-paid'
                        }`}
                      >
                        ₱{homeowner.amountDue.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div className="homeowner-actions">
                    <button
                      type="button"
                      className="row-action-btn view"
                      onClick={() => onViewLedger(homeowner)}
                    >
                      <Eye size={18} />
                      <span>View Ledger</span>
                    </button>

                    {canRecordPayment && homeowner.amountDue > 0 && (
                      <button
                        type="button"
                        className="row-action-btn pay"
                        onClick={() => onPayDues(homeowner)}
                      >
                        <DollarSign size={18} />
                        <span>Pay Dues</span>
                      </button>
                    )}

                    <button type="button" className="row-action-btn reminder">
                      <Send size={18} />
                      <span>Remind</span>
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )
      )}
    </section>
  )
}