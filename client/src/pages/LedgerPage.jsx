import React, { useEffect, useMemo, useState } from 'react'
import './LedgerPage.css'
import { FileText, TrendingUp, AlertCircle, CreditCard } from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import { computeLateFee } from '../lib/latepenalty'
import { buildHomeownerStatementPdf } from '../lib/homeownerStatementPdf'
import { useOrganization } from '../context/OrganizationContext'

const EMPTY_HOMEOWNER = {
  homeownerName: '',
  blockName: '',
  lotNumber: '',
}

const SORT_COLUMNS = [
  { key: 'name', label: 'Homeowner' },
  { key: 'block', label: 'Block / Lot' },
  { key: 'dueAmount', label: 'Charges' },
  { key: 'paidAmount', label: 'Allocated' },
  { key: 'balance', label: 'Balance' },
  { key: 'lastPaymentSort', label: 'Last Payment' },
]

// The table only renders once the user has narrowed things down — with a
// search term or a non-default filter — so we never dump the full
// homeowner list into the DOM at once. MAX_VISIBLE_ROWS is a second
// safety net in case a broad search or filter still matches a lot of rows.
const MIN_SEARCH_LENGTH = 2
const MAX_VISIBLE_ROWS = 100

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
})

const timeOfDay = new Intl.DateTimeFormat('en-PH', {
  timeStyle: 'short',
  timeZone: 'Asia/Manila',
})

const normalize = (value) => String(value ?? '').trim().toLowerCase()

function compareEntries(a, b, key, direction) {
  let result = 0

  if (key === 'block') {
    result = a.block.localeCompare(b.block) || a.lotNumberRaw - b.lotNumberRaw
  } else if (typeof a[key] === 'number') {
    result = a[key] - b[key]
  } else {
    result = String(a[key]).localeCompare(String(b[key]))
  }

  return direction === 'desc' ? -result : result
}

