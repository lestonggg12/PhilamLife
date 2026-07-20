import React from 'react'
import { ChevronDown } from './Icons'
import './BlockOverviewCard.css'

export default function BlockOverviewCard({ block, isExpanded, onExpand }) {
  const uncollectedRate = 100 - block.collectionRate

  return (
    <div className={`block-overview-card ${isExpanded ? 'expanded' : ''}`}>
      <div className="card-header" onClick={onExpand}>
        <div className="block-title">
          <h3>{block.name}</h3>
          <span className="block-icon">🏘️</span>
        </div>
        <ChevronDown
          size={24}
          className={`expand-icon ${isExpanded ? 'rotated' : ''}`}
        />
      </div>

      <div className="card-content">
        <div className="summary-grid">
          <div className="summary-item">
            <span className="label">Total Units</span>
            <span className="value">{block.totalUnits}</span>
          </div>
          <div className="summary-item">
            <span className="label">Paid</span>
            <span className="value paid">{block.paidAccounts}</span>
          </div>
          <div className="summary-item">
            <span className="label">Unpaid</span>
            <span className="value unpaid">{block.unpaidAccounts}</span>
          </div>
        </div>

        <div className="progress-section">
          <div className="progress-header">
            <span className="label">Collection Rate</span>
            <span className="percentage">{block.collectionRate}%</span>
          </div>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${block.collectionRate}%` }}
            ></div>
            <div
              className="progress-uncollected"
              style={{ width: `${uncollectedRate}%` }}
            ></div>
          </div>
        </div>

        <div className="outstanding-section">
          <span className="label">Total Outstanding</span>
          <span className="amount">₱{block.totalOutstanding.toLocaleString()}</span>
        </div>
      </div>

      {!isExpanded && (
        <div className="card-footer">
          <button className="expand-button" onClick={onExpand}>
            Tap to Expand Lots
          </button>
        </div>
      )}
    </div>
  )
}
