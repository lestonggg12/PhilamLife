import { notifySuccess } from '../lib/actionFeedback'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import Select from '../components/Select'
import AccountActivity from '../components/AccountActivity'
import './LedgerPage.css'
import { FileText, TrendingUp, AlertCircle, CreditCard } from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import { fetchAll } from '../lib/fetchAll'
import { buildLedgerStatement, ledgerStatementNotes, readableLedgerText } from '../lib/ledgerStatement'
import { summarizeLedgerEntries, verifiedLedgerAging, verifyLedgerSources } from '../lib/ledgerSummary'
import { matchesHomeownerSearch, useListPage } from '../lib/homeownerDirectory'
import { Pager } from '../components/PagerControls'
import { accountLedgerStatus } from '../lib/manualChargeDueDate'
import { useOrganization } from '../context/OrganizationContext'
import Skeleton from '../components/skeleton/Skeleton'

const SORT_COLUMNS = [
  { key: 'name', label: 'Homeowner' },
  { key: 'block', label: 'Block / Lot' },
  { key: 'dueAmount', label: 'Previous Balance' },
  { key: 'paidAmount', label: 'Last Payment Amount' },
  { key: 'balance', label: 'Outstanding Balance' },
  { key: 'lastPaymentSort', label: 'Last Payment' },
]

// Negative balances are advance credit — show them as credit, not as "-₱x".
const formatMoney = (value) => (value < 0 ? `${peso.format(-value)} for future bills` : peso.format(value))

// Avoid displaying the entire directory on an unfiltered page.
const MIN_SEARCH_LENGTH = 2

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
  if (a[key] == null || b[key] == null) return Number(a[key] == null) - Number(b[key] == null) || a.id - b.id
  let result = 0

  if (key === 'block') {
    result = a.block.localeCompare(b.block) || a.lotNumberRaw - b.lotNumberRaw
  } else if (typeof a[key] === 'number') {
    result = a[key] - b[key]
  } else {
    result = String(a[key]).localeCompare(String(b[key]))
  }

  return (direction === 'desc' ? -result : result) || a.id - b.id
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
  const [ledgerSources, setLedgerSources] = useState(null)
  const ledgerRequestRef = useRef(0)
  const [loading, setLoading] = useState(true)
  const [ledgerVerified, setLedgerVerified] = useState(false)
  const [pageError, setPageError] = useState('')
  const [orgSettings, setOrgSettings] = useState(null)
  const [statementPdfGenerating, setStatementPdfGenerating] = useState(false)

  const [statementAccount, setStatementAccount] = useState(null)
  const [statementLines, setStatementLines] = useState([])
  const [statementLoading, setStatementLoading] = useState(false)
  const [statementError, setStatementError] = useState('')
  const statementRequestRef = useRef(0)
  const closeStatement = () => {
    statementRequestRef.current += 1
    setStatementAccount(null)
    setStatementLines([])
    setStatementLoading(false)
  }

  const role = currentUser?.role?.trim().toLowerCase()

const canManageHomeowners =
  role === 'admin' || role === 'secretary'