export default function LedgerPage({ user: suppliedUser }) {
  const { organization } = useOrganization()
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [search, setSearch] = useState('')
  const [blockFilter, setBlockFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'asc' })
  const [blocks, setBlocks] = useState([])
  const [properties, setProperties] = useState([])
  const [payments, setPayments] = useState([])
  const [duesAmount, setDuesAmount] = useState(0)
  const [penaltySettings, setPenaltySettings] = useState({
    dueDay: 5,
    gracePeriodDays: 0,
    latePenalty: 0,
  })
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [logNotice, setLogNotice] = useState('')
  const [orgSettings, setOrgSettings] = useState(null)
  const [statementPdfGenerating, setStatementPdfGenerating] = useState(false)

  const [showAddHomeowner, setShowAddHomeowner] = useState(false)
  const [homeownerForm, setHomeownerForm] = useState(EMPTY_HOMEOWNER)
  const [editingHomeownerId, setEditingHomeownerId] = useState(null)
  const [formError, setFormError] = useState('')
  const [savingHomeowner, setSavingHomeowner] = useState(false)

  const [showManageBlocks, setShowManageBlocks] = useState(false)
  const [newBlockName, setNewBlockName] = useState('')
  const [blockError, setBlockError] = useState('')
  const [savingBlock, setSavingBlock] = useState(false)
  const [editingBlockId, setEditingBlockId] = useState(null)
  const [editingBlockName, setEditingBlockName] = useState('')
  const [blockActionError, setBlockActionError] = useState('')
  const [blockActionBusyId, setBlockActionBusyId] = useState(null)

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

    const [blockResult, propertyResult, paymentResult, settingsResult] =
      await Promise.all([
        supabase.from('blocks').select('id, name').order('name'),
        supabase
          .from('properties')
          .select('id, block, lot_number, homeowner_name, created_at, homeowner_status')
          .order('homeowner_name'),
        supabase.from('payments').select('*').order('paid_at', { ascending: false }),
        supabase.from('system_settings').select('dues_amount, due_day, grace_period_days, late_penalty, hoa_name, address').eq('id', 1).maybeSingle(),
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
    setOrgSettings(settingsResult.data || null)
    setDuesAmount(Number(settingsResult.data?.dues_amount) || 0)
    setPenaltySettings({
      dueDay: Number(settingsResult.data?.due_day) || 5,
      gracePeriodDays: Number(settingsResult.data?.grace_period_days) || 0,
      latePenalty: Number(settingsResult.data?.late_penalty) || 0,
    })
    setLoading(false)
  }

  async function logActivity(action, target, fallbackNotice) {
    const { error } = await supabase.from('activity_log').insert({
      user_id: currentUser?.id || null,
      action,
      target,
    })
    if (error) {
      console.warn(`${action} succeeded, but activity logging failed:`, error.message)
      setLogNotice(fallbackNotice)
    }
  }

  function propertyPaymentsFor(entry) {
    return payments
      .filter((payment) => {
        if (payment.property_id != null) {
          return Number(payment.property_id) === Number(entry.id)
        }

        return (
          normalize(payment.homeowner_name) === normalize(entry.name) &&
          normalize(payment.block_name) === normalize(entry.block) &&
          normalize(payment.lot_number).replace(/^lot\s*/, '') ===
            String(entry.lotNumberRaw)
        )
      })
      .slice()
      .sort((a, b) => new Date(a.paid_at) - new Date(b.paid_at))
  }

  function openStatement(entry) {
    setStatementAccount(entry)
    setStatementError('')
    setStatementLoading(true)

    const lines = propertyPaymentsFor(entry).map((payment) => ({
      id: payment.id,
      transaction_date: payment.paid_at,
      description: payment.status === 'Voided'
        ? `${payment.coverage_period || 'Payment'} (Voided)`
        : (payment.coverage_period || 'Payment'),
      reference_number: payment.reference_number || payment.receipt_number,
      debit: 0,
      credit: payment.status === 'Voided' ? 0 : Number(payment.amount_paid) || 0,
      running_balance: payment.status === 'Voided' ? null : Number(payment.remaining_balance) || 0,
    }))

    setStatementLines(lines)
    setStatementLoading(false)
  }

  function downloadStatementPdf() {
    if (!statementAccount) return
    setStatementPdfGenerating(true)

    try {
      const now = new Date()
      const rows = statementLines.map((line) => ({
        date: line.transaction_date ? organization.formatDate(line.transaction_date) : '—',
        entry: line.description,
        reference: line.reference_number || '—',
        debit: Number(line.debit) || 0,
        credit: Number(line.credit) || 0,
        balance: Number(line.running_balance) || 0,
      }))

      const doc = buildHomeownerStatementPdf({
        hoaName: orgSettings?.hoa_name || 'Homeowners Association',
        hoaAddress: orgSettings?.address || '',
        homeownerName: statementAccount.name,
        blockLotLabel: `${statementAccount.block}, ${statementAccount.lot}`,
        totalCharges: statementAccount.dueAmount,
        paymentsAllocated: statementAccount.paidAmount,
        outstandingBalance: statementAccount.balance,
        availableCredit: statementAccount.unallocatedCredit || 0,
        statementLines: rows,
        preparedBy: actorName,
        datePrepared: organization.formatDate(now),
        timePrepared: timeOfDay.format(now),
      })

      doc.save(`Statement-${statementAccount.name.replace(/\s+/g, '-')}-${organization.formatDate(now).replace(/[,\s\/]/g, '-')}.pdf`)
    } finally {
      setStatementPdfGenerating(false)
    }
  }

  function openHomeownerForm() {
    setHomeownerForm(EMPTY_HOMEOWNER)
    setEditingHomeownerId(null)
    setFormError('')
    setShowAddHomeowner(true)
  }

  function openEditHomeowner(entry) {
    setHomeownerForm({
      homeownerName: entry.name,
      blockName: entry.block,
      lotNumber: String(entry.lotNumberRaw),
    })
    setEditingHomeownerId(entry.id)
    setFormError('')
    setShowAddHomeowner(true)
  }

  function closeHomeownerForm() {
    if (savingHomeowner) return
    setShowAddHomeowner(false)
    setEditingHomeownerId(null)
    setFormError('')
  }

  function updateHomeownerField(event) {
    const { name, value } = event.target
    setHomeownerForm((current) => ({ ...current, [name]: value }))
    setFormError('')
  }

  async function handleSaveHomeowner(event) {
    event.preventDefault()

    if (!canManageHomeowners) {
      setFormError('Only an Admin or Secretary can manage homeowners.')
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
        property.id !== editingHomeownerId &&
        normalize(property.block) === normalize(blockName) &&
        Number(property.lot_number) === lotNumber,
    )

    if (lotIsOccupied) {
      setFormError('That block and lot already has a homeowner.')
      return
    }

    setSavingHomeowner(true)
    setFormError('')

    const payload = {
      homeowner_name: homeownerName,
      block: blockName,
      lot_number: lotNumber,
    }

    const { error } = editingHomeownerId
      ? await supabase.from('properties').update(payload).eq('id', editingHomeownerId)
      : await supabase.from('properties').insert(payload)

    if (error) {
      setFormError(error.code === '23505'
        ? 'That block and lot already has a homeowner.'
        : error.message)
      setSavingHomeowner(false)
      return
    }

    await loadLedger()
    setBlockFilter(blockName)
    setShowAddHomeowner(false)
    setHomeownerForm(EMPTY_HOMEOWNER)
    setSavingHomeowner(false)

    const wasEditing = Boolean(editingHomeownerId)
    setEditingHomeownerId(null)

    await logActivity(
      wasEditing ? 'Homeowner Updated' : 'Homeowner Added',
      `${homeownerName} — ${blockName}, Lot ${lotNumber} (by ${actorName})`,
      wasEditing
        ? 'Homeowner updated, but the activity log entry failed to record.'
        : 'Homeowner saved, but the activity log entry failed to record.',
    )
  }

  async function handleDeleteHomeowner(entry) {
    if (!canManageHomeowners) return

    const confirmed = window.confirm(
      `Remove ${entry.name} (${entry.block}, ${entry.lot})? This cannot be undone.`,
    )
    if (!confirmed) return

    setPageError('')
    const { error } = await supabase.from('properties').delete().eq('id', entry.id)

    if (error) {
      setPageError(`Could not remove homeowner: ${error.message}`)
      return
    }

    await loadLedger()
    await logActivity(
      'Homeowner Removed',
      `${entry.name} — ${entry.block}, ${entry.lot} (by ${actorName})`,
      'Homeowner removed, but the activity log entry failed to record.',
    )
  }

  function openManageBlocks() {
    setBlockError('')
    setBlockActionError('')
    setNewBlockName('')
    setEditingBlockId(null)
    setShowManageBlocks(true)
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

    const { error } = await supabase.from('blocks').insert({ name })

    if (error) {
      setBlockError(error.code === '23505' ? 'That block already exists.' : error.message)
      setSavingBlock(false)
      return
    }

    await loadLedger()
    setNewBlockName('')
    setSavingBlock(false)

    await logActivity(
      'Block Added',
      `${name} (by ${actorName})`,
      'Block saved, but the activity log entry failed to record.',
    )
  }

  function startEditBlock(block) {
    setEditingBlockId(block.id)
    setEditingBlockName(block.name)
    setBlockActionError('')
  }

  function cancelEditBlock() {
    setEditingBlockId(null)
    setEditingBlockName('')
  }

  async function handleRenameBlock(block) {
    const newName = editingBlockName.trim().replace(/\s+/g, ' ')

    if (!newName) {
      setBlockActionError('Enter a block name.')
      return
    }

    if (
      normalize(newName) !== normalize(block.name) &&
      blocks.some((existing) => normalize(existing.name) === normalize(newName))
    ) {
      setBlockActionError('That block name is already in use.')
      return
    }

    if (normalize(newName) === normalize(block.name)) {
      cancelEditBlock()
      return
    }

    setBlockActionBusyId(block.id)
    setBlockActionError('')

    const { error: renameError } = await supabase
      .from('blocks')
      .update({ name: newName })
      .eq('id', block.id)

    if (renameError) {
      setBlockActionError(renameError.message)
      setBlockActionBusyId(null)
      return
    }

    const { error: cascadeError } = await supabase
      .from('properties')
      .update({ block: newName })
      .eq('block', block.name)

    if (cascadeError) {
      setBlockActionError(
        `Block renamed, but existing homeowner records could not be updated: ${cascadeError.message}`,
      )
    }

    await loadLedger()
    setBlockActionBusyId(null)
    cancelEditBlock()

    await logActivity(
      'Block Renamed',
      `${block.name} → ${newName} (by ${actorName})`,
      'Block renamed, but the activity log entry failed to record.',
    )
  }

  async function handleDeleteBlock(block) {
    const hasHomeowners = properties.some(
      (property) => normalize(property.block) === normalize(block.name),
    )

    if (hasHomeowners) {
      setBlockActionError('Reassign or remove the homeowners in this block first.')
      return
    }

    const confirmed = window.confirm(`Delete block "${block.name}"? This cannot be undone.`)
    if (!confirmed) return

    setBlockActionBusyId(block.id)
    setBlockActionError('')

    const { error } = await supabase.from('blocks').delete().eq('id', block.id)

    if (error) {
      setBlockActionError(error.message)
      setBlockActionBusyId(null)
      return
    }

    await loadLedger()
    setBlockActionBusyId(null)

    await logActivity(
      'Block Removed',
      `${block.name} (by ${actorName})`,
      'Block removed, but the activity log entry failed to record.',
    )
  }

  const ledgerEntries = useMemo(() => {
    return properties
      .filter((property) => (property.homeowner_status || 'active') === 'active')
      .map((property) => {
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
        lotNumberRaw: property.lot_number,
        dueAmount,
        paidAmount,
        balance,
        penaltyAmount: lateFee.penaltyAmount,
        totalDue: lateFee.totalDue,
        lastPayment: latestPayment?.paid_at
          ? organization.formatDate(latestPayment.paid_at)
          : '—',
        lastPaymentSort: latestPayment?.paid_at ? new Date(latestPayment.paid_at).getTime() : 0,
        status,
      }
    })
  }, [properties, payments, duesAmount, penaltySettings])

  const filtered = useMemo(() => {
    const term = normalize(search)
    return ledgerEntries.filter((entry) => {
      const matchesSearch =
        normalize(entry.name).includes(term) ||
        normalize(entry.lot).includes(term) ||
        normalize(entry.block).includes(term)
      const matchesBlock = blockFilter === 'all' || entry.block === blockFilter
      const matchesStatus = statusFilter === 'all' || entry.status === statusFilter
      return matchesSearch && matchesBlock && matchesStatus
    })
  }, [ledgerEntries, search, blockFilter, statusFilter])

  const sorted = useMemo(() => {
    const list = [...filtered]
    list.sort((a, b) => compareEntries(a, b, sortConfig.key, sortConfig.direction))
    return list
  }, [filtered, sortConfig])

  const hasActiveQuery =
    normalize(search).length >= MIN_SEARCH_LENGTH || blockFilter !== 'all' || statusFilter !== 'all'
  const visibleRows = hasActiveQuery ? sorted.slice(0, MAX_VISIBLE_ROWS) : []
  const isTruncated = hasActiveQuery && sorted.length > MAX_VISIBLE_ROWS

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

  function toggleSort(key) {
    setSortConfig((current) => {
      if (current.key === key) {
        return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      }
      return { key, direction: 'asc' }
    })
  }

  function sortIndicator(key) {
    if (sortConfig.key !== key) return null
    return <span className="ledger-sort-arrow">{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>
  }

  return (
    <div className="ledger-page">
      <div className="ledger-header-row glass-card">
        <div className="ledger-header">
          <div className="ledger-header-icon"><CreditCard size={22} /></div>
          <div className="ledger-header-copy">
            <span className="ledger-header-eyebrow">{(role || 'staff').toUpperCase()} WORKSPACE</span>
            <h1>Ledger</h1>
            <p>Track homeowner dues, payments, and outstanding balances.</p>
          </div>
        </div>

        <div className="ledger-header-actions">
          {canManageHomeowners && (
            <>
              <button
                className="ledger-secondary-action"
                type="button"
                onClick={openManageBlocks}
              >
                Manage Blocks
              </button>
              <button
                className="ledger-add-homeowner-button"
                type="button"
                onClick={openHomeownerForm}
              >
                + Add New Homeowner
              </button>
            </>
          )}
          <button
            className="ledger-refresh-button"
            type="button"
            onClick={loadLedger}
            disabled={loading}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className={loading ? 'ledger-spin' : ''} aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M21 3v6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {pageError && <p className="ledger-load-error">{pageError}</p>}

      {logNotice && (
        <div className="ledger-log-notice">
          <span>{logNotice}</span>
          <button type="button" onClick={() => setLogNotice('')}>Dismiss</button>
        </div>
      )}

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

      <div className="ledger-toolbar glass-card">
        <div className="ledger-search-wrap">
          <svg className="ledger-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <line x1="16.65" y1="16.65" x2="21" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            placeholder="Search by name, block, or lot..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="ledger-search"
          />
        </div>
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
        {hasActiveQuery && (
          <span className="ledger-result-count">{Math.min(sorted.length, MAX_VISIBLE_ROWS)} of {sorted.length} match{sorted.length === 1 ? '' : 'es'}</span>
        )}
      </div>

      {loading ? (
        <div className="ledger-table-wrap glass-card">
          <div className="ledger-empty">Loading ledger...</div>
        </div>
      ) : !hasActiveQuery ? (
        <div className="ledger-search-prompt glass-card">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.6" />
            <line x1="16.65" y1="16.65" x2="21" y2="21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <h3>Search for a homeowner</h3>
          <p>
            Type at least {MIN_SEARCH_LENGTH} characters of a name, block, or lot — or pick a
            block or status filter above — to view their ledger. Homeowners aren't listed by
            default so the page stays fast as the roster grows.
          </p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="ledger-search-prompt glass-card">
          <AlertCircle size={30} aria-hidden="true" />
          <h3>No matches</h3>
          <p>No homeowner matches "{search}" with the current filters. Try a different name, block, or lot.</p>
        </div>
      ) : (
        <div className="ledger-table-wrap glass-card">
          {isTruncated && (
            <p className="ledger-truncated-note">
              Showing the first {MAX_VISIBLE_ROWS} of {sorted.length} matches — refine your search to narrow this down.
            </p>
          )}
          <table className="ledger-table">
            <thead>
              <tr>
                {SORT_COLUMNS.map((column) => (
                  <th key={column.key} className="ledger-th-sortable" onClick={() => toggleSort(column.key)}>
                    {column.label}{sortIndicator(column.key)}
                  </th>
                ))}
                <th>Credit</th>
                <th>Status</th>
                <th aria-label="Actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((entry) => (
                <tr key={entry.id}>
                  <td><strong>{entry.name}</strong></td>
                  <td>{entry.block}, {entry.lot}</td>
                  <td>{peso.format(entry.dueAmount)}</td>
                  <td>{peso.format(entry.paidAmount)}</td>
                  <td className={entry.balance > 0 ? 'ledger-balance-due' : ''}>{peso.format(entry.balance)}</td>
                  <td>{entry.lastPayment}</td>
                  <td className={entry.unallocatedCredit > 0 ? 'ledger-credit' : ''}>{entry.unallocatedCredit > 0 ? peso.format(entry.unallocatedCredit) : '—'}</td>
                  <td><span className={`ledger-badge ledger-badge-${entry.status.toLowerCase()}`}>{entry.status}</span></td>
                  <td className="ledger-row-actions">
                    <button className="ledger-statement-button" type="button" onClick={() => openStatement(entry)}>Statement</button>
                    {canManageHomeowners && (
                      <>
                        <button className="ledger-icon-button" type="button" onClick={() => openEditHomeowner(entry)}>Edit</button>
                        <button className="ledger-icon-button ledger-icon-button-danger" type="button" onClick={() => handleDeleteHomeowner(entry)}>Delete</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
                  {statementLoading ? <tr><td colSpan="6" className="ledger-empty">Loading statement…</td></tr> : statementLines.length === 0 ? <tr><td colSpan="6" className="ledger-empty">No payment history found.</td></tr> : statementLines.map((line, index) => (
                    <tr key={line.id || `${line.transaction_date}-${index}`}>
                      <td>{line.transaction_date ? organization.formatDate(line.transaction_date) : '—'}</td>
                      <td>{line.description}</td>
                      <td>{line.reference_number || '—'}</td>
                      <td>{peso.format(Number(line.debit) || 0)}</td>
                      <td>{peso.format(Number(line.credit) || 0)}</td>
                      <td>{line.running_balance == null ? '—' : peso.format(Number(line.running_balance) || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ledger-modal-actions"><button type="button" className="ledger-cancel-button" onClick={() => setStatementAccount(null)}>Close</button><button type="button" className="ledger-save-button" onClick={downloadStatementPdf} disabled={statementLoading || statementPdfGenerating}>{statementPdfGenerating ? 'Generating…' : 'Print / Save PDF'}</button></div>
          </article>
        </div>
      )}

      {showAddHomeowner && canManageHomeowners && (
        <div className="ledger-modal-backdrop" onMouseDown={closeHomeownerForm}>
          <form className="ledger-modal glass-card" onSubmit={handleSaveHomeowner} onMouseDown={(event) => event.stopPropagation()}>
            <div className="ledger-modal-heading">
              <div>
                <h2>{editingHomeownerId ? 'Edit Homeowner' : 'Add New Homeowner'}</h2>
                <p>{editingHomeownerId ? 'Update the homeowner or their block and lot.' : 'Add the homeowner and assign an available block and lot.'}</p>
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
                {savingHomeowner ? 'Saving...' : editingHomeownerId ? 'Save Changes' : 'Save Homeowner'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showManageBlocks && canManageHomeowners && (
        <div
          className="ledger-modal-backdrop"
          onMouseDown={() => !savingBlock && !blockActionBusyId && setShowManageBlocks(false)}
        >
          <div className="ledger-modal glass-card" onMouseDown={(event) => event.stopPropagation()}>
            <div className="ledger-modal-heading">
              <div>
                <h2>Manage Blocks</h2>
                <p>Rename or remove existing blocks, or add a new one.</p>
              </div>
              <button
                type="button"
                className="ledger-modal-close"
                onClick={() => setShowManageBlocks(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {blockActionError && <p className="ledger-form-error">{blockActionError}</p>}

            <ul className="ledger-manage-blocks-list">
              {blocks.length === 0 && <li className="ledger-form-note">No blocks yet.</li>}
              {blocks.map((block) => (
                <li key={block.id} className="ledger-manage-block-row">
                  {editingBlockId === block.id ? (
                    <>
                      <input
                        value={editingBlockName}
                        onChange={(event) => setEditingBlockName(event.target.value)}
                        maxLength="50"
                        autoFocus
                      />
                      <button
                        type="button"
                        className="ledger-icon-button"
                        onClick={() => handleRenameBlock(block)}
                        disabled={blockActionBusyId === block.id}
                      >
                        {blockActionBusyId === block.id ? 'Saving...' : 'Save'}
                      </button>
                      <button type="button" className="ledger-icon-button" onClick={cancelEditBlock}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <span>{block.name}</span>
                      <button type="button" className="ledger-icon-button" onClick={() => startEditBlock(block)}>Edit</button>
                      <button
                        type="button"
                        className="ledger-icon-button ledger-icon-button-danger"
                        onClick={() => handleDeleteBlock(block)}
                        disabled={blockActionBusyId === block.id}
                      >
                        {blockActionBusyId === block.id ? 'Removing...' : 'Delete'}
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>

            <form className="ledger-add-block-form" onSubmit={handleAddBlock}>
              <label htmlFor="block-name">Add a block</label>
              <div className="ledger-form-row">
                <input
                  id="block-name"
                  value={newBlockName}
                  onChange={(event) => {
                    setNewBlockName(event.target.value)
                    setBlockError('')
                  }}
                  placeholder="e.g., Block F"
                  maxLength="50"
                />
                <button type="submit" className="ledger-save-button" disabled={savingBlock}>
                  {savingBlock ? 'Saving...' : 'Add Block'}
                </button>
              </div>
              {blockError && <p className="ledger-form-error">{blockError}</p>}
            </form>

            <div className="ledger-modal-actions">
              <button type="button" className="ledger-cancel-button" onClick={() => setShowManageBlocks(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}