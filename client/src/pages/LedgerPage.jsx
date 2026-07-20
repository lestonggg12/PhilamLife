import React, { useState, useMemo } from 'react'
import './LedgerPage.css'
import { FileText, TrendingUp, AlertCircle } from '../components/Icons'

export default function LedgerPage() {
  const [search, setSearch] = useState('')
  const [blockFilter, setBlockFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  const ledgerEntries = [
    { id: 1, name: 'John Doe', block: 'Block A', lot: 'Lot 5', dueAmount: 5000, paidAmount: 5000, balance: 0, lastPayment: '2026-07-01', status: 'Paid' },
    { id: 2, name: 'Maria Santos', block: 'Block B', lot: 'Lot 12', dueAmount: 5000, paidAmount: 3500, balance: 1500, lastPayment: '2026-06-15', status: 'Partial' },
    { id: 3, name: 'Carlos Reyes', block: 'Block C', lot: 'Lot 8', dueAmount: 5000, paidAmount: 0, balance: 5000, lastPayment: '—', status: 'Overdue' },
    { id: 4, name: 'Ana Cruz', block: 'Block A', lot: 'Lot 2', dueAmount: 5000, paidAmount: 5000, balance: 0, lastPayment: '2026-07-05', status: 'Paid' },
    { id: 5, name: 'Ramon Torres', block: 'Block D', lot: 'Lot 19', dueAmount: 5000, paidAmount: 2000, balance: 3000, lastPayment: '2026-05-28', status: 'Partial' },
    { id: 6, name: 'Liza Bautista', block: 'Block B', lot: 'Lot 3', dueAmount: 5000, paidAmount: 0, balance: 5000, lastPayment: '—', status: 'Overdue' },
    { id: 7, name: 'Nelson Garcia', block: 'Block E', lot: 'Lot 11', dueAmount: 5000, paidAmount: 5000, balance: 0, lastPayment: '2026-07-10', status: 'Paid' },
  ]

  const blocks = ['all', ...new Set(ledgerEntries.map((e) => e.block))]

  const filtered = useMemo(() => {
    return ledgerEntries.filter((e) => {
      const matchesSearch =
        e.name.toLowerCase().includes(search.toLowerCase()) ||
        e.lot.toLowerCase().includes(search.toLowerCase())
      const matchesBlock = blockFilter === 'all' || e.block === blockFilter
      const matchesStatus = statusFilter === 'all' || e.status === statusFilter
      return matchesSearch && matchesBlock && matchesStatus
    })
  }, [search, blockFilter, statusFilter])

  const totals = useMemo(() => {
    const totalDue = ledgerEntries.reduce((sum, e) => sum + e.dueAmount, 0)
    const totalPaid = ledgerEntries.reduce((sum, e) => sum + e.paidAmount, 0)
    const totalBalance = ledgerEntries.reduce((sum, e) => sum + e.balance, 0)
    return { totalDue, totalPaid, totalBalance }
  }, [])

  const formatCurrency = (n) => `₱${n.toLocaleString()}`

  return (
    <div className="ledger-page">
      <div className="ledger-header">
        <h1>Ledger</h1>
        <p>Track homeowner dues, payments, and outstanding balances.</p>
      </div>

      {/* Summary Cards */}
      <div className="ledger-summary-grid">
        <div className="ledger-summary-card glass-card">
          <div className="ledger-summary-icon" style={{ background: 'rgba(20,100,160,0.12)', color: '#1464a0' }}>
            <FileText size={20} />
          </div>
          <div>
            <p className="ledger-summary-label">Total Dues</p>
            <p className="ledger-summary-value">{formatCurrency(totals.totalDue)}</p>
          </div>
        </div>
        <div className="ledger-summary-card glass-card">
          <div className="ledger-summary-icon" style={{ background: 'rgba(26,138,96,0.12)', color: '#1a8a60' }}>
            <TrendingUp size={20} />
          </div>
          <div>
            <p className="ledger-summary-label">Total Collected</p>
            <p className="ledger-summary-value">{formatCurrency(totals.totalPaid)}</p>
          </div>
        </div>
        <div className="ledger-summary-card glass-card">
          <div className="ledger-summary-icon" style={{ background: 'rgba(192,57,43,0.12)', color: '#c0392b' }}>
            <AlertCircle size={20} />
          </div>
          <div>
            <p className="ledger-summary-label">Outstanding Balance</p>
            <p className="ledger-summary-value">{formatCurrency(totals.totalBalance)}</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="ledger-toolbar">
        <input
          type="text"
          placeholder="Search by name or lot..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ledger-search"
        />
        <select value={blockFilter} onChange={(e) => setBlockFilter(e.target.value)} className="ledger-select">
          {blocks.map((b) => (
            <option key={b} value={b}>{b === 'all' ? 'All Blocks' : b}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="ledger-select">
          <option value="all">All Statuses</option>
          <option value="Paid">Paid</option>
          <option value="Partial">Partial</option>
          <option value="Overdue">Overdue</option>
        </select>
      </div>

      {/* Table */}
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
            {filtered.length === 0 ? (
              <tr>
                <td colSpan="7" className="ledger-empty">No records found.</td>
              </tr>
            ) : (
              filtered.map((e) => (
                <tr key={e.id}>
                  <td><strong>{e.name}</strong></td>
                  <td>{e.block}, {e.lot}</td>
                  <td>{formatCurrency(e.dueAmount)}</td>
                  <td>{formatCurrency(e.paidAmount)}</td>
                  <td className={e.balance > 0 ? 'ledger-balance-due' : ''}>{formatCurrency(e.balance)}</td>
                  <td>{e.lastPayment}</td>
                  <td>
                    <span className={`ledger-badge ledger-badge-${e.status.toLowerCase()}`}>
                      {e.status}
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