import React, { useEffect, useMemo, useState } from 'react'
import './LedgerPage.css'
import { FileText, TrendingUp, AlertCircle } from '../components/Icons'
import { supabase } from '../lib/supabaseClient'

export default function LedgerPage({ user }) {
  const [search, setSearch] = useState('')
  const [blockFilter, setBlockFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [blocks, setBlocks] = useState([])
  const [blocksLoading, setBlocksLoading] = useState(true)
  const [showAddBlock, setShowAddBlock] = useState(false)
  const [newBlockName, setNewBlockName] = useState('')
  const [blockError, setBlockError] = useState('')
  const [savingBlock, setSavingBlock] = useState(false)

  const isAdmin = user?.role?.toLowerCase() === 'admin'

  // These ledger entries are still temporary.
  // Only the block list is connected to Supabase.
  const ledgerEntries = [
    {
      id: 1,
      name: 'John Doe',
      block: 'Block A',
      lot: 'Lot 5',
      dueAmount: 5000,
      paidAmount: 5000,
      balance: 0,
      lastPayment: '2026-07-01',
      status: 'Paid',
    },
    {
      id: 2,
      name: 'Maria Santos',
      block: 'Block B',
      lot: 'Lot 12',
      dueAmount: 5000,
      paidAmount: 3500,
      balance: 1500,
      lastPayment: '2026-06-15',
      status: 'Partial',
    },
    {
      id: 3,
      name: 'Carlos Reyes',
      block: 'Block C',
      lot: 'Lot 8',
      dueAmount: 5000,
      paidAmount: 0,
      balance: 5000,
      lastPayment: '—',
      status: 'Overdue',
    },
    {
      id: 4,
      name: 'Ana Cruz',
      block: 'Block A',
      lot: 'Lot 2',
      dueAmount: 5000,
      paidAmount: 5000,
      balance: 0,
      lastPayment: '2026-07-05',
      status: 'Paid',
    },
    {
      id: 5,
      name: 'Ramon Torres',
      block: 'Block D',
      lot: 'Lot 19',
      dueAmount: 5000,
      paidAmount: 2000,
      balance: 3000,
      lastPayment: '2026-05-28',
      status: 'Partial',
    },
    {
      id: 6,
      name: 'Liza Bautista',
      block: 'Block B',
      lot: 'Lot 3',
      dueAmount: 5000,
      paidAmount: 0,
      balance: 5000,
      lastPayment: '—',
      status: 'Overdue',
    },
    {
      id: 7,
      name: 'Nelson Garcia',
      block: 'Block E',
      lot: 'Lot 11',
      dueAmount: 5000,
      paidAmount: 5000,
      balance: 0,
      lastPayment: '2026-07-10',
      status: 'Paid',
    },
  ]

  useEffect(() => {
    const loadBlocks = async () => {
      setBlocksLoading(true)
      setBlockError('')

      const { data, error } = await supabase
        .from('blocks')
        .select('id, name')
        .order('name', { ascending: true })

      if (error) {
        setBlockError(`Could not load blocks: ${error.message}`)
      } else {
        setBlocks(data || [])
      }

      setBlocksLoading(false)
    }

    loadBlocks()
  }, [])

  const handleOpenAddBlock = () => {
    setNewBlockName('')
    setBlockError('')
    setShowAddBlock(true)
  }

  const handleCloseAddBlock = () => {
    if (savingBlock) return

    setShowAddBlock(false)
    setNewBlockName('')
    setBlockError('')
  }

  const handleAddBlock = async (event) => {
    event.preventDefault()

    const name = newBlockName.trim().replace(/\s+/g, ' ')

    if (!name) {
      setBlockError('Enter a block name.')
      return
    }

    const alreadyExists = blocks.some(
      (block) => block.name.toLowerCase() === name.toLowerCase()
    )

    if (alreadyExists) {
      setBlockError('That block already exists.')
      return
    }

    setSavingBlock(true)
    setBlockError('')

    const { data, error } = await supabase
      .from('blocks')
      .insert({ name })
      .select('id, name')
      .single()

    if (error) {
      if (error.code === '23505') {
        setBlockError('That block already exists.')
      } else {
        setBlockError(error.message)
      }

      setSavingBlock(false)
      return
    }

    setBlocks((currentBlocks) =>
      [...currentBlocks, data].sort((a, b) =>
        a.name.localeCompare(b.name)
      )
    )

    setBlockFilter(data.name)
    setNewBlockName('')
    setShowAddBlock(false)
    setSavingBlock(false)
  }

  const filteredEntries = useMemo(() => {
    const searchText = search.trim().toLowerCase()

    return ledgerEntries.filter((entry) => {
      const matchesSearch =
        entry.name.toLowerCase().includes(searchText) ||
        entry.lot.toLowerCase().includes(searchText)

      const matchesBlock =
        blockFilter === 'all' || entry.block === blockFilter

      const matchesStatus =
        statusFilter === 'all' || entry.status === statusFilter

      return matchesSearch && matchesBlock && matchesStatus
    })
  }, [search, blockFilter, statusFilter])

  const totals = useMemo(() => {
    const totalDue = ledgerEntries.reduce(
      (sum, entry) => sum + entry.dueAmount,
      0
    )

    const totalPaid = ledgerEntries.reduce(
      (sum, entry) => sum + entry.paidAmount,
      0
    )

    const totalBalance = ledgerEntries.reduce(
      (sum, entry) => sum + entry.balance,
      0
    )

    return {
      totalDue,
      totalPaid,
      totalBalance,
    }
  }, [])

  const formatCurrency = (amount) => {
    return `₱${amount.toLocaleString()}`
  }

  return (
    <div className="ledger-page">
      <div className="ledger-header-row">
        <div className="ledger-header">
          <h1>Ledger</h1>
          <p>Track homeowner dues, payments, and outstanding balances.</p>
        </div>

        {isAdmin && (
          <button
            type="button"
            className="ledger-add-block-button"
            onClick={handleOpenAddBlock}
          >
            + Add Block
          </button>
        )}
      </div>

      {showAddBlock && isAdmin && (
        <div
          className="ledger-modal-backdrop"
          role="presentation"
          onMouseDown={handleCloseAddBlock}
        >
          <form
            className="ledger-modal glass-card"
            onSubmit={handleAddBlock}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2>Add New Block</h2>
            <p>Create a block such as Block A, Block B, or Block C.</p>

            <label htmlFor="block-name">Block name</label>

            <input
              id="block-name"
              type="text"
              value={newBlockName}
              onChange={(event) => {
                setNewBlockName(event.target.value)
                setBlockError('')
              }}
              placeholder="e.g., Block F"
              maxLength={50}
              autoFocus
              disabled={savingBlock}
            />

            {blockError && (
              <p className="ledger-form-error">{blockError}</p>
            )}

            <div className="ledger-modal-actions">
              <button
                type="button"
                className="ledger-cancel-button"
                onClick={handleCloseAddBlock}
                disabled={savingBlock}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="ledger-save-button"
                disabled={savingBlock}
              >
                {savingBlock ? 'Saving...' : 'Save Block'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="ledger-summary-grid">
        <div className="ledger-summary-card glass-card">
          <div
            className="ledger-summary-icon"
            style={{
              background: 'rgba(20, 100, 160, 0.12)',
              color: '#1464a0',
            }}
          >
            <FileText size={20} />
          </div>

          <div>
            <p className="ledger-summary-label">Total Dues</p>
            <p className="ledger-summary-value">
              {formatCurrency(totals.totalDue)}
            </p>
          </div>
        </div>

        <div className="ledger-summary-card glass-card">
          <div
            className="ledger-summary-icon"
            style={{
              background: 'rgba(26, 138, 96, 0.12)',
              color: '#1a8a60',
            }}
          >
            <TrendingUp size={20} />
          </div>

          <div>
            <p className="ledger-summary-label">Total Collected</p>
            <p className="ledger-summary-value">
              {formatCurrency(totals.totalPaid)}
            </p>
          </div>
        </div>

        <div className="ledger-summary-card glass-card">
          <div
            className="ledger-summary-icon"
            style={{
              background: 'rgba(192, 57, 43, 0.12)',
              color: '#c0392b',
            }}
          >
            <AlertCircle size={20} />
          </div>

          <div>
            <p className="ledger-summary-label">
              Outstanding Balance
            </p>
            <p className="ledger-summary-value">
              {formatCurrency(totals.totalBalance)}
            </p>
          </div>
        </div>
      </div>

      <div className="ledger-toolbar">
        <input
          type="text"
          placeholder="Search by name or lot..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="ledger-search"
        />

        <select
          value={blockFilter}
          onChange={(event) => setBlockFilter(event.target.value)}
          className="ledger-select"
          disabled={blocksLoading}
        >
          <option value="all">
            {blocksLoading ? 'Loading blocks...' : 'All Blocks'}
          </option>

          {blocks.map((block) => (
            <option key={block.id} value={block.name}>
              {block.name}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="ledger-select"
        >
          <option value="all">All Statuses</option>
          <option value="Paid">Paid</option>
          <option value="Partial">Partial</option>
          <option value="Overdue">Overdue</option>
        </select>
      </div>

      {!showAddBlock && blockError && (
        <p className="ledger-load-error">{blockError}</p>
      )}

      <div className="ledger-table-wrap glass-card">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Homeowner</th>
              <th>Block / Lot</th>
              <th>Due</th>
              <th>Paid</th>
              <th>Balance</th>
              <th>Last Payment</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            {filteredEntries.length === 0 ? (
              <tr>
                <td colSpan="7" className="ledger-empty">
                  No records found.
                </td>
              </tr>
            ) : (
              filteredEntries.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <strong>{entry.name}</strong>
                  </td>

                  <td>
                    {entry.block}, {entry.lot}
                  </td>

                  <td>{formatCurrency(entry.dueAmount)}</td>
                  <td>{formatCurrency(entry.paidAmount)}</td>

                  <td
                    className={
                      entry.balance > 0 ? 'ledger-balance-due' : ''
                    }
                  >
                    {formatCurrency(entry.balance)}
                  </td>

                  <td>{entry.lastPayment}</td>

                  <td>
                    <span
                      className={`ledger-badge ledger-badge-${entry.status.toLowerCase()}`}
                    >
                      {entry.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}