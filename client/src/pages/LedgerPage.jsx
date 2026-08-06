import React, { useEffect, useMemo, useState } from 'react'
import './LedgerPage.css'
import { FileText, TrendingUp, AlertCircle } from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import { computeLateFee } from '../lib/latepenalty'
import { fetchLedgerAccounts, fetchStatementLines } from '../lib/hoaLedger'

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
const statementValue = (row, keys, fallback = '—') => {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null) return row[key]
  }
  return fallback
}

export default function LedgerPage({ user: suppliedUser }) {
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [search, setSearch] = useState('')
  const [blockFilter, setBlockFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [blocks, setBlocks] = useState([])
  const [properties, setProperties] = useState([])
  const [payments, setPayments] = useState([])
  const [accountSummaries, setAccountSummaries] = useState([])
  const [ledgerAvailable, setLedgerAvailable] = useState(false)
  const [duesAmount, setDuesAmount] = useState(0)
  const [penaltySettings, setPenaltySettings] = useState({
    dueDay: 5,
    gracePeriodDays: 0,
    latePenalty: 0,
  })
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
  const [statementAccount, setStatementAccount] = useState(null)
  const [statementLines, setStatementLines] = useState([])
  const [statementLoading, setStatementLoading] = useState(false)
  const [statementError, setStatementError] = useState('')

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

    const [blockResult, propertyResult, paymentResult, settingsResult, accountResult] =
      await Promise.all([
        supabase.from('blocks').select('id, name').order('name'),
        supabase
          .from('properties')
          .select('id, block, lot_number, homeowner_name, created_at')
          .order('homeowner_name'),
        supabase.from('payments').select('*').order('paid_at', { ascending: false }),
        supabase.from('system_settings').select('dues_amount, due_day, grace_period_days, late_penalty').eq('id', 1).maybeSingle(),
        fetchLedgerAccounts()
          .then((data) => ({ data, error: null }))
          .catch((error) => ({ data: [], error })),
      ])

    const errors = [blockResult.error, propertyResult.error, paymentResult.error, accountResult.error]
      .filter(Boolean)
      .map((error) => error.message)

    if (errors.length > 0) {
      setPageError(`Could not load the complete ledger: ${errors.join(' ')}`)
    }

    setBlocks(blockResult.data || [])
    setProperties(propertyResult.data || [])
    setPayments(paymentResult.data || [])
    setAccountSummaries(accountResult.data || [])
    setLedgerAvailable(!accountResult.error)
    setDuesAmount(Number(settingsResult.data?.dues_amount) || 0)
    setPenaltySettings({
      dueDay: Number(settingsResult.data?.due_day) || 5,
      gracePeriodDays: Number(settingsResult.data?.grace_period_days) || 0,
      latePenalty: Number(settingsResult.data?.late_penalty) || 0,
    })
    setLoading(false)
  }

  async function openStatement(entry) {
    setStatementAccount(entry)
    setStatementLines([])
    setStatementError('')
    setStatementLoading(true)

    try {
      const lines = await fetchStatementLines(entry.id)
      setStatementLines(lines)
    } catch (error) {
      setStatementError(error.message)
    } finally {
      setStatementLoading(false)
    }
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
    if (ledgerAvailable) {
      return accountSummaries.map((account) => {
        const overdue = account.days1To30 + account.days31To60 + account.days61To90 + account.days90Plus
        return {
          id: account.propertyId,
          name: account.homeownerName,
          block: account.blockName,
          lot: `Lot ${account.lotNumber}`,
          dueAmount: account.totalCharges,
          paidAmount: account.totalPaid,
          balance: account.balance,
          penaltyAmount: 0,
          totalDue: account.balance,
          unallocatedCredit: account.unallocatedCredit,
          lastPayment: account.lastPaymentAt ? date.format(new Date(account.lastPaymentAt)) : '—',
          status: account.balance <= 0 ? 'Paid' : overdue > 0 ? 'Overdue' : account.totalPaid > 0 ? 'Partial' : 'Pending',
        }
      })
    }

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

      const activePropertyPayments = propertyPayments.filter(
        (payment) => payment.status !== 'Voided',
      )
      const latestPayment = activePropertyPayments[0]
      const dueAmount = latestPayment
        ? Number(latestPayment.previous_balance) || duesAmount
        : duesAmount
      const paidAmount = latestPayment ? Number(latestPayment.amount_paid) || 0 : 0
      const balance = latestPayment
        ? Number(latestPayment.remaining_balance) || 0
        : dueAmount
      const lateFee = computeLateFee({
        balance,
        dueDay: penaltySettings.dueDay,
        gracePeriodDays: penaltySettings.gracePeriodDays,
        latePenalty: penaltySettings.latePenalty,
      })
      const status = balance <= 0
        ? 'Paid'
        : paidAmount > 0
          ? 'Partial'
          : lateFee.isOverdue
            ? 'Overdue'
            : 'Pending'

      return {
        id: property.id,
        name: property.homeowner_name,
        block: property.block,
        lot: `Lot ${property.lot_number}`,
        dueAmount,
        paidAmount,
        balance,
        penaltyAmount: lateFee.penaltyAmount,
        totalDue: lateFee.totalDue,
        lastPayment: latestPayment?.paid_at
          ? date.format(new Date(latestPayment.paid_at))
          : '—',
        status,
      }
    })
  }, [accountSummaries, ledgerAvailable, properties, payments, duesAmount, penaltySettings])

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
          <option value="Pending">Pending</option>
          <option value="Overdue">Overdue</option>
        </select>
      </div>

      <div className="ledger-table-wrap glass-card">
        <table className="ledger-table">
          <thead>
            <tr><th>Homeowner</th><th>Block / Lot</th><th>Charges</th><th>Allocated</th><th>Balance</th><th>Credit</th><th>Last Payment</th><th>Status</th><th aria-label="Actions" /></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="9" className="ledger-empty">Loading ledger...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan="9" className="ledger-empty">No homeowner records found.</td></tr>
            ) : filtered.map((entry) => (
              <tr key={entry.id}>
                <td><strong>{entry.name}</strong></td>
                <td>{entry.block}, {entry.lot}</td>
                <td>{peso.format(entry.dueAmount)}</td>
                <td>{peso.format(entry.paidAmount)}</td>
                <td className={entry.balance > 0 ? 'ledger-balance-due' : ''}>{peso.format(entry.balance)}</td>
                <td className={entry.unallocatedCredit > 0 ? 'ledger-credit' : ''}>{entry.unallocatedCredit > 0 ? peso.format(entry.unallocatedCredit) : '—'}</td>
                <td>{entry.lastPayment}</td>
                <td><span className={`ledger-badge ledger-badge-${entry.status.toLowerCase()}`}>{entry.status}</span></td>
                <td><button className="ledger-statement-button" type="button" onClick={() => openStatement(entry)} disabled={!ledgerAvailable}>Statement</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {statementAccount && (
        <div className="ledger-modal-backdrop" onMouseDown={() => setStatementAccount(null)}>
          <article className="ledger-statement-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="ledger-modal-heading">
              <div><p className="ledger-statement-kicker">Homeowner statement</p><h2>{statementAccount.name}</h2><p>{statementAccount.block}, {statementAccount.lot}</p></div>
              <button type="button" className="ledger-modal-close" onClick={() => setStatementAccount(null)} aria-label="Close">×</button>
            </div>
            <div className="ledger-statement-summary">
              <div><span>Total charges</span><strong>{peso.format(statementAccount.dueAmount)}</strong></div>
              <div><span>Payments allocated</span><strong>{peso.format(statementAccount.paidAmount)}</strong></div>
              <div><span>Outstanding balance</span><strong>{peso.format(statementAccount.balance)}</strong></div>
              <div><span>Available credit</span><strong>{peso.format(statementAccount.unallocatedCredit || 0)}</strong></div>
            </div>
            {statementError && <p className="ledger-form-error">{statementError}</p>}
            <div className="ledger-statement-lines">
              <table>
                <thead><tr><th>Date</th><th>Entry</th><th>Reference</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead>
                <tbody>
                  {statementLoading ? <tr><td colSpan="6" className="ledger-empty">Loading statement…</td></tr> : statementLines.length === 0 ? <tr><td colSpan="6" className="ledger-empty">No statement entries found.</td></tr> : statementLines.map((line, index) => {
                    const lineDate = statementValue(line, ['transaction_date', 'line_date', 'entry_date', 'posted_at', 'created_at'], null)
                    return <tr key={line.id || `${lineDate}-${index}`}>
                      <td>{lineDate ? date.format(new Date(lineDate)) : '—'}</td>
                      <td>{statementValue(line, ['description', 'entry_type', 'transaction_type', 'type'])}</td>
                      <td>{statementValue(line, ['reference_number', 'reference', 'receipt_number'])}</td>
                      <td>{peso.format(Number(statementValue(line, ['debit', 'charge_amount'], 0)) || 0)}</td>
                      <td>{peso.format(Number(statementValue(line, ['credit', 'payment_amount'], 0)) || 0)}</td>
                      <td>{peso.format(Number(statementValue(line, ['running_balance', 'balance'], 0)) || 0)}</td>
                    </tr>
                  })}
                </tbody>
              </table>
            </div>
            <div className="ledger-modal-actions"><button type="button" className="ledger-cancel-button" onClick={() => setStatementAccount(null)}>Close</button><button type="button" className="ledger-save-button" onClick={() => window.print()}>Print / Save PDF</button></div>
          </article>
        </div>
      )}

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