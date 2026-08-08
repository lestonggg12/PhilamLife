import React, { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle, Clock, Eye, Search, Send, X } from './Icons'
import './BlockPayablesSection.css'

const STATUS_META = {
  paid: { label: 'PAID', icon: CheckCircle },
  overdue: { label: 'OVERDUE', icon: AlertCircle },
  pending: { label: 'PENDING', icon: Clock },
}

export default function BlockPayablesSection({
  block,
  homeowners,
  isExpanded,
  onToggle,
  onViewLedger,
}) {
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    if (!isExpanded) setSearchTerm('')
  }, [isExpanded])

  const visibleHomeowners = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()

    const filtered = query
      ? homeowners.filter((homeowner) =>
          homeowner.name.toLowerCase().includes(query) ||
          homeowner.lot.toLowerCase().includes(query),
        )
      : homeowners

    return [...filtered].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    )
  }, [homeowners, searchTerm])

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
            <span>View {block.name}</span>
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
        <div
          className="block-modal-overlay"
          role="dialog"
          aria-modal="true"
          onClick={onToggle}
        >
          <div
            className="block-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="block-modal-header">
              <div className="block-title">
                <span className="block-icon">🏘️</span>
                <h3>{block.name}</h3>
              </div>
              <button
                type="button"
                className="block-modal-close"
                onClick={onToggle}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            <div className="block-modal-body">
              <div className="block-search-bar">
                <Search size={16} className="block-search-icon" />
                <input
                  type="text"
                  className="block-search-input"
                  placeholder={`Search ${block.name} homeowners...`}
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
                {searchTerm && (
                  <button
                    type="button"
                    className="block-search-clear"
                    onClick={() => setSearchTerm('')}
                    aria-label="Clear search"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {homeowners.length === 0 ? (
                <p className="block-empty-state">
                  No homeowners recorded in this block.
                </p>
              ) : visibleHomeowners.length === 0 ? (
                <p className="block-empty-state">
                  No homeowners match "{searchTerm}".
                </p>
              ) : (
                <ul className="homeowner-list">
                  {visibleHomeowners.map((homeowner) => {
                    const meta = STATUS_META[homeowner.status] || {}
                    const StatusIcon = meta.icon

                    return (
                      <li key={homeowner.id} className="homeowner-row">
                        <div className="homeowner-identity">
                          <span className="avatar" aria-hidden="true">
                            {homeowner.avatar}
                          </span>
                          <div className="identity-text">
                            <span className="homeowner-name">
                              {homeowner.name}
                            </span>
                            <span className="homeowner-lot">
                              {homeowner.lot}
                            </span>
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
                                homeowner.amountDue > 0
                                  ? 'amount-due'
                                  : 'amount-paid'
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

                          <button type="button" className="row-action-btn reminder">
                            <Send size={18} />
                            <span>Remind</span>
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}