import { notifySuccess } from '../lib/actionFeedback'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import Select from '../components/Select'
import AccountActivity from '../components/AccountActivity'
import { annotateLedgerStatementEvidence } from '../lib/ledgerAuditAnnotations'
import './LedgerPage.css'
import { BookOpen, ArrowDownLeft, ClockAlert, WalletCards, AlertCircle, Search, RefreshCw, ChevronDown, ChevronRight, X, Printer, Info } from 'lucide-react'
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


const ledgerStatusClass = status => ({
  'No balance due': 'clear', Overdue: 'overdue', 'Partially Paid': 'partial', Pending: 'pending', Review: 'pending',
}[status] || 'pending')

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
  const [statementTab, setStatementTab] = useState('transactions')
  const [statementSearch, setStatementSearch] = useState('')
  const statementModalRef = useRef(null)
  const statementCloseRef = useRef(null)
  const statementIsOpen = Boolean(statementAccount)
  const visibleStatementLines = useMemo(() => {
    const query = normalize(statementSearch)
    return query ? statementLines.filter(line => [line.description, line.reference_number, ...(line.details || [])].join(' ').toLowerCase().includes(query)) : statementLines
  }, [statementLines, statementSearch])

  useEffect(() => {
    if (!statementIsOpen) return undefined
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    statementCloseRef.current?.focus()
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        statementRequestRef.current += 1
        setStatementAccount(null)
        setStatementLines([])
        setStatementLoading(false)
        return
      }
      if (event.key !== 'Tab') return
      const nodes = [...(statementModalRef.current?.querySelectorAll('button, input, select, summary, a[href], [tabindex="0"]') || [])].filter(node => !node.disabled && node.getClientRects().length > 0)
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [statementIsOpen])

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
    setStatementTab('transactions')
    setStatementSearch('')
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
      // Saved audit evidence enriches original rows. It NEVER changes their
      // amounts, dates, running balances, or verified statement totals.
      const auditResult = await fetchAll(() => supabase.from('account_activity')
        .select('id,kind,payload')
        .eq('property_id', entry.id)
        .in('kind', ['credit_applied', 'monthly_balance_added', 'penalty_applied', 'penalty_collected']))
      if (requestId !== statementRequestRef.current) return
      if (auditResult.error || !Array.isArray(auditResult.data)) {
        throw new Error(`Financial audit evidence could not be verified: ${auditResult.error?.message || 'Incomplete results.'}`)
      }
      const annotatedLines = annotateLedgerStatementEvidence(statement.lines, auditResult.data)
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
      setStatementLines(annotatedLines)
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
    <div className="ledger-page ledger-redesign">
      <section className="hero">
        <div className="hero-title">
          <div className="hero-mark"><BookOpen size={24} aria-hidden="true" /></div>
          <div>
            <div className="eyebrow">{(role || 'staff').toUpperCase()} WORKSPACE</div>
            <h1>Homeowner ledger</h1>
            <p className="muted">Find an account, review its balance, and open its statement.</p>
          </div>
        </div>
        <button className="button" type="button" onClick={loadLedger} disabled={loading}>
          <RefreshCw size={18} aria-hidden="true" /><span>{loading ? 'Refreshing…' : 'Refresh'}</span>
        </button>
      </section>

      {pageError && <p className="load-error" role="alert">{pageError}</p>}
      <section className="stats" aria-label="Totals for matching accounts">
        {[
          { label: 'Total billed', value: filteredTotals?.totalDue, icon: BookOpen, note: 'Adjusted posted charges and positive opening balances' },
          { label: 'Total collected', value: filteredTotals?.totalPaid, icon: ArrowDownLeft, note: 'Recorded HOA payments for matching lots' },
          { label: 'Outstanding', value: filteredTotals?.totalBalance, icon: ClockAlert, note: 'Amount still owed by matching accounts' },
          { label: 'Available credit', value: filteredTotals?.totalCredit, icon: WalletCards, note: 'Available for future bills on matching lots' },
        ].map(({ label, value, icon: Icon, note }) => (
          <div className="stat" key={label}>
            <div className="stat-top"><span className="label">{label}</span><span className="stat-icon"><Icon size={18} aria-hidden="true" /></span></div>
            <strong className="ledger-summary-value">{loading ? 'Loading…' : !ledgerVerified || pageError || !filteredTotals ? 'Unavailable' : peso.format(value)}</strong>
            <small>{note}</small>
          </div>
        ))}
      </section>
      {ledgerVerified && !filteredTotals && <p className="load-error" role="alert">These ledger totals exceed the supported range.</p>}

      <section className="panel" aria-labelledby="accounts-heading">
        <div className="panel-head">
          <div><h2 id="accounts-heading">Homeowner accounts</h2><p className="muted">Balances and payment history, organized by property.</p></div>
          {ledgerVerified && !loading && !pageError && <span className="badge">{ledgerEntries.length} active properties</span>}
        </div>
        <div className="filters">
          <label className="search"><Search size={18} aria-hidden="true" /><input aria-label="Search accounts by name, block, or lot" type="search" placeholder="Search name, block, or lot" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <Select ariaLabel="Filter by block" value={blockFilter} onChange={setBlockFilter} disabled={loading} options={[{ value: 'all', label: loading ? 'Loading blocks…' : 'All blocks' }, ...blocks.map(block => ({ value: block.name, label: block.name }))]} />
          <div className="tabs" role="group" aria-label="Filter accounts by status">
            {[
              ['all', 'All'], ['Overdue', 'Overdue'], ['Partially Paid', 'Partial'], ['Pending', 'Pending'], ['No balance due', 'No balance due'], ['Review', 'Review'],
            ].map(([value, label]) => <button key={value} type="button" className={statusFilter === value ? 'active' : ''} aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}>{label}</button>)}
          </div>
        </div>
        <div className="resultline">
          <span aria-live="polite">{loading ? 'Loading accounts…' : !ledgerVerified || pageError ? 'Accounts unavailable' : hasActiveQuery ? `${sorted.length} matching account${sorted.length === 1 ? '' : 's'}` : `Search with at least ${MIN_SEARCH_LENGTH} characters, or choose a block or status.`}</span>
          {hasActiveQuery && <button className="text-button" type="button" onClick={() => { setSearch(''); setBlockFilter('all'); setStatusFilter('all') }}>Reset filters</button>}
        </div>

        {loading ? (
          <div className="empty" aria-busy="true"><Skeleton variant="rect" width="100%" height="44px" /><Skeleton variant="rect" width="100%" height="44px" /><span role="status">Loading homeowner accounts…</span></div>
        ) : !ledgerVerified || pageError ? (
          <div className="empty" role="alert"><AlertCircle size={30} aria-hidden="true" /><h3>Ledger unavailable</h3><p>The complete ledger could not be verified. Refresh before viewing accounts or generating statements.</p></div>
        ) : !hasActiveQuery ? (
          <div className="empty"><Search size={34} aria-hidden="true" /><h3>Find a homeowner account</h3><p>Type at least {MIN_SEARCH_LENGTH} characters of a name, block, or lot, or choose a filter above. Search first to keep large directories fast.</p></div>
        ) : sorted.length === 0 ? (
          <div className="empty"><Search size={30} aria-hidden="true" /><h3>No matching accounts</h3><p>Try a different name, block, or lot, or reset the filters.</p></div>
        ) : (
          <>
            <div className="table-scroll">
              <table aria-label="Homeowner accounts">
                <thead><tr>
                  <th scope="col" aria-sort={sortConfig.key === 'name' ? sortConfig.direction === 'asc' ? 'ascending' : 'descending' : 'none'}><button className="sort-button" type="button" onClick={() => toggleSort('name')}>Homeowner {sortIndicator('name')}</button></th>
                  <th scope="col">Status</th>
                  <th scope="col" className="right" aria-sort={sortConfig.key === 'balance' ? sortConfig.direction === 'asc' ? 'ascending' : 'descending' : 'none'}><button className="sort-button" type="button" onClick={() => toggleSort('balance')}>Outstanding {sortIndicator('balance')}</button></th>
                  <th scope="col" className="right">Available credit</th>
                  <th scope="col" aria-sort={sortConfig.key === 'lastPaymentSort' ? sortConfig.direction === 'asc' ? 'ascending' : 'descending' : 'none'}><button className="sort-button" type="button" onClick={() => toggleSort('lastPaymentSort')}>Last payment {sortIndicator('lastPaymentSort')}</button></th>
                  <th scope="col" className="right">Statement</th>
                </tr></thead>
                <tbody>{ledgerPage.rows.map(entry => (
                  <tr key={entry.id}>
                    <td><div className="person"><span className="avatar" aria-hidden="true">{entry.name?.trim().charAt(0).toUpperCase() || '?'}</span><div><strong>{entry.name}</strong><span className="sub">{entry.block} · {entry.lot}</span><details className="row-notes"><summary>Balance details <ChevronDown size={12} aria-hidden="true" /></summary><p>Previous balance: {entry.dueAmount == null ? '—' : formatMoney(entry.dueAmount)}<br />{SORT_COLUMNS.find(column => column.key === 'paidAmount').label}: {entry.paidAmount == null ? '—' : peso.format(entry.paidAmount)}</p></details></div></div></td>
                    <td><span className={`status ${ledgerStatusClass(entry.status)}`}>{entry.status}</span></td>
                    <td className={`right money ${entry.balance > 0 ? 'red' : ''}`}>{peso.format(entry.balance)}{entry.overdueAmount > 0 && entry.currentAmount > 0 && <span className="sub">Overdue {peso.format(entry.overdueAmount)}<br />Current {peso.format(entry.currentAmount)}</span>}</td>
                    <td className={`right money ${entry.unallocatedCredit > 0 ? 'green' : ''}`}>{entry.unallocatedCredit > 0 ? peso.format(entry.unallocatedCredit) : '—'}</td>
                    <td>{entry.lastPayment}{entry.paidAmount != null && <span className="sub">Last receipt: {peso.format(entry.paidAmount)}</span>}</td>
                    <td className="right"><button className="view" type="button" aria-label={`View statement for ${entry.name}, ${entry.block}, ${entry.lot}`} onClick={() => openStatement(entry)}>View <ChevronRight size={14} aria-hidden="true" /></button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="panel-foot"><span>Account balances · PHP</span><Pager page={ledgerPage.page} total={sorted.length} onPageChange={ledgerPage.setPage} /></div>
          </>
        )}
      </section>
      <p className="note"><Info size={15} aria-hidden="true" />Summary cards reflect your current filters. Open a statement for the full balance breakdown.</p>

      {statementAccount && (
        <div className="overlay" onMouseDown={event => { if (event.target === event.currentTarget) closeStatement() }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="ledger-statement-name" ref={statementModalRef}>
            <header className="modal-head">
              <div><div className="eyebrow">Homeowner statement</div><h2 id="ledger-statement-name">{statementAccount.name}</h2><div className="head-meta"><span>{statementAccount.block} · {statementAccount.lot}</span><span className={`status ${ledgerStatusClass(statementAccount.status)}`}>{statementAccount.status}</span></div></div>
              <button className="icon-button" type="button" onClick={closeStatement} aria-label="Close statement" ref={statementCloseRef}><X size={18} aria-hidden="true" /></button>
            </header>
            <div className="modal-body">
              {statementError && <p className="load-error" role="alert">{statementError}</p>}
              {statementLoading ? <div className="empty" role="status"><Skeleton variant="rect" width="100%" height="80px" />Loading statement…</div> : !statementError && statementAccount.statementTotals && (
                <>
                  <section className="statement-summary" aria-label="Statement totals">
                    <div className="statement-stat focus"><span className="label">Amount still owed</span><strong>{peso.format(statementAccount.balance)}</strong><small>{statementAccount.balance > 0 ? 'Outstanding on this property' : 'No amount currently owed'}</small></div>
                    <div className="statement-stat"><span className="label">Available credit</span><strong className="green">{peso.format(statementAccount.unallocatedCredit || 0)}</strong><small>For future bills on this property</small></div>
                    <div className="statement-stat"><span className="label">Payments received</span><strong>{peso.format(statementAccount.statementTotals.payments)}</strong><small>Recorded payments in this statement</small></div>
                  </section>
                  <details className="statement-disclosure"><summary>How this balance was calculated <ChevronDown size={16} aria-hidden="true" /></summary><div className="breakdown">
                    <div><span>Starting balance</span><strong>{formatMoney(statementAccount.statementTotals.openingBalance)}</strong></div>
                    <div><span>New charges</span><strong>{peso.format(statementAccount.statementTotals.addedCharges)}</strong></div>
                    <div><span>Entered balances</span><strong>{peso.format(statementAccount.statementTotals.enteredBalances || 0)}</strong></div>
                    <div><span>Discount: 1 month free</span><strong>{peso.format(statementAccount.statementTotals.annualDiscountCredit)}</strong></div>
                    {statementAccount.statementTotals.netOtherAdjustments !== 0 && <div><span>Other balance changes</span><strong>{peso.format(statementAccount.statementTotals.netOtherAdjustments)}</strong></div>}
                  </div></details>
                  <details className="statement-disclosure"><summary>Statement notes & payment allocation <ChevronDown size={16} aria-hidden="true" /></summary><div className="notes-content">
                    <p>This statement shows changes to this lot’s balance. Cancelled entries and entries with no effect are omitted. Dates are in Philippine time. Credit for future bills can cover later charges.</p>
                    {ledgerStatementNotes(statementAccount.statementTotals, value => peso.format(value)).map(note => <p key={note}>{note}</p>)}
                    {statementAccount.closingAdjustment !== 0 && <p>After the owner moved, a balance correction of {peso.format(statementAccount.closingAdjustment)} was recorded. This note does not add a charge or payment.{statementAccount.closingAdjustmentReason ? ` ${statementAccount.closingAdjustmentReason}` : ''}</p>}
                  </div></details>
                  <div className="statement-toolbar">
                    <div className="tabs" role="group" aria-label="Statement view"><button type="button" className={statementTab === 'transactions' ? 'active' : ''} aria-pressed={statementTab === 'transactions'} onClick={() => setStatementTab('transactions')}>Transactions</button><button type="button" className={statementTab === 'activity' ? 'active' : ''} aria-pressed={statementTab === 'activity'} onClick={() => setStatementTab('activity')}>Activity history</button></div>
                    {statementTab === 'transactions' && <label className="search"><Search size={17} aria-hidden="true" /><input aria-label="Search statement entries or references" type="search" placeholder="Find entry or reference" value={statementSearch} onChange={event => setStatementSearch(event.target.value)} /></label>}
                  </div>
                  <div hidden={statementTab !== 'transactions'}>
                    <div className="statement-table"><div className="table-scroll"><table aria-label="Lot account statement"><thead><tr><th scope="col">Date recorded</th><th scope="col">Entry</th><th scope="col">Receipt / reference</th><th scope="col" className="right">Added</th><th scope="col" className="right">Deducted</th><th scope="col" className="right">Balance after</th></tr></thead>
                      <tbody>{visibleStatementLines.length === 0 ? <tr><td colSpan="6" className="empty">{statementLines.length ? 'No matching entries. Try another description or reference.' : 'No recorded entries changed this lot’s balance.'}</td></tr> : visibleStatementLines.map((line, index) => (
                        <tr key={line.id || `${line.transaction_date}-${index}`}>
                          <td>{line.transaction_date ? organization.formatDate(line.transaction_date, { withTime: line.kind !== 'opening' }) : '—'}</td>
                          <td><div className="entry-title">{line.description}</div>{(line.details || []).length > 0 && <details className="row-notes"><summary>Details <ChevronDown size={12} aria-hidden="true" /></summary>{line.details.map(detail => <p key={detail}>{detail}</p>)}</details>}</td>
                          <td className="ref">{line.reference_number || '—'}</td>
                          <td className="right money">{peso.format(Number(line.debit) || 0)}</td>
                          <td className="right money green">{peso.format(Number(line.credit) || 0)}</td>
                          <td className="right money">{line.running_balance == null ? '—' : formatMoney(line.running_balance)}</td>
                        </tr>
                      ))}</tbody>
                      {!statementSearch.trim() && <tfoot><tr><td colSpan="3">Statement totals / closing balance</td><td className="right">{peso.format(statementAccount.statementTotals.totalDebits)}</td><td className="right">{peso.format(statementAccount.statementTotals.totalCredits)}</td><td className="right">{formatMoney(statementAccount.statementTotals.finalBalance)}</td></tr></tfoot>}
                    </table></div><div className="credit-line"><span>Amount available for future bills</span><strong>{peso.format(statementAccount.unallocatedCredit || 0)}</strong></div></div>
                    <p className="statement-hint">{statementSearch.trim() ? `Showing ${visibleStatementLines.length} of ${statementLines.length} entries. Running balances and the summary reflect the full statement.` : `Showing all ${statementLines.length} entries in statement order. Amounts are in PHP; dates use Philippine time.`}</p>
                  </div>
                  <div className="statement-activity" hidden={statementTab !== 'activity'}><AccountActivity propertyId={statementAccount.id} /></div>
                </>
              )}
            </div>
            <footer className="modal-footer"><small>PHP · Philippine time · Homeowner statement</small><div className="footer-actions"><button type="button" className="button" onClick={closeStatement}>Close statement</button><button type="button" className="button primary" onClick={downloadStatementPdf} disabled={statementLoading || Boolean(statementError) || statementPdfGenerating || !ledgerVerified || loading || Boolean(pageError) || !statementAccount.statementTotals?.canExport}><Printer size={16} aria-hidden="true" />{statementPdfGenerating ? 'Generating…' : 'Print / Save PDF'}</button></div></footer>
          </section>
        </div>
      )}
    </div>
  )
}