const actorName =
  currentUser?.full_name ||
  currentUser?.name ||
  currentUser?.email ||
  'Staff member'
  useEffect(() => {
    loadLedger()
    resolveCurrentUser()
    return () => {
      ledgerRequestRef.current += 1
      statementRequestRef.current += 1
    }
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
    const requestId = ++ledgerRequestRef.current
    closeStatement()
    setLedgerVerified(false)
    setLoading(true)
    setPageError('')

    try {
      const [blocks, lots, payments, settings, aging, progress, financial] = await Promise.all([
        fetchAll(() => supabase.from('blocks').select('id, name').order('name')),
        fetchAll(() => supabase.from('properties')
          .select('id, block, lot_number, homeowner_name, homeowner_status, current_balance, opening_balance')
          .order('homeowner_name')),
        fetchAll(() => supabase.from('property_payment_summary')
          .select('property_id, total_paid, latest_previous_balance, latest_amount_paid, latest_paid_at')
          .order('property_id'), { tiebreaker: null }),
        supabase.from('system_settings').select('hoa_name, address').eq('id', 1).maybeSingle(),
        fetchAll(() => supabase.from('property_overdue_summary')
          .select('property_id, overdue_amount, current_amount, is_overdue, total_due, aging_complete')
          .order('property_id'), { tiebreaker: null }),
        fetchAll(() => supabase.from('property_payment_progress').select('property_id, has_partial_payment')
          .order('property_id'), { tiebreaker: null }),
        fetchAll(() => supabase.from('financial_invariant_report')
          .select('property_id, homeowner_status, stored_balance, opening_balance, active_charges')
          .order('property_id'), { tiebreaker: null }),
      ])
      if (requestId !== ledgerRequestRef.current) return
      const error = [blocks, lots, payments, settings, aging, progress, financial].find(result => result.error)?.error
      if (error) throw error
      if (!Array.isArray(blocks.data) || !settings.data) throw new Error('Ledger settings or block list are unavailable.')
      const sources = verifyLedgerSources(lots.data, financial.data, payments.data, aging.data, progress.data)

      setBlocks(blocks.data)
      setProperties(lots.data)
      setLedgerSources(sources)
      setOrgSettings(settings.data)
      setLedgerVerified(true)
    } catch (failure) {
      if (requestId === ledgerRequestRef.current) {
        setPageError(`Could not load the complete ledger: ${failure?.message || 'Connection failed.'}`)
      }
    } finally {
      if (requestId === ledgerRequestRef.current) setLoading(false)
    }
  }

  async function openStatement(entry) {
    if (!ledgerVerified || loading || pageError) return
    const requestId = ++statementRequestRef.current
    setStatementAccount(entry)
    setStatementError('')
    setStatementLines([])
    setStatementLoading(true)

    try {
      const [paymentResult, chargeResult, accountAdjustmentResult, enteredResult] = await Promise.all([
        fetchAll(() => supabase
          .from('payments')
          .select('id, paid_at, created_at, status, coverage_period, charge_type, reference_number, receipt_number, amount, amount_paid, balance_effect, effect_released, receipt_breakdown, payment_method, note, recorded_by_name')
          .eq('property_id', entry.id)
          .order('paid_at', { ascending: true })),
        fetchAll(() => supabase
          .from('property_charges')
          .select('id, created_at, charge_type, description, billing_month, due_date, amount, voided_at')
          .eq('property_id', entry.id)
          .order('created_at', { ascending: true })),
        fetchAll(() => supabase.from('account_adjustments')
          .select('id, charge_id, created_at, adjustment_type, balance_effect, reason, approval_reference, reversed_at')
          .eq('property_id', entry.id)
          .order('created_at')),
        fetchAll(() => supabase.from('balance_entries')
          .select('id, category, amount, as_of_date, description, created_at, voided_at')
          .eq('property_id', entry.id).order('created_at')),
      ])
      if (requestId !== statementRequestRef.current) return
      const allocationResult = (paymentResult.data || []).length ? await fetchAll(() => supabase
        .from('property_payment_allocations')
        .select('payment_id, property_charge_id, allocated_amount, payments!inner(property_id)')
        .eq('payments.property_id', entry.id))
        : { data: [], error: null }
      // Multiple historical reconciliations can exist for one property.
      const adjustmentResult = await fetchAll(() => supabase
        .from('moved_account_reconciliations')
        .select('adjustment_amount, reason')
        .eq('property_id', entry.id))
      const lotResult = await supabase.from('properties')
        .select('id, current_balance, opening_balance, opening_balance_as_of, opening_balance_note')
        .eq('id', entry.id).maybeSingle()
      if (requestId !== statementRequestRef.current) return
      const error = paymentResult.error
        || lotResult.error
        || accountAdjustmentResult.error
        || enteredResult.error
        || (!lotResult.data ? { message: 'This lot is no longer available.' } : null)
        || chargeResult.error
        || allocationResult.error
        || adjustmentResult.error

      if (error) {
        setStatementError(`Could not load history: ${error.message}`)
        setStatementLoading(false)
        return
      }

      if (![paymentResult, chargeResult, accountAdjustmentResult, enteredResult, allocationResult, adjustmentResult]
        .every(result => Array.isArray(result.data))) {
        throw new Error('The statement sources returned incomplete results.')
      }
      const allocationsByPayment = new Map()
      for (const allocation of allocationResult.data || []) {
        const list = allocationsByPayment.get(allocation.payment_id) || []
        list.push(allocation)
        allocationsByPayment.set(allocation.payment_id, list)
      }
      const payments = (paymentResult.data || []).map((payment) => ({
        ...payment,
        allocations: allocationsByPayment.get(payment.id) || [],
      }))
      const statement = buildLedgerStatement({
        payments,
        charges: chargeResult.data || [],
        adjustments: accountAdjustmentResult.data,
        balanceEntries: enteredResult.data,
        storedBalance: lotResult.data.current_balance,
        openingBalance: lotResult.data.opening_balance,
        openingBalanceNote: lotResult.data.opening_balance_note,
        openingBalanceAsOf: lotResult.data.opening_balance_as_of,
      })
      const closingCorrections = adjustmentResult.data
      const savedBalance = statement.totals.storedBalance
      setStatementAccount(current => current ? {
        ...current,
        statementTotals: statement.totals,
        balance: Math.max(savedBalance, 0),
        unallocatedCredit: Math.max(-savedBalance, 0),
        closingAdjustment: closingCorrections.reduce((sum, item) => sum + Number(item.adjustment_amount), 0),
        closingAdjustmentReason: closingCorrections.map(item => readableLedgerText(item.reason)).filter(Boolean).join(' '),
      } : current)
      setStatementLines(statement.lines)
      setStatementLoading(false)
    } catch (failure) {
      if (requestId !== statementRequestRef.current) return
      setStatementError(`Could not load history: ${failure?.message || 'Connection failed.'}`)
      setStatementLoading(false)
    }
  }
  async function downloadStatementPdf() {
    if (!statementAccount) return
    if (!ledgerVerified || loading || pageError || !statementAccount.statementTotals?.canExport) {
      setStatementError('PDF export requires a verified starting balance and a matching closing balance.')
      return
    }
    const requestId = statementRequestRef.current
    setStatementPdfGenerating(true)

    try {
      const now = new Date()
      const rows = statementLines.map((line) => ({
        date: line.transaction_date ? organization.formatDate(line.transaction_date, { withTime: line.kind !== 'opening' }) : '—',
        entry: [line.description, ...(line.details || [])].join('\n'),
        reference: line.reference_number || '—',
        debit: Number(line.debit) || 0,
        credit: Number(line.credit) || 0,
        balance: Number(line.running_balance) || 0,
      }))
      
      const { buildHomeownerStatementPdf } = await import('../lib/homeownerStatementPdf')
      if (requestId !== statementRequestRef.current) return
      const doc = buildHomeownerStatementPdf({
        hoaName: orgSettings?.hoa_name || 'Homeowners Association',
        hoaAddress: orgSettings?.address || '',
        homeownerName: statementAccount.name,
        blockLotLabel: `${statementAccount.block}, ${statementAccount.lot}`,
        totalCharges: statementAccount.statementTotals.addedCharges,
        enteredBalances: statementAccount.statementTotals.enteredBalances,
        openingBalance: statementAccount.statementTotals?.openingBalance ?? 0,
        annualDiscountCredit: statementAccount.statementTotals?.annualDiscountCredit ?? 0,
        otherAdjustments: statementAccount.statementTotals?.netOtherAdjustments ?? 0,
        totalDebits: statementAccount.statementTotals?.totalDebits ?? 0,
        totalCredits: statementAccount.statementTotals?.totalCredits ?? 0,
        closingBalance: statementAccount.statementTotals?.finalBalance ?? 0,
        paymentsAllocated: statementAccount.statementTotals?.payments ?? statementAccount.paidAmount,
        paymentsLabel: 'Payments received',
        outstandingBalance: statementAccount.balance,
        availableCredit: statementAccount.unallocatedCredit || 0,
        reconciliationNote: [
          ...ledgerStatementNotes(statementAccount.statementTotals, (value) => `PHP ${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`),
          statementAccount.closingAdjustment
            ? `Balance correction recorded after the owner moved: PHP ${Number(statementAccount.closingAdjustment).toFixed(2)}. This note does not add a charge or payment.${statementAccount.closingAdjustmentReason ? ` ${statementAccount.closingAdjustmentReason}` : ''}`
            : '',
        ].filter(Boolean).join('\n'),
        statementLines: rows,
        preparedBy: actorName,
        datePrepared: organization.formatDate(now),
        timePrepared: timeOfDay.format(now),
      })

      doc.save(`Statement-${statementAccount.name.replace(/\s+/g, '-')}-${organization.formatDate(now).replace(/[,\s\/]/g, '-')}.pdf`)
      notifySuccess(`Statement PDF download started for ${statementAccount.name}.`)
    } catch (error) {
      if (requestId !== statementRequestRef.current) return
      setStatementError(`Could not generate statement PDF: ${error?.message || 'Unknown error.'}`)
    } finally {
      setStatementPdfGenerating(false)
    }
  }

  const ledgerEntries = useMemo(() => {
    if (!ledgerSources) return []
    const { financial, payment, aging, paymentProgress } = ledgerSources
    return properties.filter(property => (property.homeowner_status || 'active') === 'active').map(property => {
      const id = String(property.id)
      const summary = payment.get(id)
      const stored = Number(property.current_balance)
      const late = aging.get(id)
      const agingVerified = verifiedLedgerAging(stored, late)
      const status = accountLedgerStatus({
        balance: stored, agingComplete: agingVerified, isOverdue: late.is_overdue,
        hasPartialPayment: paymentProgress.get(id)?.has_partial_payment === true,
      })
      return {
        id: property.id, name: property.homeowner_name, block: property.block,
        lot: `Lot ${property.lot_number}`, lotNumberRaw: property.lot_number,
        dueAmount: summary?.latest_previous_balance == null ? null : Number(summary.latest_previous_balance),
        paidAmount: summary?.latest_amount_paid == null ? null : Number(summary.latest_amount_paid),
        totalPaid: summary?.total_paid ?? 0,
        recordedCharges: financial.get(id).active_charges,
        opening_balance: financial.get(id).opening_balance,
        balance: Math.max(stored, 0),
        unallocatedCredit: Math.max(-stored, 0),
        overdueAmount: agingVerified ? Number(late.overdue_amount) : null,
        currentAmount: agingVerified ? Number(late.current_amount) : null,
        lastPayment: summary?.latest_paid_at ? organization.formatDate(summary.latest_paid_at) : '—',
        lastPaymentSort: summary?.latest_paid_at ? new Date(summary.latest_paid_at).getTime() : null,
        status: status === 'Paid' ? 'No balance due' : status,
      }
    })
  }, [properties, ledgerSources, organization])

  const term = normalize(search).length >= MIN_SEARCH_LENGTH ? search.trim() : ''
  const hasActiveQuery = Boolean(term) || blockFilter !== 'all' || statusFilter !== 'all'
  const filtered = useMemo(() => ledgerEntries.filter(entry =>
    (blockFilter === 'all' || entry.block === blockFilter) &&
    (statusFilter === 'all' || entry.status === statusFilter) &&
    matchesHomeownerSearch({ homeowner_name: entry.name, block: entry.block, lot_number: entry.lotNumberRaw }, term)
  ), [ledgerEntries, term, blockFilter, statusFilter])
  const sorted = useMemo(() => [...filtered].sort((a, b) => compareEntries(a, b, sortConfig.key, sortConfig.direction)), [filtered, sortConfig])
  const ledgerPage = useListPage(sorted, [term, blockFilter, statusFilter, sortConfig.key, sortConfig.direction])
  const filteredTotals = useMemo(() => {
    try { return summarizeLedgerEntries(filtered) } catch { return null }
  }, [filtered])

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

      <div className="ledger-summary-grid">
        <div className="ledger-summary-card glass-card">
          <div className="ledger-summary-top"><p className="ledger-summary-label">Total Billed</p><div className="ledger-summary-icon ledger-summary-icon-due"><FileText size={18} /></div></div>
          <p className="ledger-summary-value">{loading ? 'Loading...' : !ledgerVerified || pageError || !filteredTotals ? 'Unavailable' : peso.format(filteredTotals.totalDue)}</p>
          <small>Adjusted posted charges and positive opening balances</small>
        </div>
        <div className="ledger-summary-card glass-card">
          <div className="ledger-summary-top"><p className="ledger-summary-label">Total Collected</p><div className="ledger-summary-icon ledger-summary-icon-paid"><TrendingUp size={18} /></div></div>
          <p className="ledger-summary-value">{loading ? 'Loading...' : !ledgerVerified || pageError || !filteredTotals ? 'Unavailable' : peso.format(filteredTotals.totalPaid)}</p>
          <small>Recorded HOA payments for matching lots</small>
        </div>
        <div className="ledger-summary-card glass-card">
          <div className="ledger-summary-top"><p className="ledger-summary-label">Outstanding</p><div className="ledger-summary-icon ledger-summary-icon-balance"><AlertCircle size={18} /></div></div>
          <p className="ledger-summary-value">{loading ? 'Loading...' : !ledgerVerified || pageError || !filteredTotals ? 'Unavailable' : peso.format(filteredTotals.totalBalance)}</p>
          <small>Balance due in the filtered ledger</small>
        </div>
        <div className="ledger-summary-card glass-card">
          <div className="ledger-summary-top"><p className="ledger-summary-label">Available Credit</p><div className="ledger-summary-icon ledger-summary-icon-paid"><CreditCard size={18} /></div></div>
          <p className="ledger-summary-value">{loading ? 'Loading...' : !ledgerVerified || pageError || !filteredTotals ? 'Unavailable' : peso.format(filteredTotals.totalCredit)}</p>
          <small>Advance credit in the filtered ledger</small>
        </div>
      </div>
      {ledgerVerified && !filteredTotals && <p className="ledger-load-error" role="alert">These ledger totals exceed the supported range.</p>}

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
        <Select ariaLabel="Filter by block" value={blockFilter} onChange={setBlockFilter} disabled={loading} options={[{ value: 'all', label: loading ? 'Loading blocks...' : 'All Blocks' }, ...blocks.map((block) => ({ value: block.name, label: block.name }))]} />
        <Select ariaLabel="Filter by status" value={statusFilter} onChange={setStatusFilter} options={['all', 'No balance due', 'Partially Paid', 'Pending', 'Overdue', 'Review'].map((status) => ({ value: status, label: status === 'all' ? 'All Statuses' : status }))} />
        {hasActiveQuery && (
          <span className="ledger-result-count">
            {ledgerVerified && !pageError ? `${sorted.length} match${sorted.length === 1 ? '' : 'es'}` : '—'}
          </span>
        )}
      </div>

      {loading ? (
        <div className="ledger-table-wrap glass-card">
          <div className="ledger-empty" aria-busy="true"><Skeleton variant="rect" width="100%" height="44px" /><Skeleton variant="rect" width="100%" height="44px" /><Skeleton variant="rect" width="100%" height="44px" /><Skeleton variant="rect" width="100%" height="44px" /><Skeleton variant="rect" width="100%" height="44px" /><Skeleton variant="rect" width="100%" height="44px" /><span className="skeleton-region-status" role="status">Loading</span></div>
        </div>
      ) : !ledgerVerified || pageError ? (
        <div className="ledger-search-prompt glass-card" role="alert">
          <AlertCircle size={30} aria-hidden="true" />
          <h3>Ledger unavailable</h3>
          <p>The complete ledger could not be verified. Refresh before viewing homeowner accounts or generating statements.</p>
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
          <table className="ledger-table" aria-label="Homeowner accounts">
            <thead>
              <tr>
                {SORT_COLUMNS.map((column) => (
                  <th key={column.key} className="ledger-th-sortable" scope="col">
                    <button type="button" className="ledger-column-sort" onClick={() => toggleSort(column.key)}>
                    {column.label}{sortIndicator(column.key)}</button>
                  </th>
                ))}
                <th scope="col">Available Credit</th>
                <th className="ledger-actions-heading" aria-label="Actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {ledgerPage.rows.map((entry) => (
                <tr key={entry.id}>
                  <td data-label="Homeowner">
                    <span className="ledger-homeowner-name">
                      <strong>{entry.name}</strong>
                      <span className={`ledger-badge ledger-badge-${entry.status === 'No balance due' ? 'paid' : entry.status.toLowerCase().replace(/\s+/g, '-')}`}>{entry.status}</span>
                    </span>
                  </td>
                  <td data-label="Block / Lot">{entry.block}, {entry.lot}</td>
                  <td data-label="Previous balance">{entry.dueAmount == null ? '—' : formatMoney(entry.dueAmount)}</td>
                  <td data-label="Last payment amount">{entry.paidAmount == null ? '—' : peso.format(entry.paidAmount)}</td>
                  <td data-label="Outstanding balance" className={entry.balance > 0 ? 'ledger-balance-due' : ''}>{peso.format(entry.balance)}{entry.overdueAmount > 0 && entry.currentAmount > 0 && <small className="ledger-aging-note">Overdue {peso.format(entry.overdueAmount)} · Current {peso.format(entry.currentAmount)}</small>}</td>
                  <td data-label="Last payment date">{entry.lastPayment}</td>
                  <td data-label="Available credit" className={entry.unallocatedCredit > 0 ? 'ledger-credit' : ''}>{entry.unallocatedCredit > 0 ? peso.format(entry.unallocatedCredit) : '—'}</td>
                  <td className="ledger-row-actions">
                    <div className="ledger-actions-card">
                      <button aria-label={`View statement for ${entry.name}, ${entry.block}, ${entry.lot}`} className="ledger-statement-button" type="button" onClick={() => openStatement(entry)}>Statement</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={ledgerPage.page} total={sorted.length} onPageChange={ledgerPage.setPage} />
        </div>
      )}

      {statementAccount && (
        <div className="ledger-modal-backdrop" onMouseDown={closeStatement}>
          <article className="ledger-statement-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="ledger-modal-heading">
              <div><p className="ledger-statement-kicker">Homeowner statement</p><h2>{statementAccount.name}</h2><p>{statementAccount.block}, {statementAccount.lot}</p></div>
              <button type="button" className="ledger-modal-close" onClick={closeStatement} aria-label="Close">×</button>
            </div>
            {!statementLoading && !statementError && statementAccount.statementTotals && (
              <>
                <div className="ledger-statement-summary">
                  <div><span>Starting balance</span><strong>{formatMoney(statementAccount.statementTotals.openingBalance)}</strong></div>
                  <div><span>New charges</span><strong>{peso.format(statementAccount.statementTotals.addedCharges)}</strong></div>
                  {statementAccount.statementTotals.enteredBalances > 0 && <div><span>Entered balances</span><strong>{peso.format(statementAccount.statementTotals.enteredBalances)}</strong></div>}
                  <div><span>Payments received</span><strong>{peso.format(statementAccount.statementTotals.payments)}</strong></div>
                  <div><span>Discount: 1 month free</span><strong>{peso.format(statementAccount.statementTotals.annualDiscountCredit)}</strong></div>
                  <div><span>Amount still owed</span><strong>{peso.format(statementAccount.balance)}</strong></div>
                  <div><span>Amount available for future bills</span><strong>{peso.format(statementAccount.unallocatedCredit || 0)}</strong></div>
                  {statementAccount.statementTotals.netOtherAdjustments !== 0 && (
                    <div><span>Other balance changes</span><strong>{peso.format(statementAccount.statementTotals.netOtherAdjustments)}</strong></div>
                  )}
                </div>
                <p className="ledger-form-note">This statement shows changes to this lot’s balance. Cancelled entries and entries with no effect are omitted. Dates are in Philippine time. Credit for future bills can cover later charges.</p>
                {ledgerStatementNotes(statementAccount.statementTotals, (value) => peso.format(value)).map((note) => (
                  <p className="ledger-form-note" key={note}>{note}</p>
                ))}
                {statementAccount.closingAdjustment !== 0 && (
                  <p className="ledger-form-note">
                    After the owner moved, a balance correction of {peso.format(statementAccount.closingAdjustment)} was recorded. This note does not add a charge or payment.
                    {statementAccount.closingAdjustmentReason ? ` ${statementAccount.closingAdjustmentReason}` : ''}
                  </p>
                )}
              </>
            )}
            {statementError && <p className="ledger-form-error">{statementError}</p>}
            <div className="ledger-statement-lines">
              <table role="table" aria-label="Lot account statement">
                <colgroup>
                  <col className="statement-column-date" />
                  <col className="statement-column-entry" />
                  <col className="statement-column-reference" />
                  <col className="statement-column-money" />
                  <col className="statement-column-money" />
                  <col className="statement-column-money" />
                </colgroup>
                <thead><tr><th scope="col">Date recorded</th><th scope="col">What happened</th><th scope="col">Receipt / reference</th><th scope="col">Amount added</th><th scope="col">Amount deducted</th><th scope="col">Balance after this entry</th></tr></thead>
                <tbody>
                  {statementLoading ? <tr><td colSpan="6" className="ledger-empty">Loading statement…</td></tr> : statementLines.length === 0 ? <tr><td colSpan="6" className="ledger-empty">{statementError ? 'Statement history unavailable.' : 'No recorded entries changed this lot’s balance.'}</td></tr> : statementLines.map((line, index) => (
                    <tr role="row" key={line.id || `${line.transaction_date}-${index}`} className={line.kind === 'annual-discount' ? 'ledger-statement-discount' : ''}>
                      <td role="cell" data-label="Date recorded">{line.transaction_date ? organization.formatDate(line.transaction_date, { withTime: line.kind !== 'opening' }) : '—'}</td>
                      <td role="cell" data-label="What happened"><strong>{line.description}</strong>{(line.details || []).map((detail) => <small className="ledger-statement-detail" key={detail}>{detail}</small>)}</td>
                      <td role="cell" data-label="Receipt / reference">{line.reference_number || '—'}</td>
                      <td role="cell" data-label="Amount added">{peso.format(Number(line.debit) || 0)}</td>
                      <td role="cell" data-label="Amount deducted">{peso.format(Number(line.credit) || 0)}</td>
                      <td role="cell" data-label="Balance after this entry">{line.running_balance == null ? '—' : formatMoney(line.running_balance)}</td>
                    </tr>
                  ))}
                </tbody>
                {!statementLoading && !statementError && statementAccount.statementTotals && (
                  <tfoot><tr>
                    <th colSpan="3">Totals / final balance</th>
                    <td data-label="Total added">{peso.format(statementAccount.statementTotals.totalDebits)}</td>
                    <td data-label="Total deducted">{peso.format(statementAccount.statementTotals.totalCredits)}</td>
                    <td data-label="Final balance">{formatMoney(statementAccount.statementTotals.finalBalance)}</td>
                  </tr></tfoot>
                )}
              </table>
            </div>
            {!statementLoading && !statementError && statementAccount && <AccountActivity propertyId={statementAccount.id} />}
            <div className="ledger-modal-actions"><button type="button" className="ledger-cancel-button" onClick={closeStatement}>Close</button><button type="button" className="ledger-save-button" onClick={downloadStatementPdf} disabled={statementLoading || Boolean(statementError) || statementPdfGenerating || !ledgerVerified || loading || Boolean(pageError) || !statementAccount.statementTotals?.canExport}>{statementPdfGenerating ? 'Generating…' : 'Print / Save PDF'}</button></div>
          </article>
        </div>
      )}

    </div>
  )
}