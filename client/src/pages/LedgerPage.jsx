import React, { useEffect, useMemo, useState } from 'react'
import './LedgerPage.css'
import { FileText, TrendingUp, AlertCircle } from '../components/Icons'
import { supabase } from '../lib/supabaseClient'

const EMPTY_HOMEOWNER = {
  homeownerName: '',
  blockName: '',
  lotNumber: '',
}

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
})

const date = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeZone: 'Asia/Manila',
})

const normalize = (value) => String(value ?? '').trim().toLowerCase()

export default function LedgerPage({ user: suppliedUser }) {
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [search, setSearch] = useState('')
  const [blockFilter, setBlockFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [blocks, setBlocks] = useState([])
  const [properties, setProperties] = useState([])
  const [payments, setPayments] = useState([])
  const [duesAmount, setDuesAmount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [showAddHomeowner, setShowAddHomeowner] = useState(false)
  const [homeownerForm, setHomeownerForm] = useState(EMPTY_HOMEOWNER)
  const [formError, setFormError] = useState('')
  const [savingHomeowner, setSavingHomeowner] = useState(false)
  const [showAddBlock, setShowAddBlock] = useState(false)
  const [newBlockName, setNewBlockName] = useState('')
  const [blockError, setBlockError] = useState('')
  const [savingBlock, setSavingBlock] = useState(false)

  const role = currentUser?.role?.trim().toLowerCase()
  const canManageHomeowners = role === 'admin' || role === 'secretary'
  const actorName = currentUser?.full_name || currentUser?.name || currentUser?.email || 'Staff member'

  useEffect(() => {
    loadLedger()
    resolveCurrentUser()
  }, [])

  async function resolveCurrentUser() {
    if (suppliedUser) {
      setCurrentUser(suppliedUser)
      return
    }

    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser()
    if (authError || !authUser) return

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .single()

    if (!profileError) setCurrentUser(profile)
  }

  async function loadLedger() {
    setLoading(true)
    setPageError('')

    const [blockResult, propertyResult, paymentResult, settingsResult] =
      await Promise.all([
        supabase.from('blocks').select('id, name').order('name'),
        supabase
          .from('properties')
          .select('id, block, lot_number, homeowner_name, created_at')
          .order('homeowner_name'),
        supabase.from('payments').select('*').order('paid_at', { ascending: false }),
        supabase.from('system_settings').select('dues_amount').eq('id', 1).maybeSingle(),
      ])

    const errors = [blockResult.error, propertyResult.error, paymentResult.error]
      .filter(Boolean)
      .map((error) => error.message)

    if (errors.length > 0) {
      setPageError(`Could not load the complete ledger: ${errors.join(' ')}`)
    }

    setBlocks(blockResult.data || [])
    setProperties(propertyResult.data || [])
    setPayments(paymentResult.data || [])
    setDuesAmount(Number(settingsResult.data?.dues_amount) || 0)
    setLoading(false)
  }

  function openHomeownerForm() {
    setHomeownerForm(EMPTY_HOMEOWNER)
    setFormError('')
    setShowAddHomeowner(true)
  }

  function closeHomeownerForm() {
    if (savingHomeowner) return
    setShowAddHomeowner(false)
    setFormError('')
  }

  function updateHomeownerField(event) {
    const { name, value } = event.target
    setHomeownerForm((current) => ({ ...current, [name]: value }))
    setFormError('')
  }

  async function handleAddBlock(event) {
    event.preventDefault()

    if (!canManageHomeowners) {
      setBlockError('Only an Admin or Secretary can add blocks.')
      return
    }

    const name = newBlockName.trim().replace(/\s+/g, ' ')

    if (!name) {
      setBlockError('Enter a block name.')
      return
    }

    if (blocks.some((block) => normalize(block.name) === normalize(name))) {
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
      setBlockError(error.code === '23505' ? 'That block already exists.' : error.message)
      setSavingBlock(false)
      return
    }

    setBlocks((current) =>
      [...current, data].sort((a, b) => a.name.localeCompare(b.name)),
    )
    setNewBlockName('')
    setShowAddBlock(false)
    setSavingBlock(false)

    const { error: activityError } = await supabase.from('activity_log').insert({
      user_id: currentUser?.id || null,
      action: 'Block Added',
      target: `${data.name} (by ${actorName})`,
    })

    if (activityError) {
      console.warn('Block saved, but activity logging failed:', activityError.message)
    }
  }

  async function handleAddHomeowner(event) {
    event.preventDefault()

    if (!canManageHomeowners) {
      setFormError('Only an Admin or Secretary can add homeowners.')
      return
    }

    const homeownerName = homeownerForm.homeownerName.trim().replace(/\s+/g, ' ')
    const blockName = homeownerForm.blockName
    const lotNumber = Number(homeownerForm.lotNumber)

    if (!homeownerName || !blockName || !homeownerForm.lotNumber) {
      setFormError('Homeowner name, block, and lot number are required.')
      return
    }

    if (!Number.isInteger(lotNumber) || lotNumber <= 0) {
      setFormError('Lot number must be a whole number greater than zero.')
      return
    }

    const lotIsOccupied = properties.some(
      (property) =>
        normalize(property.block) === normalize(blockName) &&
        Number(property.lot_number) === lotNumber,
    )

    if (lotIsOccupied) {
      setFormError('That block and lot already has a homeowner.')
      return
    }

    setSavingHomeowner(true)
    setFormError('')

    const { data, error } = await supabase
      .from('properties')
      .insert({
        homeowner_name: homeownerName,
        block: blockName,
        lot_number: lotNumber,
      })
      .select('id, block, lot_number, homeowner_name, created_at')
      .single()

    if (error) {
      setFormError(error.code === '23505'
        ? 'That block and lot already has a homeowner.'
        : error.message)
      setSavingHomeowner(false)
      return
    }

    setProperties((current) =>
      [...current, data].sort((a, b) =>
        a.homeowner_name.localeCompare(b.homeowner_name),
      ),
    )
    setBlockFilter(data.block)
    setShowAddHomeowner(false)
    setHomeownerForm(EMPTY_HOMEOWNER)
    setSavingHomeowner(false)

    const { error: activityError } = await supabase.from('activity_log').insert({
      user_id: currentUser?.id || null,
      action: 'Homeowner Added',
      target: `${homeownerName} — ${blockName}, Lot ${lotNumber} (by ${actorName})`,
    })

    if (activityError) {
      console.warn('Homeowner saved, but activity logging failed:', activityError.message)
    }
  }

  const ledgerEntries = useMemo(() => {
    return properties.map((property) => {
      const propertyPayments = payments.filter((payment) => {
        if (payment.property_id != null) {
          return Number(payment.property_id) === Number(property.id)
        }

        return (
          normalize(payment.homeowner_name) === normalize(property.homeowner_name) &&
          normalize(payment.block_name) === normalize(property.block) &&
          normalize(payment.lot_number).replace(/^lot\s*/, '') ===
            String(property.lot_number)
        )
      })

      const latestPayment = propertyPayments[0]
      const dueAmount = latestPayment
        ? Number(latestPayment.previous_balance) || duesAmount
        : duesAmount
      const paidAmount = latestPayment ? Number(latestPayment.amount_paid) || 0 : 0
      const balance = latestPayment
        ? Number(latestPayment.remaining_balance) || 0
        : dueAmount
      const status = balance <= 0 ? 'Paid' : paidAmount > 0 ? 'Partial' : 'Overdue'

      return {
        id: property.id,
        name: property.homeowner_name,
        block: property.block,
        lot: `Lot ${property.lot_number}`,
        dueAmount,
        paidAmount,
        balance,
        lastPayment: latestPayment?.paid_at
          ? date.format(new Date(latestPayment.paid_at))
          : '—',
        status,
      }
    })
  }, [properties, payments, duesAmount])

  const filtered = useMemo(() => {
    const term = normalize(search)
    return ledgerEntries.filter((entry) => {
      const matchesSearch =
        normalize(entry.name).includes(term) || normalize(entry.lot).includes(term)
      const matchesBlock = blockFilter === 'all' || entry.block === blockFilter
      const matchesStatus = statusFilter === 'all' || entry.status === statusFilter
      return matchesSearch && matchesBlock && matchesStatus
    })
  }, [ledgerEntries, search, blockFilter, statusFilter])

  const totals = useMemo(() => {
    return ledgerEntries.reduce(
      (result, entry) => ({
        totalDue: result.totalDue + entry.dueAmount,
        totalPaid: result.totalPaid + entry.paidAmount,
        totalBalance: result.totalBalance + entry.balance,
      }),
      { totalDue: 0, totalPaid: 0, totalBalance: 0 },
    )
  }, [ledgerEntries])

  return (
    <div className="ledger-page">
      <div className="ledger-header-row">
        <div className="ledger-header">
          <h1>Ledger</h1>
          <p>Track homeowner dues, payments, and outstanding balances.</p>
        </div>

        {canManageHomeowners && (
          <div className="ledger-header-actions">
            <button
              className="ledger-secondary-action"
              type="button"
              onClick={() => {
                setBlockError('')
                setNewBlockName('')
                setShowAddBlock(true)
              }}
            >
              + Add Block
            </button>
            <button
              className="ledger-add-homeowner-button"
              type="button"
              onClick={openHomeownerForm}
            >
              + Add New Homeowner
            </button>
          </div>
        )}
      </div>

      {pageError && <p className="ledger-load-error">{pageError}</p>}

      <div className="ledger-summary-grid">
        <div className="ledger-summary-card glass-card">
          <div className="ledger-summary-icon ledger-summary-icon-due"><FileText size={20} /></div>
          <div><p className="ledger-summary-label">Total Dues</p><p className="ledger-summary-value">{peso.format(totals.totalDue)}</p></div>
        </div>
        <div className="ledger-summary-card glass-card">
          <div className="ledger-summary-icon ledger-summary-icon-paid"><TrendingUp size={20} /></div>
          <div><p className="ledger-summary-label">Total Collected</p><p className="ledger-summary-value">{peso.format(totals.totalPaid)}</p></div>
        </div>
        <div className="ledger-summary-card glass-card">
          <div className="ledger-summary-icon ledger-summary-icon-balance"><AlertCircle size={20} /></div>
          <div><p className="ledger-summary-label">Outstanding Balance</p><p className="ledger-summary-value">{peso.format(totals.totalBalance)}</p></div>
        </div>
      </div>

      <div className="ledger-toolbar">
        <input
          type="search"
          placeholder="Search by name or lot..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="ledger-search"
        />
        <select value={blockFilter} onChange={(event) => setBlockFilter(event.target.value)} className="ledger-select" disabled={loading}>
          <option value="all">{loading ? 'Loading blocks...' : 'All Blocks'}</option>
          {blocks.map((block) => <option key={block.id} value={block.name}>{block.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="ledger-select">
          <option value="all">All Statuses</option>
          <option value="Paid">Paid</option>
          <option value="Partial">Partial</option>
          <option value="Overdue">Overdue</option>
        </select>
      </div>

      <div className="ledger-table-wrap glass-card">
        <table className="ledger-table">
          <thead>
            <tr><th>Homeowner</th><th>Block / Lot</th><th>Due</th><th>Paid</th><th>Balance</th><th>Last Payment</th><th>Status</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="7" className="ledger-empty">Loading ledger...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan="7" className="ledger-empty">No homeowner records found.</td></tr>
            ) : filtered.map((entry) => (
              <tr key={entry.id}>
                <td><strong>{entry.name}</strong></td>
                <td>{entry.block}, {entry.lot}</td>
                <td>{peso.format(entry.dueAmount)}</td>
                <td>{peso.format(entry.paidAmount)}</td>
                <td className={entry.balance > 0 ? 'ledger-balance-due' : ''}>{peso.format(entry.balance)}</td>
                <td>{entry.lastPayment}</td>
                <td><span className={`ledger-badge ledger-badge-${entry.status.toLowerCase()}`}>{entry.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAddHomeowner && canManageHomeowners && (
        <div className="ledger-modal-backdrop" onMouseDown={closeHomeownerForm}>
          <form className="ledger-modal glass-card" onSubmit={handleAddHomeowner} onMouseDown={(event) => event.stopPropagation()}>
            <div className="ledger-modal-heading">
              <div>
                <h2>Add New Homeowner</h2>
                <p>Add the homeowner and assign an available block and lot.</p>
              </div>
              <button type="button" className="ledger-modal-close" onClick={closeHomeownerForm} aria-label="Close">×</button>
            </div>

            <label htmlFor="homeowner-name">Homeowner full name</label>
            <input id="homeowner-name" name="homeownerName" value={homeownerForm.homeownerName} onChange={updateHomeownerField} maxLength="120" autoFocus required />

            <div className="ledger-form-row">
              <div>
                <label htmlFor="homeowner-block">Block</label>
                <select id="homeowner-block" name="blockName" value={homeownerForm.blockName} onChange={updateHomeownerField} required>
                  <option value="">Select block</option>
                  {blocks.map((block) => <option key={block.id} value={block.name}>{block.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="homeowner-lot">Lot number</label>
                <input id="homeowner-lot" name="lotNumber" type="number" min="1" step="1" value={homeownerForm.lotNumber} onChange={updateHomeownerField} placeholder="e.g., 12" required />
              </div>
            </div>

            {blocks.length === 0 && <p className="ledger-form-note">No blocks are available. Add a block first.</p>}
            {formError && <p className="ledger-form-error">{formError}</p>}

            <div className="ledger-modal-actions">
              <button type="button" className="ledger-cancel-button" onClick={closeHomeownerForm} disabled={savingHomeowner}>Cancel</button>
              <button type="submit" className="ledger-save-button" disabled={savingHomeowner || blocks.length === 0}>
                {savingHomeowner ? 'Saving...' : 'Save Homeowner'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showAddBlock && canManageHomeowners && (
        <div
          className="ledger-modal-backdrop"
          onMouseDown={() => !savingBlock && setShowAddBlock(false)}
        >
          <form
            className="ledger-modal glass-card"
            onSubmit={handleAddBlock}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="ledger-modal-heading">
              <div>
                <h2>Add New Block</h2>
                <p>Create a block before assigning homeowners to it.</p>
              </div>
              <button
                type="button"
                className="ledger-modal-close"
                onClick={() => setShowAddBlock(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <label htmlFor="block-name">Block name</label>
            <input
              id="block-name"
              value={newBlockName}
              onChange={(event) => {
                setNewBlockName(event.target.value)
                setBlockError('')
              }}
              placeholder="e.g., Block F"
              maxLength="50"
              autoFocus
              required
            />

            {blockError && <p className="ledger-form-error">{blockError}</p>}

            <div className="ledger-modal-actions">
              <button type="button" className="ledger-cancel-button" onClick={() => setShowAddBlock(false)} disabled={savingBlock}>Cancel</button>
              <button type="submit" className="ledger-save-button" disabled={savingBlock}>
                {savingBlock ? 'Saving...' : 'Save Block'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}