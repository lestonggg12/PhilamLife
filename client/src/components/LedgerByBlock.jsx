import React, { useState } from 'react'
import './LedgerByBlock.css'
import { ChevronRight } from '../components/Icons'

function OwnerPaymentRow({ owner, blockLot }) {
  const [showHistory, setShowHistory] = useState(false)

  return (
    <div className="owner-payment-row">
      <div className="owner-header">
        <div className="owner-info">
          <h4>{owner.name}</h4>
          <p className="owner-property">{blockLot}</p>
        </div>
        <div className="owner-payable">
          <span className="payable-label">Payable</span>
          <span className={`payable-amount ${owner.status.toLowerCase()}`}>
            ₱{owner.payable.toLocaleString()}
          </span>
        </div>
        <button
          className={`history-toggle ${showHistory ? 'open' : ''}`}
          onClick={() => setShowHistory(!showHistory)}
          title="Toggle payment history"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {showHistory && (
        <div className="payment-history">
          <div className="history-header">Payment History</div>
          <div className="history-list">
            {owner.paymentHistory && owner.paymentHistory.length > 0 ? (
              owner.paymentHistory.map((payment, i) => (
                <div key={i} className={`history-item status-${payment.status.toLowerCase()}`}>
                  <div className="history-date">{payment.date}</div>
                  <div className="history-amount">₱{payment.amount.toLocaleString()}</div>
                  <div className={`history-status ${payment.status.toLowerCase()}`}>
                    {payment.status}
                  </div>
                  <div className="history-method">{payment.method}</div>
                </div>
              ))
            ) : (
              <div className="history-empty">No payment history</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function LedgerByBlock() {
  const [expandedBlocks, setExpandedBlocks] = useState({})

  const ledgerData = [
    {
      block: 'Block A',
      owners: [
        {
          name: 'John Doe',
          lot: 'Lot 1',
          payable: 5000,
          status: 'Pending',
          paymentHistory: [
            { date: 'Apr 2024', amount: 5000, status: 'Paid', method: 'Cash' },
            { date: 'Mar 2024', amount: 5000, status: 'Paid', method: 'Bank Transfer' },
            { date: 'Feb 2024', amount: 5000, status: 'Paid', method: 'Check' },
          ],
        },
        {
          name: 'Maria Santos',
          lot: 'Lot 2',
          payable: 0,
          status: 'Paid',
          paymentHistory: [
            { date: 'Apr 2024', amount: 5000, status: 'Paid', method: 'Bank Transfer' },
            { date: 'Mar 2024', amount: 5000, status: 'Paid', method: 'Bank Transfer' },
          ],
        },
        {
          name: 'Carlos Reyes',
          lot: 'Lot 5',
          payable: 15000,
          status: 'Overdue',
          paymentHistory: [
            { date: 'Dec 2023', amount: 5000, status: 'Paid', method: 'Cash' },
          ],
        },
      ],
    },
    {
      block: 'Block B',
      owners: [
        {
          name: 'Angela Garcia',
          lot: 'Lot 8',
          payable: 3500,
          status: 'Pending',
          paymentHistory: [
            { date: 'Mar 2024', amount: 5000, status: 'Paid', method: 'Bank Transfer' },
          ],
        },
        {
          name: 'Robert Santos',
          lot: 'Lot 12',
          payable: 0,
          status: 'Paid',
          paymentHistory: [
            { date: 'Apr 2024', amount: 5000, status: 'Paid', method: 'Bank Transfer' },
            { date: 'Mar 2024', amount: 5000, status: 'Paid', method: 'Bank Transfer' },
            { date: 'Feb 2024', amount: 5000, status: 'Paid', method: 'Cash' },
          ],
        },
      ],
    },
    {
      block: 'Block C',
      owners: [
        {
          name: 'Jessica Cruz',
          lot: 'Lot 3',
          payable: 10000,
          status: 'Overdue',
          paymentHistory: [
            { date: 'Jan 2024', amount: 5000, status: 'Paid', method: 'Check' },
          ],
        },
      ],
    },
  ]

  const toggleBlock = (blockName) => {
    setExpandedBlocks((prev) => ({
      ...prev,
      [blockName]: !prev[blockName],
    }))
  }

  const getTotalStats = () => {
    let totalPayable = 0
    let totalOwners = 0
    let paidCount = 0
    let overdueCount = 0

    ledgerData.forEach((block) => {
      block.owners.forEach((owner) => {
        totalPayable += owner.payable
        totalOwners++
        if (owner.status === 'Paid') paidCount++
        if (owner.status === 'Overdue') overdueCount++
      })
    })

    return { totalPayable, totalOwners, paidCount, overdueCount }
  }

  const stats = getTotalStats()

  return (
    <div className="ledger-by-block">
      <div className="ledger-header">
        <h3>Ledger by Block</h3>
        <p>Expandable block structure with owner payment details</p>
      </div>

      <div className="ledger-stats">
        <div className="stat-box">
          <span className="stat-label">Total Payable</span>
          <span className="stat-value">₱{stats.totalPayable.toLocaleString()}</span>
        </div>
        <div className="stat-box">
          <span className="stat-label">Total Owners</span>
          <span className="stat-value">{stats.totalOwners}</span>
        </div>
        <div className="stat-box status-paid">
          <span className="stat-label">Paid</span>
          <span className="stat-value">{stats.paidCount}</span>
        </div>
        <div className="stat-box status-overdue">
          <span className="stat-label">Overdue</span>
          <span className="stat-value">{stats.overdueCount}</span>
        </div>
      </div>

      <div className="ledger-blocks">
        {ledgerData.map((block, index) => (
          <div key={index} className="block-section">
            <button
              className={`block-header ${expandedBlocks[block.block] ? 'expanded' : ''}`}
              onClick={() => toggleBlock(block.block)}
            >
              <div className="block-title">
                <ChevronRight size={20} className="block-chevron" />
                <span className="block-name">{block.block}</span>
                <span className="block-count">({block.owners.length} owners)</span>
              </div>
              <div className="block-stats">
                <span className="block-total">
                  ₱{block.owners.reduce((sum, o) => sum + o.payable, 0).toLocaleString()}
                </span>
              </div>
            </button>

            {expandedBlocks[block.block] && (
              <div className="block-owners">
                {block.owners.map((owner, ownerIndex) => (
                  <OwnerPaymentRow
                    key={ownerIndex}
                    owner={owner}
                    blockLot={`${block.block}, ${owner.lot}`}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
