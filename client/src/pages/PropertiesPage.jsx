import React, { useState } from 'react'
import './PropertiesPage.css'
import { ChevronRight } from '../components/Icons'

export default function PropertiesPage() {
  const [properties] = useState([
    { id: 1, block: 'A', lot: 1, owner: 'John Doe', status: 'Active', dues: '₱5,000' },
    { id: 2, block: 'A', lot: 2, owner: 'Maria Santos', status: 'Active', dues: '₱3,500' },
    { id: 3, block: 'A', lot: 3, owner: 'Unassigned', status: 'Vacant', dues: '₱0' },
    { id: 4, block: 'B', lot: 1, owner: 'Carlos Reyes', status: 'Active', dues: '₱4,500' },
    { id: 5, block: 'B', lot: 5, owner: 'Unassigned', status: 'Vacant', dues: '₱0' },
    { id: 6, block: 'C', lot: 1, owner: 'Angela Garcia', status: 'Active', dues: '₱5,000' },
  ])

  const [expandedBlocks, setExpandedBlocks] = useState({})

  // Group properties by block
  const blockGroups = properties.reduce((acc, prop) => {
    if (!acc[prop.block]) {
      acc[prop.block] = []
    }
    acc[prop.block].push(prop)
    return acc
  }, {})

  const blocks = Object.keys(blockGroups).sort()

  const toggleBlock = (blockName) => {
    setExpandedBlocks(prev => ({
      ...prev,
      [blockName]: !prev[blockName]
    }))
  }

  const getBlockStats = (blockName) => {
    const blockProperties = blockGroups[blockName]
    const totalLots = blockProperties.length
    const activeProperties = blockProperties.filter(p => p.status === 'Active').length
    const totalDues = blockProperties.reduce((sum, p) => {
      const duesValue = parseInt(p.dues.replace(/[₱,]/g, '')) || 0
      return sum + duesValue
    }, 0)
    return { totalLots, activeProperties, totalDues }
  }

  return (
    <div className="page">
      <div className="page-header glass-card">
        <div>
          <h2>Properties Management</h2>
          <p>View properties organized by block</p>
        </div>
        <button className="btn btn-primary">+ Add Property</button>
      </div>

      <div className="properties-view">
        {blocks.map((blockName) => {
          const stats = getBlockStats(blockName)
          const isExpanded = expandedBlocks[blockName]
          
          return (
            <div key={blockName} className="block-section glass-card">
              <button 
                className={`block-header ${isExpanded ? 'expanded' : ''}`}
                onClick={() => toggleBlock(blockName)}
              >
                <div className="block-info">
                  <span className="block-name">Block {blockName}</span>
                  <span className="block-details">
                    {stats.totalLots} lots • {stats.activeProperties} active
                  </span>
                </div>
                <div className="block-dues">₱{stats.totalDues.toLocaleString()}</div>
                <ChevronRight size={20} className="chevron" />
              </button>

              {isExpanded && (
                <div className="lots-container">
                  <div className="lots-header">
                    <div className="lot-col lot-number">Lot</div>
                    <div className="lot-col lot-owner">Owner</div>
                    <div className="lot-col lot-status">Status</div>
                    <div className="lot-col lot-dues">Monthly Dues</div>
                    <div className="lot-col lot-actions">Actions</div>
                  </div>
                  
                  {blockGroups[blockName].map((prop) => (
                    <div key={prop.id} className="lot-row">
                      <div className="lot-col lot-number"><strong>{prop.lot}</strong></div>
                      <div className="lot-col lot-owner">{prop.owner}</div>
                      <div className="lot-col lot-status">
                        <span className={`badge badge-${prop.status.toLowerCase()}`}>
                          {prop.status}
                        </span>
                      </div>
                      <div className="lot-col lot-dues">{prop.dues}</div>
                      <div className="lot-col lot-actions">
                        <button className="btn-link">Edit</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
