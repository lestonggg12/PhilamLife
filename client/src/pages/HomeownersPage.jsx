import { notifySuccess, notifyAction } from '../lib/actionFeedback'
import { useSuccessNotice } from '../lib/useSuccessNotice'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Select from '../components/Select'
import { useNavigate, useParams } from 'react-router-dom'
import {
   AlertCircle,
  Calendar,
  CreditCard,
  FileText,
  Home,
  Mail,
  Phone,
  RefreshCw,
  Search,
  Users,
} from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import Skeleton from '../components/skeleton/Skeleton'
import useDelayedLoading from '../components/skeleton/useDelayedLoading'
import { updateHomeowner, removeHomeowner } from '../lib/homeownerWrites'
import { fetchAll } from '../lib/fetchAll'
import { requireHomeownerSnapshot } from '../lib/homeownerDirectorySnapshot'
import { useOrganization } from '../context/OrganizationContext'
import { formatDate as formatDateValue } from '../config/organization'
import { useConfirm } from '../components/ConfirmDialog'
import './HomeownersPage.css'
import { openPaymentMonthPrint } from '../lib/paymentMonthPrint'
import { ReceiptDialog } from '../components/ReceiptSheet'
import { balanceAtReceiptIssuance, loadPaymentReceipt } from '../lib/paymentReceipt'
import { buildReceiptModel } from '../lib/receiptModel'
import { printReceipt } from '../lib/printReceipt'
import { recordReceiptActivity } from '../lib/receiptActivityAudit'
import { useSettledAmountStatus } from '../lib/useSettledAmount'
import ActionDialog from '../components/ActionDialog'
import { formatDues, formatLotSize, formatRate, hasRecurringDues, parsePositiveAmount } from '../lib/lotDues'
import BalanceBreakdown from '../components/BalanceBreakdown'
import BalanceEntryDialog from '../components/BalanceEntryDialog'
import HomeownerLotChips from '../components/HomeownerLotChips'
import DateField from '../components/DateField'
import { duplicateLotMessage, isDuplicateLotError } from '../lib/homeownerLots'
import HomeownerActionsMenu from '../components/HomeownerActionsMenu'
import '../components/HomeownerProfileRefresh.css'
import { Pager } from '../components/PagerControls'
import { useListPage, matchesHomeownerSearch, summarizeActiveLots } from '../lib/homeownerDirectory'
import '../components/HomeownerDirectoryPaging.css'
import PropertyClassificationPanel from '../components/PropertyClassificationPanel'
import AccountActivity from '../components/AccountActivity'
import CctvElectricityCompensation from '../components/CctvElectricityCompensation'
import useManilaMonthRollover, { manilaMonth } from '../hooks/useManilaMonthRollover'
import { monthLabel } from '../lib/pagedQuery'
import { getManilaYearMonth, homeownerPaymentTotals, paymentTrackerStatus, serviceInvoiceBalances } from '../lib/homeownerPaymentPeriods'

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
})

const monthNames = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat('en-PH', { month: 'long' }).format(
    new Date(2024, month, 1),
  ),
)

const normalize = (value) => String(value ?? '').trim().toLowerCase()

const EMPTY_HOMEOWNER = {
  lotSizeSqm: '',
  homeownerName: '',
  blockName: '',
  lotNumber: '',
}

const ADD_BLOCK_OPTION = '__add_block__'
const homeownerDirectoryCache = {
  properties: null,
  paymentCounts: null,
  duesByProperty: null,
}

// The default directory excludes former accounts; history remains available.
function isActiveHomeowner(property) {
  const status = normalize(property.homeowner_status || 'active')
  return status !== 'moved' && status !== 'transferred'
}

function storedStatusLabel(value, fallback = 'Not recorded') {
  const normalized = normalize(value)
  if (!normalized) return fallback

  const labels = {
    completed: 'Completed',
    paid: 'Paid',
    partial: 'Partial',
    pending: 'Pending',
    recorded: 'Recorded',
    voided: 'Voided',
  }

  return (
    labels[normalized] ||
    normalized.replace(/(^|[\s_-])\w/g, (character) => character.toUpperCase())
  )
}

function initials(name) {
  return String(name || 'Homeowner')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase()
}

function formatDate(value, dateFormat) {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : formatDateValue(parsed, { dateFormat, withTime: true })
}

function regularPaymentCategory(payment) {
  const type = String(payment.charge_type || 'Association Dues').trim()
  return type === 'Association Dues' ? 'dues' : 'other'
}

function homeownerStatus(activePaymentCount, property) {
  // Stored balance: positive = owed, negative = advance credit.
  if ((Number(property?.current_balance) || 0) > 0) {
    return { key: 'balance', label: 'With balance' }
  }

  if (!activePaymentCount) return { key: 'no-history', label: 'No regular payment history' }

  return { key: 'current', label: 'No balance due' }
}

function HomeownerProfileSkeleton() {
  return (
    <div className="homeowner-profile-skeleton" aria-busy="true">
      <div className="homeowner-profile-hero homeowner-profile-skeleton-hero">
        <Skeleton variant="circle" width="56px" height="56px" />
        <div className="homeowner-profile-skeleton-identity">
          <div className="homeowner-profile-skeleton-name">
            <Skeleton width="220px" height="31px" />
            <Skeleton width="82px" height="24px" radius="999px" />
          </div>
          <div className="homeowner-profile-skeleton-meta">
            <Skeleton width="118px" height="14px" />
            <Skeleton width="132px" height="14px" />
            <Skeleton width="156px" height="14px" />
          </div>
        </div>
        <div className="homeowner-profile-skeleton-actions">
          <Skeleton width="140px" height="40px" radius="8px" />
          <Skeleton width="96px" height="40px" radius="8px" />
        </div>
      </div>
      <div className="homeowner-lot-chips homeowner-profile-skeleton-tabs">
        <Skeleton width="112px" height="38px" radius="7px" />
        <Skeleton width="108px" height="38px" radius="7px" />
      </div>
      <div className="homeowner-summary-grid homeowner-profile-skeleton-grid">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="homeowner-profile-skeleton-card" key={index}>
            <Skeleton width="92px" height="14px" />
            <Skeleton width="132px" height="25px" />
            <Skeleton width="118px" height="13px" />
          </div>
        ))}
      </div>
      <div className="homeowner-payment-analytics homeowner-profile-skeleton-analytics">
        <Skeleton width="100%" height="245px" radius="8px" />
      </div>
      <span className="skeleton-region-status" role="status">Loading</span>
    </div>
  )
}

export default function HomeownersPage() {
  const { organization } = useOrganization()
  const navigate = useNavigate()
  const { homeownerId } = useParams()
  const confirm = useConfirm()
  const [adminDialog, setAdminDialog] = useState(null)
  const [classificationPropertyId, setClassificationPropertyId] = useState(null)
  const [balanceDialog, setBalanceDialog] = useState(null)
  const [breakdownKey, setBreakdownKey] = useState(0)
  const [balanceBreakdownOpen, setBalanceBreakdownOpen] = useState(false)
  const [notice, setNotice] = useSuccessNotice()
  const [properties, setProperties] = useState(() => homeownerDirectoryCache.properties || [])
  // `payments` / `serviceTransactions` hold ONLY the selected homeowner's records,
  // loaded when a homeowner is opened. The directory uses small per-homeowner counts.
  const [detailData, setDetailData] = useState({ propertyId: null, payments: [], serviceTransactions: [] })
  const [paymentCounts, setPaymentCounts] = useState(() => homeownerDirectoryCache.paymentCounts || new Map())
  const [duesByProperty, setDuesByProperty] = useState(() => homeownerDirectoryCache.duesByProperty || new Map())
  const [hasDirectorySnapshot, setHasDirectorySnapshot] = useState(() => homeownerDirectoryCache.properties !== null)
  const [summaryMonth, setSummaryMonth] = useState(manilaMonth)
  useManilaMonthRollover(setSummaryMonth)
  const [detailReloadKey, setDetailReloadKey] = useState(0)
  const [currentUser, setCurrentUser] = useState(null)
  const [voidTarget, setVoidTarget] = useState(null)
  const [historyReceipt, setHistoryReceipt] = useState(null)
  const [openingHistoryReceipt, setOpeningHistoryReceipt] = useState('')
  const [historyReceiptError, setHistoryReceiptError] = useState('')
  const [historyPrintNotice, setHistoryPrintNotice] = useState('')
  const historySettlement = useSettledAmountStatus(historyReceipt?.kind === 'service' ? historyReceipt.row : null)
  const [voidReason, setVoidReason] = useState('')
  const [voiding, setVoiding] = useState(false)
  const [voidError, setVoidError] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [classificationFilter, setClassificationFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [resultsOpen, setResultsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const [historyMonth, setHistoryMonth] = useState(() => {
    const now = getManilaYearMonth(new Date())
    return `${now.year}-${String(now.month + 1).padStart(2, '0')}`
  })
  const [trackerOpen, setTrackerOpen] = useState(false)
  const [trackerView, setTrackerView] = useState('monthly')
  const [expandedTrackerMonth, setExpandedTrackerMonth] = useState(null)
  const [trackerYear, setTrackerYear] = useState(() =>
    getManilaYearMonth(new Date())?.year || new Date().getFullYear(),
  )
  const [loading, setLoading] = useState(() => !homeownerDirectoryCache.properties)
  const [refreshing, setRefreshing] = useState(false)
  const [pageError, setPageError] = useState('')
  const classificationDialogRef = useRef(null)
  const searchWrapRef = useRef(null)
  const directoryRequest = useRef(0)
  const trackerRef = useRef(null)

  useEffect(() => {
    const dialog = classificationDialogRef.current
    if (!dialog || dialog.open) return undefined
    dialog.showModal()
    return () => {
      if (dialog.open) dialog.close()
    }
  }, [classificationPropertyId, homeownerId])
  useEffect(() => {
    let active = true
    let channel
    const refresh = () => { if (active) void loadHomeowners(true) }
    loadHomeowners()
    window.addEventListener('focus', refresh)
    try {
      channel = supabase.channel(`homeowner-dues-rate:${crypto.randomUUID()}`)
      channel.on('postgres_changes', {
        event: '*', schema: 'public', table: 'association_dues_rates',
      }, refresh).subscribe((status) => {
        if (status === 'SUBSCRIBED') refresh()
      })
    } catch {
      // Focus and the Refresh button also reload the rate and balances.
    }
    return () => {
      active = false
      directoryRequest.current += 1
      window.removeEventListener('focus', refresh)
      if (channel) void supabase.removeChannel(channel).catch(() => {})
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250)
    return () => window.clearTimeout(timer)
  }, [search])

  
useEffect(() => {
  if (!balanceBreakdownOpen) return undefined

  function handleEscape(event) {
    if (event.key === 'Escape') {
      setBalanceBreakdownOpen(false)
    }
  }

  document.addEventListener('keydown', handleEscape)

  return () => {
    document.removeEventListener('keydown', handleEscape)
  }
}, [balanceBreakdownOpen])


  useEffect(() => {
    setActiveTab('overview')
    const now = getManilaYearMonth(new Date())
    setHistoryMonth(`${now.year}-${String(now.month + 1).padStart(2, '0')}`)
    setTrackerOpen(false)
    setTrackerView('monthly')
    setExpandedTrackerMonth(null)
    setTrackerYear(
      getManilaYearMonth(new Date())?.year || new Date().getFullYear(),
    )
  }, [homeownerId])

  // Close the results dropdown on outside click, not just on blur, so it
  // also closes when the click lands on the filter select or elsewhere.
  useEffect(() => {
    function handleOutsideClick(event) {
      if (searchWrapRef.current && !searchWrapRef.current.contains(event.target)) {
        setResultsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function resolveUser() {
      const { data: { user: authUser } = {} } = await supabase.auth.getUser()
      if (!authUser) return
      const { data: profile } = await supabase.from('profiles').select('*').eq('id', authUser.id).single()
      if (!cancelled && profile) setCurrentUser(profile)
    }
    resolveUser()
    return () => { cancelled = true }
  }, [])

  const userRole = currentUser?.is_active === false ? '' : currentUser?.role?.trim().toLowerCase()
  // Treasurer can manage homeowner details and contacts, but cannot void payments, change balances, or manage blocks.
  const canVoidPayments = userRole === 'secretary'
  const canManageHomeowners = userRole === 'admin' || userRole === 'secretary' || userRole === 'treasurer'
  const canManageBlocks = userRole === 'admin' || userRole === 'secretary'
  const canManageBalances = canManageBlocks
  const canEditContact = canManageHomeowners

  function openVoid(item) {
    const payment = detailData.payments.find((row) => `payment-${row.id}` === item.id)
    if (!payment) return
    setVoidTarget(payment)
    setVoidReason('')
    setVoidError('')
  }

  async function openHomeownerHistoryReceipt(item) {
    if (openingHistoryReceipt || !selectedPropertyId) return
    const isService = item.id.startsWith('service-')
    const sourceRow = isService
      ? selectedServices.find((row) => `service-${row.id}` === item.id)
      : selectedPayments.find((row) => `payment-${row.id}` === item.id)
    if (!sourceRow) {
      setHistoryReceiptError('Receipt details are unavailable. Refresh the homeowner records and try again.')
      return
    }
    setOpeningHistoryReceipt(item.id)
    setHistoryReceiptError('')
    try {
      const table = isService ? 'service_transactions' : 'payments'
      const { data, error } = await supabase.from(table).select('*')
        .eq('id', sourceRow.id).eq('property_id', selectedPropertyId).maybeSingle()
      if (error) throw error
      if (!data || String(data.id) !== String(sourceRow.id)) {
        throw new Error('The receipt could not be verified for this property.')
      }
      const payment = isService ? data : await loadPaymentReceipt(supabase, data)
      await recordReceiptActivity('Receipt Viewed', { kind: isService ? 'service' : 'payment', receiptNumber: data.receipt_number, recordId: data.id })
      setHistoryReceipt({ kind: isService ? 'service' : 'payment', row: payment, propertyId: selectedPropertyId })
    } catch (failure) {
      setHistoryReceiptError(failure?.message || 'Unable to open receipt. Please refresh and retry.')
    } finally {
      setOpeningHistoryReceipt('')
    }
  }
  async function confirmVoid(event) {
    event.preventDefault()
    if (voiding || !canVoidPayments || !voidTarget) return
    const reason = voidReason.trim()

    if (reason.length < 5) {
      setVoidError('Enter a reason (at least 5 characters).')
      return
    }

    setVoiding(true)
    setVoidError('')
    const payment = voidTarget
    try {
      // Include legacy NULL statuses. The database owns the balance/credit
      // adjustments; never reconstruct financial figures in browser state.
      const { data, error } = await supabase
        .from('payments')
        .update({ status: 'Voided', void_reason: reason })
        .eq('id', payment.id)
        .or('status.is.null,status.neq.Voided')
        .select('id')
      if (error) throw error
      if (!Array.isArray(data) || data.length !== 1 || String(data[0].id) !== String(payment.id)) {
        throw new Error('The void could not be confirmed. Refresh before trying again.')
      }

      // Reload account balances, payment counts and history after the confirmed void.
      setVoidTarget(null)
      notifySuccess(`Payment ${payment.receipt_number || ''} was cancelled for ${payment.homeowner_name}.`)
      await loadHomeowners(true)
    } catch (error) {
      setVoidError(error?.message || 'Could not void this payment. Please refresh before retrying.')
    } finally {
      setVoiding(false)
    }
  }

  async function handleAdminChanged(result) {
    setNotice(result?.message || '')
    await loadHomeowners(true)
    if (result?.propertyId) {
      handleSelectHomeowner(result.propertyId)
      if (canManageBlocks) setClassificationPropertyId(result.propertyId)
    }
  }

  async function handleDeleteHomeowner() {
    if (!canManageBalances || !selectedProperty || !isActiveHomeowner(selectedProperty)) return

    const entry = selectedProperty
    setPageError('')
    setNotice('')

    const confirmed = await confirm({
      title: `Delete ${entry.homeowner_name}?`,
      message: `${entry.block}, Lot ${entry.lot_number} will be deleted only if the server confirms that it has no financial or operational history. This can't be undone.`,
      confirmLabel: 'Delete homeowner',
      cancelLabel: 'Keep homeowner',
      tone: 'danger',
    })
    if (!confirmed) return

    try {
      await removeHomeowner(supabase, entry.id)
    } catch (error) {
      setPageError(`Could not remove homeowner: ${error.message} Use Move / Transfer in Contact Manager to preserve an account with history.`)
      return
    }

    navigate('/homeowners')
    setNotice(`Homeowner ${entry.homeowner_name} was removed.`)
    loadHomeowners(true)


  }

  async function loadHomeowners(isRefresh = false) {
    const request = ++directoryRequest.current
    if (isRefresh) {
      setRefreshing(true)
      setDetailReloadKey((key) => key + 1)
    }
    else if (!homeownerDirectoryCache.properties) setLoading(true)
    setPageError('')

    try {
      const [duesResult, propertyResult, paymentResult] = await Promise.all([
        fetchAll(() => supabase
          .from('property_monthly_dues')
          .select('property_id, lot_size_sqm, price_per_sqm, monthly_dues, billing_month, billing_amount, prepaid')
          .order('property_id'), { tiebreaker: null }),
        fetchAll(() => supabase
          .from('properties')
          .select(
            'id, homeowner_id, block, lot_number, lot_size_sqm, homeowner_name, contact_phone, contact_email, contact_updated_at, created_at, homeowner_status, current_balance, property_classification',
          )
          .order('homeowner_name')),
        fetchAll(() => supabase
          .from('property_payment_summary')
          .select('property_id, active_payment_count')
          .order('property_id'), { tiebreaker: null }),
      ])
      if (request !== directoryRequest.current) return
      const verified = requireHomeownerSnapshot(duesResult, propertyResult, paymentResult)
      // Commit an all-or-nothing snapshot. Never replace reliable cached
      // financial figures with zeros after a failed or partial request.
      const nextProperties = verified.properties
      const nextPaymentCounts = new Map(verified.payments.map((row) => [Number(row.property_id), Number(row.active_payment_count) || 0]))
      const nextDuesByProperty = new Map(verified.dues.map((row) => [Number(row.property_id), row]))
      homeownerDirectoryCache.properties = nextProperties
      homeownerDirectoryCache.paymentCounts = nextPaymentCounts
      homeownerDirectoryCache.duesByProperty = nextDuesByProperty
      setProperties(nextProperties)
      setPaymentCounts(nextPaymentCounts)
      setDuesByProperty(nextDuesByProperty)
      setHasDirectorySnapshot(true)
      if (!isRefresh) setDetailReloadKey((key) => key + 1)
    } catch (error) {
      if (request !== directoryRequest.current) return
      const message = homeownerDirectoryCache.properties
        ? 'Showing the last loaded directory. Refresh before making decisions.'
        : 'Refresh to load the directory.'
      setPageError(`Homeowner information is unavailable: ${error?.message || 'Connection failed.'} ${message}`)
    } finally {
      if (request === directoryRequest.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }

  const directoryEntries = useMemo(
    () =>
      properties.filter(isActiveHomeowner).map((property) => ({
        property,
        status: homeownerStatus(
          paymentCounts.get(Number(property.id)) || 0,
          property,
        ),
      })),
    [paymentCounts, properties],
  )

  const activeLotCount = directoryEntries.length
  const activeLotLabel = `${activeLotCount} active ${activeLotCount === 1 ? 'lot' : 'lots'}`
  const hasQuery = debouncedSearch.trim().length > 0
  const hasFilter = statusFilter !== 'all' || classificationFilter !== 'all'

  const filteredDirectory = useMemo(() => {
    if (!hasQuery && !hasFilter) return []
    return directoryEntries.filter(({ property, status }) => {
      const matchesSearch = matchesHomeownerSearch(property, debouncedSearch)
      const matchesStatus = statusFilter === 'all' || status.key === statusFilter
        || (statusFilter === 'current' && status.key === 'no-history')
      const classification = String(property.property_classification || 'unclassified').trim().toLowerCase() || 'unclassified'
      const matchesClassification = classificationFilter === 'all' || classification === classificationFilter
      return matchesSearch && matchesStatus && matchesClassification
    })
  }, [classificationFilter, debouncedSearch, directoryEntries, hasFilter, hasQuery, statusFilter])

  const directoryPage = useListPage(filteredDirectory, [search, statusFilter, classificationFilter], 25)
  const showResults = resultsOpen && (hasQuery || hasFilter)
  const homeownerStats = useMemo(() => summarizeActiveLots(directoryEntries), [directoryEntries])
  const directoryCount = (value) => hasDirectorySnapshot ? value.toLocaleString('en-PH') : '—'

  function handleSelectHomeowner(id) {
    navigate(`/homeowners/${id}`, { replace: true, preventScrollReset: true })
    setResultsOpen(false)
  }

  function handleSearchKeyDown(event) {
    if (event.key === 'Escape' && showResults) {
      event.preventDefault()
      setResultsOpen(false)
    }
  }

  const selectedProperty = useMemo(
    () =>
      properties.find(
        (property) => String(property.id) === String(homeownerId),
      ) || null,
    [homeownerId, properties],
  )

  const homeownerLots = useMemo(
    () => selectedProperty?.homeowner_id
      ? properties.filter((property) => property.homeowner_id === selectedProperty.homeowner_id)
      : selectedProperty ? [selectedProperty] : [],
    [properties, selectedProperty],
  )

  const selectedPropertyId = selectedProperty?.id ?? null
  const formerAccount = selectedProperty != null && !isActiveHomeowner(selectedProperty)
  const selectedLotDues = duesByProperty.get(Number(selectedPropertyId))
  const hasMonthlyDues = selectedLotDues?.prepaid || hasRecurringDues(selectedLotDues)
  const monthlyDuesAmount = !formerAccount && hasMonthlyDues ? selectedLotDues.billing_amount : null
  const nextBillingLabel = selectedLotDues?.billing_month
    ? monthLabel(selectedLotDues.billing_month.slice(0, 7)) : 'Next bill'
  const monthlyDuesNote = formerAccount ? 'Former account · monthly billing ended'
    : !hasMonthlyDues ? 'Set the lot size and rate to calculate dues.'
    : selectedLotDues.prepaid ? `${nextBillingLabel} · covered by annual payment`
      : `${nextBillingLabel} · ${formatLotSize(selectedLotDues.lot_size_sqm)} × ${formatRate(selectedLotDues.price_per_sqm)}`

  useEffect(() => {
    setHistoryReceipt(null)
    setHistoryReceiptError('')
    setBalanceBreakdownOpen(false)
    setBalanceDialog(null)
    setVoidTarget(null)
  }, [selectedPropertyId])

  // Exports and receipt history are usable only after both sources load for this lot.
  useEffect(() => {
    if (selectedPropertyId == null) return undefined
    let cancelled = false

    async function loadDetail() {
      const scope = { propertyId: selectedPropertyId, revision: detailReloadKey }
      try {
        const [payments, services] = await Promise.all([
          fetchAll(() => supabase.from('payments')
            .select('*, manual_payment_discounts(payment_id, discount_amount, gross_amount, cash_received)')
            .eq('property_id', selectedPropertyId).order('paid_at', { ascending: false })),
          fetchAll(() => supabase.from('service_transactions').select('*')
            .eq('property_id', selectedPropertyId).order('paid_at', { ascending: false })),
        ])
        if (payments.error || services.error) throw payments.error || services.error
        if (!cancelled) setDetailData({ ...scope, payments: payments.data || [], serviceTransactions: services.data || [] })
      } catch {
        if (!cancelled) setDetailData({ ...scope, loadFailed: true })
      }
    }

    loadDetail()
    return () => { cancelled = true }
  }, [detailReloadKey, selectedPropertyId])

  const detailMatchesLot = detailData.propertyId === selectedPropertyId && detailData.revision === detailReloadKey
  const paymentSummaryLoading = !detailMatchesLot || refreshing
  const paymentSummaryReady = !paymentSummaryLoading && !detailData.loadFailed
  const selectedPayments = useMemo(() => paymentSummaryReady ? detailData.payments : [], [detailData, paymentSummaryReady])
  const selectedServices = useMemo(() => paymentSummaryReady ? detailData.serviceTransactions : [], [detailData, paymentSummaryReady])
  const showDetailSkeleton = useDelayedLoading(paymentSummaryLoading, { showDelay: 150 })

  const activePayments = useMemo(
    () =>
      selectedPayments.filter(
        (payment) => normalize(payment.status) !== 'voided',
      ),
    [selectedPayments],
  )

  const duesPayments = useMemo(
    () =>
      activePayments.filter(
        (payment) => regularPaymentCategory(payment) === 'dues',
      ),
    [activePayments],
  )

  const otherPayments = useMemo(
    () =>
      activePayments.filter(
        (payment) => regularPaymentCategory(payment) === 'other',
      ),
    [activePayments],
  )

  const history = useMemo(() => {
    const regular = selectedPayments.map((payment) => {
      let remaining = null
      if (normalize(payment.status) !== 'voided' && payment.remaining_balance != null) {
        try {
          remaining = balanceAtReceiptIssuance(payment, payment.manual_payment_discounts)
        } catch {
          // The verified receipt detail can explain why this balance is unavailable.
        }
      }
      return {
        id: `payment-${payment.id}`,
        kind: regularPaymentCategory(payment),
        category:
          regularPaymentCategory(payment) === 'dues'
            ? 'Association Dues'
            : payment.charge_type || 'Other',
        receipt: payment.receipt_number || '—',
        description: payment.coverage_period || payment.note || 'Payment',
        amount: Number(payment.amount_paid ?? payment.amount) || 0,
        remaining,
        method: payment.payment_method || '—',
        statusKey: normalize(payment.status),
        status: storedStatusLabel(payment.status),
        paidAt: payment.paid_at,
      }
    })

    const invoiceBalances = serviceInvoiceBalances(selectedServices)
    const services = selectedServices.map((transaction) => {
      const storedStatus = normalize(transaction.payment_status)
      const remaining = storedStatus === 'voided' ? null : invoiceBalances.get(transaction.id)
      const status = storedStatus === 'partial' && remaining === 0 ? 'paid' : storedStatus
      return {
        id: `service-${transaction.id}`,
        kind: 'services',
        category: 'Amenities',
        receipt: transaction.receipt_number || '—',
        description: transaction.service_name || 'Amenity or service',
        amount: Number(transaction.amount_paid) || 0,
        remaining,
        method: transaction.payment_method || '—',
        statusKey: status,
        status: storedStatusLabel(status),
        paidAt: transaction.paid_at,
      }
    })

    return [...regular, ...services].sort(
      (left, right) =>
        new Date(right.paidAt || 0).getTime() -
        new Date(left.paidAt || 0).getTime(),
    )
  }, [selectedPayments, selectedServices])

  const paidTotals = useMemo(() => homeownerPaymentTotals(history, summaryMonth), [history, summaryMonth])
  const paymentAmount = (amount) => paymentSummaryReady ? peso.format(amount) : '—'
  const paymentSummaryNote = paymentSummaryLoading ? 'Loading payments…' : 'Payment history unavailable'

  const summary = useMemo(() => {
    const latestRegularPayment = activePayments[0]
    // Stored balance: positive = owed, negative = advance credit.
    const storedBalance = selectedProperty && selectedProperty.current_balance != null
      ? Number(selectedProperty.current_balance) || 0
      : Number(latestRegularPayment?.remaining_balance) || 0
    const outstanding = Math.max(storedBalance, 0)
    const credit = Math.max(-storedBalance, 0)
    const latestRecord = history[0]

    return {
      outstanding,
      credit,
      lastPayment: latestRecord ? formatDate(latestRecord.paidAt, organization.dateFormat) : 'No payments yet',
      receipts: history.length,
    }
  }, [activePayments, history, selectedProperty, organization.dateFormat])

  const visibleHistory = useMemo(() => {
    if (activeTab === 'dues') return history.filter((item) => item.kind === 'dues')
    if (activeTab === 'services') {
      return history.filter((item) => item.kind === 'services')
    }
    if (activeTab === 'other') return history.filter((item) => item.kind === 'other')
    return history
  }, [activeTab, history])

  // Filter by the actual payment date in Asia/Manila, not the dues coverage month.
  // Keep voided records visible in the historical ledger, exactly as before.
  const historyMonthRows = useMemo(() => visibleHistory.filter((item) => {
    const paid = getManilaYearMonth(item.paidAt)
    return paid && `${paid.year}-${String(paid.month + 1).padStart(2, '0')}` === historyMonth
  }), [visibleHistory, historyMonth])

  const trackerRecords = useMemo(
    () =>
      history
        .map((record) => ({
          ...record,
          trackerDate: getManilaYearMonth(record.paidAt),
        }))
        .filter(
          (record) => record.trackerDate && record.statusKey !== 'voided',
        ),
    [history],
  )

  const trackerYears = useMemo(() => {
    const currentYear = getManilaYearMonth(new Date())?.year || new Date().getFullYear()
    return Array.from(
      new Set([
        currentYear,
        ...trackerRecords.map((record) => record.trackerDate.year),
      ]),
    ).sort((left, right) => right - left)
  }, [trackerRecords])

  const monthlyTracker = useMemo(
    () =>
      monthNames.map((month, monthIndex) => {
        const records = trackerRecords.filter(
          (record) =>
            record.trackerDate.year === trackerYear &&
            record.trackerDate.month === monthIndex,
        )
        const categoryTotal = (kind) =>
          records
            .filter((record) => record.kind === kind)
            .reduce((sum, record) => sum + Math.round(record.amount * 100), 0) / 100

        const dues = categoryTotal('dues')
        const services = categoryTotal('services')
        const other = categoryTotal('other')

        return {
          month,
          records,
          status: paymentTrackerStatus(records),
          dues,
          services,
          other,
          total: records.reduce((sum, record) => sum + Math.round(record.amount * 100), 0) / 100,
        }
      }),
    [trackerRecords, trackerYear],
  )

  const monthDialogRef = useRef(null)
  const selectedTrackerMonth = expandedTrackerMonth === null ? null : monthlyTracker[expandedTrackerMonth]

  useEffect(() => {
    if (!paymentSummaryReady || !trackerOpen || trackerView !== 'monthly' || !selectedTrackerMonth) return undefined
    const previousFocus = document.activeElement
    const dialog = monthDialogRef.current
    dialog?.focus()
    function handleDialogKey(event) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setExpandedTrackerMonth(null)
      }
      if (event.key !== 'Tab' || !dialog) return
      const targets = Array.from(dialog.querySelectorAll('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'))
      if (!targets.length) { event.preventDefault(); return }
      const first = targets[0]
      const last = targets[targets.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', handleDialogKey)
    return () => {
      document.removeEventListener('keydown', handleDialogKey)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [paymentSummaryReady, trackerOpen, trackerView, expandedTrackerMonth, trackerYear, homeownerId])

  const annualTracker = useMemo(
    () =>
      trackerYears.map((year) => {
        const records = trackerRecords.filter(
          (record) => record.trackerDate.year === year,
        )
        const categoryTotal = (kind) =>
          records
            .filter((record) => record.kind === kind)
            .reduce((sum, record) => sum + Math.round(record.amount * 100), 0) / 100
        const dues = categoryTotal('dues')
        const services = categoryTotal('services')
        const other = categoryTotal('other')

        return {
          year,
          months: new Set(records.map((record) => record.trackerDate.month)).size,
          transactions: records.length,
          dues,
          services,
          other,
          total: records.reduce((sum, record) => sum + Math.round(record.amount * 100), 0) / 100,
        }
      }),
    [trackerRecords, trackerYears],
  )

  function togglePaymentTracker() {
    setTrackerOpen((isOpen) => !isOpen)
  }

  function closePaymentTracker() {
    setExpandedTrackerMonth(null)
    setTrackerOpen(false)
  }

  const selectedStatus = homeownerStatus(
    paymentCounts.get(Number(selectedPropertyId)) || 0,
    selectedProperty,
  )

  return (
    <div className="homeowners-page">
      <header className="homeowners-header">
        <div>
          <p className="homeowners-eyebrow">Homeowner records</p>
          <h1>Homeowners</h1>
          <p>Search for a homeowner to view their profile, property, balances, and complete payment history.</p>
        </div>
        <div className="hod-header-actions">
          {canManageHomeowners && (
            <>
              {canManageBlocks && (
              <button
                type="button"
                className="homeowners-refresh"
                onClick={() => setAdminDialog({ type: 'blocks' })}
              >
                Manage Blocks
              </button>
              )}
              <button
                type="button"
                className="homeowners-refresh hod-primary"
                onClick={() => setAdminDialog({ type: 'homeowner', property: null })}
              >
                + Add New Homeowner
              </button>
            </>
          )}
          <button
            type="button"
            className="homeowners-refresh"
            onClick={() => loadHomeowners(true)}
            disabled={refreshing}
          >
            <RefreshCw size={17} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </header>

      <section className="homeowners-stat-grid" aria-label="Homeowner summaries">
        <article className="homeowners-stat-card">
          <div className="homeowners-stat-top"><span>Active lots</span><span className="homeowners-stat-icon homeowners-stat-icon-blue"><Users size={18} /></span></div>
          <strong>{directoryCount(activeLotCount)}</strong>
          <small>Current property accounts</small>
        </article>
        <article className="homeowners-stat-card">
          <div className="homeowners-stat-top"><span>Unique owners</span><span className="homeowners-stat-icon homeowners-stat-icon-blue"><Users size={18} /></span></div>
          <strong>{directoryCount(homeownerStats.uniqueOwners)}</strong>
          <small>Linked owners across active lots</small>
        </article>
        <article className="homeowners-stat-card">
          <div className="homeowners-stat-top"><span>Vacant lots</span><span className="homeowners-stat-icon homeowners-stat-icon-green"><Home size={18} /></span></div>
          <strong>{directoryCount(homeownerStats.vacantLots)}</strong>
          <small>Active lots classified as Lot Owner</small>
        </article>
        <article className="homeowners-stat-card">
          <div className="homeowners-stat-top"><span>Lots with balance</span><span className="homeowners-stat-icon homeowners-stat-icon-warning"><CreditCard size={18} /></span></div>
          <strong>{directoryCount(homeownerStats.withBalance)}</strong>
          <small>Accounts with a balance due</small>
        </article>
        <article className="homeowners-stat-card">
          <div className="homeowners-stat-top"><span>Lots with no balance due</span><span className="homeowners-stat-icon homeowners-stat-icon-green"><FileText size={18} /></span></div>
          <strong>{directoryCount(homeownerStats.noBalanceDue)}</strong>
          <small>Zero balance or advance credit</small>
        </article>
      </section>

      {pageError && <p className="homeowners-error">{pageError}</p>}
      <section className="homeowners-finder">
        <div className="homeowners-finder-heading">
          <div>
            <h2>Find a homeowner or lot owner</h2>
            <span className="homeowners-finder-count">
              {loading ? (
                <Skeleton width="110px" height="14px" radius="999px" />
              ) : !hasDirectorySnapshot ? (
                'Directory unavailable'
              ) : hasQuery || hasFilter ? (
                `${filteredDirectory.length} of ${activeLotLabel}`
              ) : (
                activeLotLabel
              )}
            </span>
          </div>
          <span className="homeowners-directory-icon"><Users size={19} /></span>
        </div>

        <div className="homeowners-finder-controls">
          <div className="homeowners-search-wrap" ref={searchWrapRef}>
            <label className="homeowners-search-label" htmlFor="homeowner-search">
              Search homeowners and lot owners
            </label>
            <div className="homeowners-search-field">
              <span className="homeowners-search-icon" aria-hidden="true">
                <Search size={18} />
              </span>
              <input
                id="homeowner-search"
                type="search"
                className="homeowners-search"
                placeholder="Name, block, lot, phone, email"
                value={search}
                autoComplete="off"
                onFocus={() => setResultsOpen(true)}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setResultsOpen(true)
                }}
                onKeyDown={handleSearchKeyDown}
              />
            </div>

            {showResults && (
              <div className="homeowners-search-results">
                <div className="homeowners-directory-results" aria-label="Homeowner search results">
                {loading ? (
                  <div className="homeowners-empty" aria-busy="true"><Skeleton variant="rect" width="100%" height="68px" /><Skeleton variant="rect" width="100%" height="68px" /><Skeleton variant="rect" width="100%" height="68px" /><span className="skeleton-region-status" role="status">Loading</span></div>
                ) : !hasDirectorySnapshot ? (
                  <p className="homeowners-empty">Directory unavailable. Use Refresh to try again.</p>
                ) : filteredDirectory.length === 0 ? (
                  <p className="homeowners-empty">No active lot matches your search.</p>
                ) : (
                  directoryPage.rows.map(({ property, status }) => {
                    const dues = duesByProperty.get(Number(property.id))
                    return (
                      <button
                        type="button"
                        key={property.id}
                        className={`homeowner-directory-card${
                          String(property.id) === String(selectedProperty?.id)
                            ? ' is-selected'
                            : ''
                        }`}
                        onClick={() => handleSelectHomeowner(property.id)}
                      >
                        <span className="homeowner-directory-avatar">
                          {initials(property.homeowner_name)}
                        </span>
                        <span className="homeowner-directory-copy">
                          <strong>{property.homeowner_name}</strong>
                          <small>{property.block} · Lot {property.lot_number}</small>
                          <small>
                            {dues?.prepaid ? `${formatDues(dues.billing_amount)}/mo · prepaid` : hasRecurringDues(dues)
                              ? `${formatLotSize(dues.lot_size_sqm)} · ${formatRate(dues.price_per_sqm)} · ${formatDues(dues.monthly_dues)}/mo`
                              : 'Recurring dues unavailable'}
                          </small>
                          <span className={`homeowner-account-badge badge-${status.key}`}>
                            {status.label}
                          </span>
                        </span>
                      </button>
                    )
                  })
                )}
                </div>
                {!loading && <Pager page={directoryPage.page} total={filteredDirectory.length} size={25} onPageChange={directoryPage.setPage} />}
              </div>
            )}
          </div>

          <Select ariaLabel="Filter homeowners by property classification" value={classificationFilter} onChange={(value) => { setClassificationFilter(value); setResultsOpen(true) }} options={[['all', 'All classifications'], ['lot_owner', 'Lot owners'], ['homeowner', 'Homeowners'], ['unclassified', 'Unclassified']].map(([value, label]) => ({ value, label }))} />

          <Select ariaLabel="Filter homeowners by account status" value={statusFilter} onChange={(value) => { setStatusFilter(value); setResultsOpen(true) }} options={[['all', 'All account statuses'], ['current', 'No balance due'], ['balance', 'With balance'], ['no-history', 'No regular payment history']].map(([value, label]) => ({ value, label }))} />
        </div>
      </section>

      <main className="homeowner-profile-panel">
        {loading ? (
          <HomeownerProfileSkeleton />
        ) : !selectedProperty ? (
          <div className="homeowner-profile-empty">
            <Users size={34} />
            <h2>{!hasDirectorySnapshot ? 'Directory unavailable' : homeownerId ? 'Homeowner not found' : 'Search for a homeowner'}</h2>
            <p>
              {!hasDirectorySnapshot ? 'Use Refresh to load homeowner profiles.' : homeownerId
                ? 'This property account could not be found.'
                : 'Use the search bar above to find someone by name, block, lot, phone, or email.'}
            </p>
          </div>
        ) : (
          <>
            <section className="homeowner-profile-hero">
              <div className="homeowner-profile-avatar">
                {initials(selectedProperty.homeowner_name)}
              </div>
              <div className="homeowner-profile-identity">
                <div className="homeowner-profile-title-row">
                  <div>
                    <p>
  {selectedProperty.property_classification === 'homeowner'
    ? 'Homeowner profile'
    : selectedProperty.property_classification === 'lot_owner'
      ? 'Lot owner profile'
      : 'Property profile'}
</p>
                    <div className="homeowner-name-row">
                      <h2>{selectedProperty.homeowner_name}</h2>
                      <span className={`homeowner-account-badge badge-${selectedStatus.key}`}>
                        {formerAccount ? 'Former account' : selectedStatus.label}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="homeowner-profile-meta">
                  <span><Home size={16} /> {selectedProperty.block}, Lot {selectedProperty.lot_number}</span>
                  <span><Phone size={16} /> {selectedProperty.contact_phone || 'No phone recorded'}</span>
                  <span><Mail size={16} /> {selectedProperty.contact_email || 'No email recorded'}</span>
                </div>
              </div>
              <div className="homeowner-profile-actions">
                {!formerAccount && <button
                  type="button"
                  className="homeowner-primary-action"
                  onClick={() => navigate('/payments', { state: { recordPaymentPropertyId: selectedProperty.id } })}
                >
                  <CreditCard size={16} /> Record Payment
                </button>}
                <HomeownerActionsMenu>
                  {!formerAccount && canManageHomeowners && (
                    <>
                      <button type="button" onClick={() => setAdminDialog({ type: 'lot', property: selectedProperty })}>
                        Add Lot
                      </button>
                      <button type="button" onClick={() => setAdminDialog({ type: 'homeowner', property: selectedProperty })}>
                        Edit Homeowner
                      </button>
                    </>
                  )}
                  {!formerAccount && canEditContact && (
                    <button type="button" onClick={() => navigate(`/contacts?edit=${selectedProperty.id}`)}>
                      Edit Contact
                    </button>
                  )}
                  {!formerAccount && canManageBalances && (
                    <button type="button" onClick={() => setBalanceDialog(selectedProperty)}>Add Balance</button>
                  )}
                  {!formerAccount && canManageHomeowners && (
                    <button type="button" onClick={() => setBalanceBreakdownOpen(true)}
                      aria-haspopup="dialog" aria-expanded={balanceBreakdownOpen}>
                      Balance Breakdown
                    </button>
                  )}
                  {!formerAccount && canManageBlocks && (
                    <button type="button" onClick={() => setClassificationPropertyId(selectedProperty.id)}>
                      Property Classification
                    </button>
                  )}
                  <button
                    type="button"
                    aria-expanded={trackerOpen}
                    aria-controls="homeowner-payment-tracker"
                    disabled={!paymentSummaryReady}
                    onClick={togglePaymentTracker}
                  >
                    {trackerOpen ? 'Close Payment Tracker' : 'Open Payment Tracker'}
                  </button>
                </HomeownerActionsMenu>
              </div>
            </section>

            {formerAccount && <p role="status">Former property account. Historical payments and account activity are available for review.</p>}

            <HomeownerLotChips
              lots={homeownerLots}
              selectedId={selectedProperty.id}
              onSelect={handleSelectHomeowner}
            />

            <section className="homeowner-summary-grid" aria-label="Financial summary for the selected lot">
              {showDetailSkeleton
                ? Array.from({ length: 6 }, (_, index) => (
                  <article className="homeowner-summary-skeleton-card" key={index}>
                    <Skeleton width="92px" height="14px" />
                    <Skeleton width="132px" height="25px" />
                    <Skeleton width="118px" height="13px" />
                  </article>
                ))
                : <>
                  <article>
                    <span className="homeowner-summary-icon"><Calendar size={18} /></span>
                    <span>Payments received this month</span>
                    <strong>{paymentAmount(paidTotals.thisMonth)}</strong>
                    <small>{paymentSummaryReady ? `All receipt categories · ${monthLabel(summaryMonth)}` : paymentSummaryNote}</small>
                  </article>
                  <article>
                    <span className="homeowner-summary-icon"><Calendar size={18} /></span>
                    <span>Payments received this year</span>
                    <strong>{paymentAmount(paidTotals.thisYear)}</strong>
                    <small>{paymentSummaryReady ? `All receipt categories · ${summaryMonth.slice(0, 4)} year to date` : paymentSummaryNote}</small>
                  </article>
                  <article>
                    <span className="homeowner-summary-icon"><CreditCard size={18} /></span>
                    <span>Monthly association dues</span>
                    <strong>{monthlyDuesAmount != null ? formatDues(monthlyDuesAmount) : '—'}</strong>
                    <small>{monthlyDuesNote}</small>
                  </article>
                  <article className={summary.outstanding > 0 ? 'has-balance' : ''}>
                    <span className="homeowner-summary-icon"><AlertCircle size={18} /></span>
                    <span>HOA account balance</span>
                    <strong>{peso.format(summary.outstanding)}</strong>
                    <small>{summary.outstanding > 0 ? 'Payment still required' : 'No recorded balance'}</small>
                  </article>
                  <article className={summary.credit > 0 ? 'has-credit' : ''}>
                    <span className="homeowner-summary-icon"><Home size={18} /></span>
                    <span>Credit</span>
                    <strong>{peso.format(summary.credit)}</strong>
                    <small>{summary.credit > 0 ? 'Applied to next dues' : 'No advance credit'}</small>
                  </article>
                  <article>
                    <span className="homeowner-summary-icon"><FileText size={18} /></span>
                    <span>Receipts</span>
                    <strong>{paymentSummaryReady ? summary.receipts : '—'}</strong>
                    <small>{paymentSummaryReady ? 'Across all categories · includes voided' : paymentSummaryNote}</small>
                  </article>
                </>}
            </section>
            
            <section
              className="homeowner-payment-analytics"
              aria-labelledby="homeowner-payment-analytics-title"
            >
              <div className="homeowner-payment-analytics-header">
                <div>
                  <h3 id="homeowner-payment-analytics-title">
                    Payment Analytics
                  </h3>
                  <p>
                    Payments for {selectedProperty.block}, Lot {selectedProperty.lot_number}.
                  </p>
                </div>

                <label className="homeowner-analytics-year">
                  <span>Year</span>
                  <Select className="homeowner-analytics-select" ariaLabel="Payment analytics year" value={String(trackerYear)} onChange={(value) => setTrackerYear(Number(value))} options={trackerYears.map((year) => ({ value: String(year), label: String(year) }))} />
                </label>
              </div>

              {showDetailSkeleton ? (
                <Skeleton className="homeowner-analytics-skeleton" width="100%" height="245px" radius="8px" />
              ) : !paymentSummaryReady ? (
                <p role="status">{paymentSummaryLoading ? 'Loading payments…' : 'Payment records are unavailable. Refresh to retry.'}</p>
              ) : monthlyTracker.every((month) => month.total === 0) ? (
                <div className="homeowner-analytics-empty" role="status">
                  <FileText size={24} />
                  <strong>No payments recorded in {trackerYear}</strong>
                  <p>Monthly collections will appear here after a payment is recorded for this lot.</p>
                </div>
              ) : (() => {
                const chartMax = Math.max(
                  1,
                  ...monthlyTracker.map((month) => month.total)
                );

                const ticks = [1, 0.75, 0.5, 0.25, 0];

                return (
                  <div
                    className="homeowner-analytics-chart"
                    role="img"
                    aria-label={`Monthly payments for ${trackerYear}: ${monthlyTracker
                      .map(
                        (month) =>
                          `${month.month}: ${peso.format(month.total)}`
                      )
                      .join(", ")}`}
                  >
                    <div
                      className="homeowner-analytics-y-axis"
                      aria-hidden="true"
                    >
                      {ticks.map((tick) => (
                        <span key={tick}>
                          {peso.format(chartMax * tick)}
                        </span>
                      ))}
                    </div>

                    <div className="homeowner-analytics-plot">
                      <div
                        className="homeowner-analytics-gridlines"
                        aria-hidden="true"
                      >
                        {ticks.map((tick) => (
                          <span key={tick} />
                        ))}
                      </div>

                      <div className="homeowner-analytics-bars">
                        {monthlyTracker.map((month) => (
                          <div
                            className="homeowner-analytics-month"
                            key={month.month}
                            title={`${month.month} ${trackerYear}: ${peso.format(
                              month.total
                            )}`}
                          >
                            <div className="homeowner-analytics-bar-track">
                              <span
                                className={`homeowner-analytics-bar${
                                  month.total > 0 ? " has-value" : ""
                                }`}
                                style={{
                                  height:
                                    month.total > 0
                                      ? `${Math.max(
                                          (month.total / chartMax) * 100,
                                          2
                                        )}%`
                                      : "0%",
                                }}
                              />
                            </div>

                            <span className="homeowner-analytics-month-label">
                              {month.month.slice(0, 3)}
                            </span>

                            <span className="homeowner-analytics-month-value">
                              {peso.format(month.total)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              <p className="homeowner-payment-analytics-note">
                Monthly totals use payment dates in Philippine time.
                Voided payments are excluded. Months without payments show ₱0.
              </p>
            </section>

                      
          {balanceBreakdownOpen && (
            <div
              className="homeowner-breakdown-overlay"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  setBalanceBreakdownOpen(false)
                }
              }}
            >
              <section
                className="homeowner-breakdown-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="homeowner-breakdown-title"
              >
                <div className="homeowner-breakdown-modal-header">
                  <div>
                    <h2 id="homeowner-breakdown-title">Balance Breakdown</h2>
                    <p>
                      {selectedProperty.homeowner_name} — {selectedProperty.block},
                      {' '}Lot {selectedProperty.lot_number}
                    </p>
                  </div>

                  <button
                    type="button"
                    className="homeowner-breakdown-close"
                    onClick={() => setBalanceBreakdownOpen(false)}
                    aria-label="Close balance breakdown"
                  >
                    ×
                  </button>
                </div>

                <div className="homeowner-breakdown-modal-content">
                  <BalanceBreakdown
                    propertyId={selectedProperty.id}
                    canManage={canManageBalances}
                    refreshKey={breakdownKey}
                    onChanged={(message) => {
                      setNotice(message)
                      setBreakdownKey((key) => key + 1)
                      loadHomeowners(true)
                    }}
                  />
                </div>
              </section>
            </div>
          )}


            {trackerOpen && paymentSummaryReady && (
              <div
                className="homeowner-tracker-overlay"
                onClick={closePaymentTracker}
              >
                <section
                  id="homeowner-payment-tracker"
                  ref={trackerRef}
                  className="homeowner-payment-tracker"
                  aria-label="Monthly and annual payment tracker"
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    className="homeowner-tracker-close"
                    onClick={closePaymentTracker}
                    aria-label="Close payment tracker"
                  >
                    ×
                  </button>
                  <div className="homeowner-tracker-header">
                    <div className="homeowner-section-heading">
                      <Calendar size={18} />
                      <div>
                        <h3>Payment Tracker</h3>
                        <p>Payments for {selectedProperty.block}, Lot {selectedProperty.lot_number}.</p>
                      </div>
                    </div>
                    <div className="homeowner-tracker-controls">
                      <div className="homeowner-tracker-switch" aria-label="Tracker view">
                        <button
                          type="button"
                          className={trackerView === 'monthly' ? 'is-active' : ''}
                          aria-pressed={trackerView === 'monthly'}
                          onClick={() => { setTrackerView('monthly'); setExpandedTrackerMonth(null) }}
                        >
                          Monthly
                        </button>
                        <button
                          type="button"
                          className={trackerView === 'annual' ? 'is-active' : ''}
                          aria-pressed={trackerView === 'annual'}
                          onClick={() => { setTrackerView('annual'); setExpandedTrackerMonth(null) }}
                        >
                          Annual
                        </button>
                      </div>
                      {trackerView === 'monthly' && (
                        <label className="homeowner-tracker-year">
                          <span>Year</span>
                          <Select ariaLabel="Payment analytics year" value={String(trackerYear)} onChange={(value) => { setTrackerYear(Number(value)); setExpandedTrackerMonth(null) }} options={trackerYears.map((year) => ({ value: String(year), label: String(year) }))} />
                        </label>
                      )}
                    </div>
                  </div>

                  <div className="homeowner-tracker-table-wrap">
                    {trackerView === 'monthly' ? (
                      <table className="homeowner-tracker-table">
                        <thead>
                          <tr>
                            <th>Month</th>
                            <th>Status</th>
                            <th>Payments</th>
                            <th>Association Dues</th>
                            <th>Amenities &amp; Services</th>
                            <th>Other</th>
                            <th>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {monthlyTracker.map((month, monthIndex) => (
                            <tr key={month.month} className="homeowner-tracker-row">
                              <td>
                                <button
                                  type="button"
                                  className="homeowner-tracker-month-button"
                                  aria-haspopup="dialog"
                                  aria-label={`View ${month.month} ${trackerYear} payment breakdown`}
                                  onClick={() => setExpandedTrackerMonth(monthIndex)}
                                >
                                  <span aria-hidden="true">▸</span>
                                  <strong>{month.month}</strong>
                                  <span className="homeowner-tracker-click-hint">Details</span>
                                </button>
                              </td>
                              <td><span className={`homeowner-tracker-status tracker-${month.status.key}`}>{month.status.label}</span></td>
                              <td>{month.records.length}</td>
                              <td className="homeowner-number">{peso.format(month.dues)}</td>
                              <td className="homeowner-number">{peso.format(month.services)}</td>
                              <td className="homeowner-number">{peso.format(month.other)}</td>
                              <td className="homeowner-tracker-total">{peso.format(month.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <table className="homeowner-tracker-table annual">
                        <thead>
                          <tr>
                            <th>Year</th>
                            <th>Months with Payments</th>
                            <th>Payments</th>
                            <th>Association Dues</th>
                            <th>Amenities &amp; Services</th>
                            <th>Other</th>
                            <th>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {annualTracker.map((year) => (
                            <tr key={year.year}>
                              <td><strong>{year.year}</strong></td>
                              <td>{year.months} of 12</td>
                              <td>{year.transactions}</td>
                              <td className="homeowner-number">{peso.format(year.dues)}</td>
                              <td className="homeowner-number">{peso.format(year.services)}</td>
                              <td className="homeowner-number">{peso.format(year.other)}</td>
                              <td className="homeowner-tracker-total">{peso.format(year.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                  <p className="homeowner-tracker-note">
                    Voided records are excluded. A blank month means no payment was recorded; it does not automatically mean an unpaid balance.
                  </p>

                  <AccountActivity propertyId={selectedPropertyId} year={trackerView === 'monthly' ? trackerYear : undefined} refreshKey={detailReloadKey} />

                  {trackerView === 'monthly' && selectedTrackerMonth && createPortal(
                    <div className="homeowner-month-overlay" onClick={(event) => { event.stopPropagation(); setExpandedTrackerMonth(null) }}>
                      <section
                        ref={monthDialogRef}
                        className="homeowner-month-dialog"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="homeowner-month-dialog-title"
                        aria-describedby="homeowner-month-dialog-description"
                        tabIndex={-1}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <header className="homeowner-month-dialog-header">
                          <div>
                            <p className="homeowner-month-eyebrow">HOA PAYMENT RECORDS</p>
                            <h2 id="homeowner-month-dialog-title">{selectedTrackerMonth.month} {trackerYear} · Payment breakdown</h2>
                            <p id="homeowner-month-dialog-description">{selectedProperty?.homeowner_name} · {selectedProperty?.block} · Lot {selectedProperty?.lot_number}</p>
                          </div>
                          <button type="button" className="homeowner-month-close-icon" aria-label="Close monthly payment breakdown" onClick={() => setExpandedTrackerMonth(null)}>×</button>
                        </header>
                        <div className="homeowner-month-dialog-body">
                          <div className="homeowner-month-summary">
                            <div><span>Recorded activity</span><strong><span className={`homeowner-month-pill is-${selectedTrackerMonth.status.key}`}>{selectedTrackerMonth.status.label}</span></strong></div>
                            <div><span>Recorded transactions</span><strong>{selectedTrackerMonth.records.length}</strong></div>
                            <div><span>Total payments received</span><strong>{peso.format(selectedTrackerMonth.total)}</strong></div>
                          </div>
                          <div className="homeowner-month-transaction-section">
                          <h3 className="homeowner-month-section-title">Transactions recorded during this month</h3>
                          {selectedTrackerMonth.records.length > 0 ? (
                            <div className="homeowner-month-table-scroll" role="region" aria-label="Monthly payment transactions" tabIndex={0}>
                              <table className="homeowner-month-table">
                                <thead><tr><th scope="col">Date paid</th><th scope="col">Description / Coverage</th><th scope="col">Receipt / Method</th><th scope="col">Status</th><th scope="col">Amount paid</th></tr></thead>
                                <tbody>
                                  {selectedTrackerMonth.records.map((record) => {
                                    const paidDateText = formatDate(record.paidAt, organization.dateFormat)
                                    const dateSplit = paidDateText.indexOf(', ')
                                    const datePart = dateSplit >= 0 ? paidDateText.slice(0, dateSplit) : paidDateText
                                    const timePart = dateSplit >= 0 ? paidDateText.slice(dateSplit + 2) : ''
                                    return (
                                      <tr key={record.id}>
                                        <td><span className="homeowner-month-date-main">{datePart}</span>{timePart && <span className="homeowner-month-date-sub">{timePart}</span>}</td>
                                        <td><span className="homeowner-month-description-main">{record.description || '—'}</span><span className={`homeowner-month-pill homeowner-month-category-pill ${record.kind === 'dues' ? 'is-dues' : record.kind === 'services' ? 'is-services' : 'is-other'}`}>{record.category}</span></td>
                                        <td><span className="homeowner-month-receipt-main">{record.receipt}</span><span className="homeowner-month-receipt-sub">{record.method}</span></td>
                                        <td><span className={`homeowner-month-pill ${['paid', 'completed'].includes(String(record.statusKey).toLowerCase()) ? 'is-paid' : ['partial', 'pending'].includes(String(record.statusKey).toLowerCase()) ? 'is-partial' : String(record.statusKey).toLowerCase() === 'voided' ? 'is-voided' : 'is-neutral'}`}>{record.status}</span></td>
                                        <td className="homeowner-number">{peso.format(record.amount)}</td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="homeowner-month-empty">No payment transactions were recorded for this lot in {selectedTrackerMonth.month} {trackerYear}. This does not establish whether dues were paid or unpaid.</p>
                          )}
                          </div>
                          <div className="homeowner-month-bottom">
                            <p className="homeowner-month-clarification">Grouped by payment date in Manila time, not by the month covered by dues. Voided records are excluded. This is a payment activity summary, not a statement of outstanding balance or a certification that dues are fully paid.</p>
                            <div className="homeowner-month-totals" aria-label="Payment category totals">
                            <div><span>Association dues</span><strong className={Number(selectedTrackerMonth.dues) === 0 ? 'is-zero' : undefined}>{peso.format(selectedTrackerMonth.dues)}</strong></div>
                            <div><span>Amenities &amp; services</span><strong className={Number(selectedTrackerMonth.services) === 0 ? 'is-zero' : undefined}>{peso.format(selectedTrackerMonth.services)}</strong></div>
                            <div><span>Other</span><strong className={Number(selectedTrackerMonth.other) === 0 ? 'is-zero' : undefined}>{peso.format(selectedTrackerMonth.other)}</strong></div>
                            <div className="homeowner-month-grand-total"><span>Total received</span><strong>{peso.format(selectedTrackerMonth.total)}</strong></div>
                            </div>
                          </div>
                          <AccountActivity propertyId={selectedPropertyId} month={`${trackerYear}-${String(expandedTrackerMonth + 1).padStart(2, '0')}`} refreshKey={detailReloadKey} />
                        </div>
                        <footer className="homeowner-month-dialog-footer">
                          
                          <button type="button" className="homeowner-month-action-secondary" onClick={() => setExpandedTrackerMonth(null)}>Close</button>
                          <button type="button" className="homeowner-month-action-print" onClick={() => openPaymentMonthPrint({
                                          hoaName: organization.hoaName,
                                          preparedBy: currentUser?.full_name || currentUser?.email || 'Not recorded',
                                          preparedRole: currentUser?.role || '',
                                          homeownerName: selectedProperty?.homeowner_name,
                                          block: selectedProperty?.block,
                                          lot: selectedProperty?.lot_number,
                                          month: selectedTrackerMonth.month,
                                          year: trackerYear,
                                          records: selectedTrackerMonth.records,
                                          dues: selectedTrackerMonth.dues,
                                          services: selectedTrackerMonth.services,
                                          other: selectedTrackerMonth.other,
                                          total: selectedTrackerMonth.total,
                                        })}>
                            Print {selectedTrackerMonth.month} breakdown
                          </button>
                        </footer>
                      </section>
                    </div>, document.body
                  )}
                </section>
              </div>
            )}

            <nav className="homeowner-tabs" aria-label="Homeowner profile sections">
              {[
                ['overview', 'Overview', history.length],
                ['dues', 'Association Dues', duesPayments.length],
                ['services', 'Amenities & Services', selectedServices.length],
                ['other', 'Balance / Other Payments', otherPayments.length],
              ].map(([key, label, count]) => (
                <button
                  type="button"
                  key={key}
                  className={activeTab === key ? 'is-active' : ''}
                  onClick={() => setActiveTab(key)}
                >
                  {label}<span>{paymentSummaryReady ? count : '—'}</span>
                </button>
              ))}
            </nav>

            {activeTab === 'overview' && userRole === 'admin' && !formerAccount && selectedPropertyId != null && (
              <div className="homeowner-cctv-section" style={{ marginBottom: 16 }}>
                <CctvElectricityCompensation key={selectedPropertyId} fixedPropertyId={selectedPropertyId} canEdit onChanged={() => { setDetailReloadKey((key) => key + 1); void loadHomeowners(true) }} />
              </div>
            )}

            {activeTab === 'overview' && (
              <section className="homeowner-overview-grid">
                <article className="homeowner-info-card">
                  <div className="homeowner-section-heading">
                    <Home size={18} />
                    <div><h3>Property Information</h3><p>Registered property record</p></div>
                  </div>
                  <dl>
                    <div><dt>Homeowner</dt><dd>{selectedProperty.homeowner_name}</dd></div>
                    <div><dt>Block</dt><dd>{selectedProperty.block}</dd></div>
                    <div><dt>Lot</dt><dd>Lot {selectedProperty.lot_number}</dd></div>
                    <div><dt>Registered</dt><dd>{formatDate(selectedProperty.created_at, organization.dateFormat)}</dd></div>
                  </dl>
                </article>
                <article className="homeowner-info-card">
                  <div className="homeowner-section-heading">
                    <Phone size={18} />
                    <div><h3>Contact Information</h3><p>Homeowner communication details</p></div>
                  </div>
                  <dl>
                    <div><dt>Phone</dt><dd>{selectedProperty.contact_phone || 'Not provided'}</dd></div>
                    <div><dt>Email</dt><dd>{selectedProperty.contact_email || 'Not provided'}</dd></div>
                    <div><dt>Last updated</dt><dd>{formatDate(selectedProperty.contact_updated_at, organization.dateFormat)}</dd></div>
                  </dl>
                </article>
              </section>
            )}

            <section className="homeowner-history-card">
              <div className="homeowner-section-heading">
                {activeTab === 'services' ? <Calendar size={18} /> : <FileText size={18} />}
                <div>
                  <h3>{activeTab === 'overview' ? 'Recent Payment Activity' : 'Payment History'}</h3>
                  <p>HOA balances are shown at receipt issuance. Service balances are the amount still due on the invoice.</p>
                </div>
                <label className="homeowner-history-month-picker">
                  <span>Payment month</span>
                  <DateField
                    ariaLabel="Filter payment history by month"
                    monthOnly
                    value={historyMonth}
                    onChange={setHistoryMonth}
                  />
                </label>
              </div>
              <div className="homeowner-history-table-wrap">
                <table className="homeowner-history-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Receipt</th>
                      <th>Category</th>
                      <th>Description</th>
                      <th>Method</th>
                      <th>Amount</th>
                      <th>Recorded balance</th>
                      <th>Status</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {!paymentSummaryReady ? (
                      <tr><td colSpan="9" role="status">{paymentSummaryLoading ? 'Loading payment records…' : 'Payment records are unavailable. Refresh to retry.'}</td></tr>
                    ) : historyMonthRows.length === 0 ? (
                      <tr><td colSpan="9" className="homeowners-empty">No payment records for the selected month and category.</td></tr>
                    ) : (
                      historyMonthRows.map((item) => (
                        <tr key={item.id}>
                          <td>{formatDate(item.paidAt, organization.dateFormat)}</td>
                          <td><strong>{item.receipt}</strong></td>
                          <td><span className={`homeowner-category category-${item.kind}`}>{item.category}</span></td>
                          <td title={item.description}>{item.description}</td>
                          <td title={item.method}>{item.method}</td>
                          <td className="homeowner-number">{peso.format(item.amount)}</td>
                          <td className={item.remaining > 0 ? 'homeowner-balance' : item.remaining < 0 ? 'homeowner-credit' : 'homeowner-number'}>
                            {item.remaining == null ? '—' : item.remaining < 0 ? `${peso.format(Math.abs(item.remaining))} credit` : peso.format(item.remaining)}
                          </td>
                          <td><span className={`homeowner-payment-status status-${normalize(item.status).replace(/\s+/g, '-')}`}>{item.status}</span></td>
                          <td>
                            <div className="homeowner-history-actions">
                              <button type="button" className="homeowner-receipt-view-link" onClick={() => openHomeownerHistoryReceipt(item)} disabled={Boolean(openingHistoryReceipt)}>
                                {openingHistoryReceipt === item.id ? 'Opening…' : 'View'}
                              </button>
                              {!formerAccount && canVoidPayments && item.id.startsWith('payment-') && item.statusKey !== 'voided' && (
                                <button type="button" className="homeowner-void-link" onClick={() => openVoid(item)}>Void</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
            <AccountActivity propertyId={selectedPropertyId} month={historyMonth} refreshKey={detailReloadKey} />
          </>
        )}
      </main>

      {!formerAccount && canManageBlocks && classificationPropertyId != null &&
        selectedProperty &&
        String(selectedProperty.id) === String(classificationPropertyId) && (
          <dialog
            ref={classificationDialogRef}
            className="phase1d-dialog"
            aria-labelledby="phase1d-dialog-title"
            onClose={() => { setClassificationPropertyId(null); document.querySelector('.homeowner-actions-disclosure > button')?.focus() }}
          >
            <header className="phase1d-dialog-header">
              <div>
                <h2 id="phase1d-dialog-title">Property Classification</h2>
                <p>{selectedProperty.block}, Lot {selectedProperty.lot_number}</p>
              </div>
              <button
                type="button"
                className="phase1d-dialog-close"
                aria-label="Close property classification"
                onClick={() => classificationDialogRef.current?.close()}
              >
                <span aria-hidden="true">×</span>
              </button>
            </header>
            <PropertyClassificationPanel
              key={selectedProperty.id}
              propertyId={selectedProperty.id}
              userRole={userRole}
              onChanged={() => loadHomeowners(true)}
              onClose={() => classificationDialogRef.current?.close()}
            />
          </dialog>
        )}
      {historyReceiptError && (
        <ActionDialog open title="Receipt unavailable" message={historyReceiptError} onConfirm={() => setHistoryReceiptError('')} />
      )}
      {historyReceipt && historyReceipt.propertyId === selectedPropertyId && (() => {
        const receiptModel = buildReceiptModel(historyReceipt.kind, historyReceipt.row, organization, {
          settledAmount: historySettlement.amount,
        })
        return (
          <ReceiptDialog
            model={receiptModel}
            verificationLoading={historySettlement.loading}
            verificationError={historySettlement.error}
            onClose={() => setHistoryReceipt(null)}
            onPrint={(setup) => printReceipt(receiptModel, setHistoryPrintNotice, setup)}
          />
        )
      })()}
      <ActionDialog
        open={Boolean(historyPrintNotice)}
        title="Print window blocked"
        message={historyPrintNotice}
        onConfirm={() => setHistoryPrintNotice('')}
      />
      {voidTarget && (
        <div className="homeowner-void-overlay" onMouseDown={() => !voiding && setVoidTarget(null)}>
          <form className="homeowner-void-dialog" onSubmit={confirmVoid} onMouseDown={(e) => e.stopPropagation()}>
            <div className="homeowner-void-icon" aria-hidden="true">!</div>
            <h2>Void payment</h2>
            <p>
              {voidTarget.receipt_number} — {voidTarget.homeowner_name} — {peso.format(Number(voidTarget.amount_paid) || 0)}
              <br />
              The homeowner's balance is corrected automatically. This cannot be undone.
            </p>
            <label>Reason (required)
              <textarea value={voidReason} onChange={(e) => { setVoidReason(e.target.value); setVoidError('') }} rows="3" maxLength="250" placeholder="e.g., Wrong amount typed" autoFocus />
            </label>
            {voidError && <p className="homeowner-void-error">{voidError}</p>}
            <div className="homeowner-void-actions">
              <button type="button" className="button-cancel" onClick={() => setVoidTarget(null)} disabled={voiding}>Cancel</button>
              <button type="submit" className="homeowner-void-confirm" disabled={voiding}>{voiding ? 'Voiding...' : 'Void payment'}</button>
            </div>
          </form>
        </div>
      )}
      {balanceDialog && canManageBalances && isActiveHomeowner(balanceDialog) && (
        <BalanceEntryDialog
          property={balanceDialog}
          currentUser={currentUser}
          onClose={() => setBalanceDialog(null)}
          onSaved={(message) => {
            setBalanceDialog(null)
            setNotice(message)
            setBreakdownKey((key) => key + 1)
            loadHomeowners(true)
          }}
        />
      )}
      <HomeownerAdminDialogs
        dialog={adminDialog}
        currentUser={currentUser}
        canManage={canManageHomeowners}
        canManageBlocks={canManageBlocks}
        onClose={() => setAdminDialog(null)}
        onChanged={handleAdminChanged}
      />
    </div>
  )
}
// ---------------------------------------------------------------------------
// Manage Blocks + Add/Edit Homeowner dialogs (moved here from Ledger and Contact Manager).
// Only Admin and Secretary ever see the buttons that open them; the database enforces the
// same rule, so a Treasurer could not save a change even if the dialog were opened.
// ---------------------------------------------------------------------------

// Management actions are audited transactionally by the database.


// dialog: null | { type: 'blocks' } | { type: 'homeowner' | 'lot', property }
// canManage: true for active Admin, Secretary, or Treasurer; block management is separate.
// onChanged: called after a change the page should reload for; receives { message }
function HomeownerAdminDialogs({ dialog, currentUser, canManage, canManageBlocks, onClose, onChanged }) {
  const confirm = useConfirm()


  const [blocks, setBlocks] = useState([])
  const [blocksLoading, setBlocksLoading] = useState(false)
  const [blocksLoadError, setBlocksLoadError] = useState('')

  const [homeownerForm, setHomeownerForm] = useState(EMPTY_HOMEOWNER)
  const [editingHomeownerId, setEditingHomeownerId] = useState(null)
  const [formError, setFormError] = useState('')
  const [savingHomeowner, setSavingHomeowner] = useState(false)

  const [newBlockName, setNewBlockName] = useState('')
  const [blockError, setBlockError] = useState('')
  const [savingBlock, setSavingBlock] = useState(false)
  const [editingBlockId, setEditingBlockId] = useState(null)
  const [editingBlockName, setEditingBlockName] = useState('')
  const [blockActionError, setBlockActionError] = useState('')
  const [blockActionBusyId, setBlockActionBusyId] = useState(null)

  // Small "Add Block" dialog opened from the "+ Add Block" option inside the Add Homeowner form.
  const [showQuickBlock, setShowQuickBlock] = useState(false)
  const [quickBlockName, setQuickBlockName] = useState('')
  const [quickBlockError, setQuickBlockError] = useState('')
  const [savingQuickBlock, setSavingQuickBlock] = useState(false)

  const dialogType = dialog?.type || null

  async function loadBlocks() {
    setBlocksLoading(true)
    setBlocksLoadError('')

    const { data, error } = await supabase.from('blocks').select('id, name').order('name')

    if (error) {
      setBlocks([])
      setBlocksLoadError(`Block list could not be loaded: ${error.message}`)
    } else {
      setBlocks(data || [])
    }

    setBlocksLoading(false)
  }

  // Every time a dialog is opened: reset the forms and load the current block list.
  useEffect(() => {
    if (!dialog) return

    setFormError('')
    setBlockError('')
    setBlockActionError('')
    setNewBlockName('')
    setEditingBlockId(null)
    setEditingBlockName('')
    setShowQuickBlock(false)

    if (dialog.type === 'homeowner' || dialog.type === 'lot') {
      const property = dialog.property
      setHomeownerForm(
        property
          ? {
              homeownerName: property.homeowner_name || '',
              blockName: dialog.type === 'lot' ? '' : property.block || '',
              lotNumber: dialog.type === 'lot' ? '' : String(property.lot_number ?? ''),
              lotSizeSqm: dialog.type === 'lot' || property.lot_size_sqm == null ? '' : String(property.lot_size_sqm),
            }
          : EMPTY_HOMEOWNER,
      )
      setEditingHomeownerId(property && dialog.type !== 'lot' ? property.id : null)
    }

    loadBlocks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog])

  // ---------------------------------------------------------------- Homeowner

  function closeHomeownerForm() {
    if (savingHomeowner) return
    setFormError('')
    onClose()
  }

  function updateHomeownerField(event) {
    const { name, value } = event.target

    if (name === 'blockName' && value === ADD_BLOCK_OPTION) {
      setHomeownerForm((current) => ({ ...current, blockName: '' }))
      setFormError('')
      setQuickBlockName('')
      setQuickBlockError('')
      setShowQuickBlock(true)
      return
    }

    setHomeownerForm((current) => ({ ...current, [name]: value }))
    setFormError('')
  }

  async function handleSaveHomeowner(event) {
    event.preventDefault()

    if (!canManage) {
      setFormError('Only an Admin, Secretary, or Treasurer can manage homeowners.')
      return
    }

    if (dialog.type === 'lot' && !dialog.property?.homeowner_id) {
      setFormError('Refresh the homeowner profile before adding a lot.')
      return
    }

    const homeownerName = homeownerForm.homeownerName.trim().replace(/\s+/g, ' ')
    const blockName = homeownerForm.blockName.trim()
    const lotNumber = Number(homeownerForm.lotNumber)

    if (!homeownerName || !blockName || !homeownerForm.lotNumber) {
      setFormError('Homeowner name, block, and lot number are required.')
      return
    }

    if (!Number.isInteger(lotNumber) || lotNumber <= 0) {
      setFormError('Lot number must be a whole number greater than zero.')
      return
    }

        const existingLot = editingHomeownerId ? dialog?.property?.lot_size_sqm : null
    const rawLot = String(homeownerForm.lotSizeSqm ?? '').trim()
    let lotSizeSqm = null
    if (rawLot !== '' || !editingHomeownerId || existingLot != null) {
      const parsedLot = parsePositiveAmount(rawLot, 'Lot size', { maxInt: 8 })
      if (parsedLot.error) {
        setFormError(parsedLot.error)
        return
      }
      lotSizeSqm = parsedLot.value
    }

    setSavingHomeowner(true)
    setFormError('')

    const payload = {
      homeowner_name: homeownerName,
      block: blockName,
      lot_number: lotNumber,
      ...(lotSizeSqm !== null && { lot_size_sqm: lotSizeSqm }),
    }
    let data
    try {
      if (editingHomeownerId) {
        const original = dialog.property
        const changes = Object.fromEntries(Object.entries(payload).filter(([field, value]) => {
          return field === 'lot_size_sqm' ? Number(value) !== Number(original[field]) : value !== original[field]
        }))
        if (Object.keys(changes).length === 0) {
          setSavingHomeowner(false)
          onClose()
          return
        }
        data = await updateHomeowner(supabase, editingHomeownerId, changes, original)
      } else if (dialog.type === 'lot') {
        const { data: id, error } = await supabase.rpc('add_homeowner_lot', {
          p_source_property_id: dialog.property.id,
          p_expected_homeowner_id: dialog.property.homeowner_id,
          p_block: payload.block,
          p_lot_number: payload.lot_number,
          p_lot_size_sqm: payload.lot_size_sqm,
        })
        if (error) throw error
        if (id == null) throw new Error('The new lot could not be confirmed. Refresh before trying again.')
        data = { id }
      } else {
        const result = await supabase.from('properties').insert(payload).select('id').single()
        if (result.error) throw result.error
        if (result.data?.id == null) throw new Error('The new homeowner could not be confirmed. Refresh before trying again.')
        data = result.data
      }
    } catch (error) {
      setFormError(
        isDuplicateLotError(error)
          ? duplicateLotMessage(blockName, lotNumber)
          : error.message,
      )
      setSavingHomeowner(false)
      return
    }

    const wasEditing = Boolean(editingHomeownerId)
    setSavingHomeowner(false)
    setHomeownerForm(EMPTY_HOMEOWNER)
    setEditingHomeownerId(null)
    onClose()
    if (onChanged) {
      onChanged({
        ...(dialog.type === 'lot' && { propertyId: data.id }),
        message: dialog.type === 'lot'
          ? `Lot ${lotNumber} was added for ${homeownerName}.`
          : wasEditing
          ? `Homeowner ${homeownerName} was updated.`
          : `Homeowner ${homeownerName} was added.`,
      })
    }


  }

  // ------------------------------------------------------------ Quick add block

  function closeQuickBlock() {
    if (savingQuickBlock) return
    setShowQuickBlock(false)
    setQuickBlockError('')
  }

  async function saveQuickBlock(event) {
    event.preventDefault()

    if (!canManageBlocks) {
      setQuickBlockError('Only an Admin or Secretary can add blocks.')
      return
    }

    const name = quickBlockName.trim().replace(/\s+/g, ' ')

    if (!name) {
      setQuickBlockError('Enter a block name.')
      return
    }

    if (blocks.some((block) => normalize(block.name) === normalize(name))) {
      setQuickBlockError('That block already exists.')
      return
    }

    setSavingQuickBlock(true)
    setQuickBlockError('')

    const { data, error } = await supabase
      .from('blocks')
      .insert({ name })
      .select('id, name')
      .single()

    if (error) {
      setQuickBlockError(error.code === '23505' ? 'That block already exists.' : error.message)
      setSavingQuickBlock(false)
      return
    }

    setBlocks((current) => [...current, data].sort((a, b) => a.name.localeCompare(b.name)))
    setSavingQuickBlock(false)
    setShowQuickBlock(false)
    setQuickBlockName('')
    setHomeownerForm((current) => ({ ...current, blockName: data.name }))
    notifySuccess(`Block ${data.name} was added.`)


  }

  // ------------------------------------------------------------- Manage Blocks

  async function handleAddBlock(event) {
    event.preventDefault()

    if (!canManageBlocks) {
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

    await loadBlocks()
    setNewBlockName('')
    setSavingBlock(false)
    notifySuccess(`Block ${name} was added.`)


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

    // The foreign key cascades the rename to every property in one transaction.
    const { data: renamedBlock, error: renameError } = await supabase
      .from('blocks')
      .update({ name: newName })
      .eq('id', block.id)
      .eq('name', block.name)
      .select('id, name')
      .single()

    if (renameError || !renamedBlock) {
      setBlockActionError(renameError?.message || 'The block changed or is no longer available. Refresh and try again.')
      setBlockActionBusyId(null)
      return
    }

    await loadBlocks()
    setBlockActionBusyId(null)
    cancelEditBlock()

    if (onChanged) {
      onChanged({ message: `Block ${block.name} was renamed to ${newName}.` })
    }


  }

  async function handleDeleteBlock(block) {
    setBlockActionError('')
    setBlockActionBusyId(block.id)

    // Checked in the database: any homeowner record (active or historical) blocks the delete.
    const { count, error: countError } = await supabase
      .from('properties')
      .select('id', { count: 'exact', head: true })
      .eq('block', block.name)

    if (countError) {
      setBlockActionError(`Could not check this block: ${countError.message}`)
      setBlockActionBusyId(null)
      return
    }

    if ((count || 0) > 0) {
      setBlockActionError(
        `${block.name} cannot be deleted — ${count} homeowner record(s) (active or historical) are still assigned to it. Delete or reassign them first.`,
      )
      setBlockActionBusyId(null)
      return
    }

    setBlockActionBusyId(null)

    const confirmed = await confirm({
      title: `Delete ${block.name}?`,
      message: "No homeowners are assigned to this block. This can't be undone.",
      confirmLabel: 'Delete block',
      cancelLabel: 'Keep block',
      tone: 'danger',
    })
    if (!confirmed) return

    setBlockActionBusyId(block.id)

    // The foreign key rechecks assignment atomically, including concurrent inserts.
    const { data: removedBlock, error } = await supabase.from('blocks').delete()
      .eq('id', block.id).eq('name', block.name).select('id').single()

    if (error || !removedBlock) {
      setBlockActionError(['23503', '23001'].includes(error?.code)
        ? 'This block still has homeowner records (active or historical). Reassign them before deleting it.'
        : `Could not delete block: ${error?.message || 'The block changed or is no longer available. Refresh and try again.'}`)
      setBlockActionBusyId(null)
      return
    }

    await loadBlocks()
    setBlockActionBusyId(null)

    notifySuccess(`Block ${block.name} was deleted.`)

  }

  if (!dialog) return null

  return (
    <>
      {(dialogType === 'homeowner' || dialogType === 'lot') && canManage && (
        <div className="hod-backdrop" onMouseDown={closeHomeownerForm}>
          <form
            className="hod-modal"
            onSubmit={handleSaveHomeowner}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="hod-heading">
              <div>
                <h2>{dialogType === 'lot' ? 'Add Lot' : editingHomeownerId ? 'Edit Homeowner' : 'Add New Homeowner'}</h2>
                <p>
                  {dialogType === 'lot'
                    ? `Add a separate lot for ${dialog.property.homeowner_name}. The lot starts unclassified until an Admin or Secretary verifies its property type.`
                    : editingHomeownerId
                    ? 'Name changes apply to all linked lots. Changes to block, lot number, and area apply to this lot. The area is used for future dues.'
                    : 'Add the homeowner and assign an available block and lot.'}
                </p>
              </div>
              <button type="button" className="hod-close" onClick={closeHomeownerForm} aria-label="Close">×</button>
            </div>

            {dialogType !== 'lot' && (
              <>
                <label htmlFor="hod-homeowner-name">Homeowner full name</label>
                <input
                  id="hod-homeowner-name"
                  name="homeownerName"
                  value={homeownerForm.homeownerName}
                  onChange={updateHomeownerField}
                  maxLength="120"
                  autoFocus
                  required
                />
              </>
            )}

            <div className="hod-row">
              <div>
                <label htmlFor="hod-homeowner-block">Block</label>
                <Select ariaLabel="Block" value={homeownerForm.blockName} onChange={(value) => updateHomeownerField({ target: { name: 'blockName', value } })} options={[{ value: '', label: 'Select block' }, ...blocks.map((block) => ({ value: block.name, label: block.name })), ...(canManageBlocks ? [{ value: ADD_BLOCK_OPTION, label: '+ Add Block' }] : [])]} />
              </div>
              <div>
                <label htmlFor="hod-homeowner-lot">Lot number</label>
                <input
                  id="hod-homeowner-lot"
                  name="lotNumber"
                  type="number"
                  min="1"
                  step="1"
                  value={homeownerForm.lotNumber}
                  onChange={updateHomeownerField}
                  placeholder="e.g., 12"
                  required
                />
              </div>
            </div>

     <div>
    <label htmlFor="hod-homeowner-lot-size">Lot size (sqm)</label>
    <input
      id="hod-homeowner-lot-size"
      name="lotSizeSqm"
      type="number"
      inputMode="decimal"
      min="0.01"
      step="0.01"
      value={homeownerForm.lotSizeSqm}
      onChange={updateHomeownerField}
      placeholder="e.g., 150.50"
    />
  </div>


            {blocksLoadError && <p className="hod-error">{blocksLoadError}</p>}
            {!blocksLoading && !blocksLoadError && blocks.length === 0 && (
              <p className="hod-note">
                No blocks are available. Ask an Admin or Secretary to create a block before adding a homeowner.
              </p>
            )}
            {formError && <p className="hod-error">{formError}</p>}

            <div className="hod-actions">
              <button type="button" className="hod-cancel" onClick={closeHomeownerForm} disabled={savingHomeowner}>
                Cancel
              </button>
              <button type="submit" className="hod-save" disabled={savingHomeowner || blocks.length === 0}>
                {savingHomeowner
                  ? 'Saving...'
                  : editingHomeownerId
                    ? 'Save Changes'
                    : dialogType === 'lot' ? 'Save Lot' : 'Save Homeowner'}
              </button>
            </div>
          </form>
        </div>
      )}

      {dialogType === 'blocks' && canManageBlocks && (
        <div
          className="hod-backdrop"
          onMouseDown={() => !savingBlock && !blockActionBusyId && onClose()}
        >
          <div className="hod-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="hod-heading">
              <div>
                <h2>Manage Blocks</h2>
                <p>Rename or remove existing blocks, or add a new one. Blocks with homeowners still assigned to them can't be deleted.</p>
              </div>
              <button type="button" className="hod-close" onClick={onClose} aria-label="Close">×</button>
            </div>

            {blocksLoadError && <p className="hod-error">{blocksLoadError}</p>}
            {blockActionError && <p className="hod-error">{blockActionError}</p>}

            <ul className="hod-blocks-list">
              {blocksLoading && blocks.length === 0 && <li className="hod-note" aria-busy="true"><Skeleton variant="rect" width="100%" height="40px" /><Skeleton variant="rect" width="100%" height="40px" /><span className="skeleton-region-status" role="status">Loading</span></li>}
              {!blocksLoading && blocks.length === 0 && <li className="hod-note">No blocks yet.</li>}
              {blocks.map((block) => (
                <li key={block.id} className="hod-block-row">
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
                        className="hod-icon-btn"
                        onClick={() => handleRenameBlock(block)}
                        disabled={blockActionBusyId === block.id}
                      >
                        {blockActionBusyId === block.id ? 'Saving...' : 'Save'}
                      </button>
                      <button type="button" className="hod-icon-btn button-cancel" onClick={cancelEditBlock}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <span>{block.name}</span>
                      <button type="button" className="hod-icon-btn" onClick={() => startEditBlock(block)}>Edit</button>
                      <button
                        type="button"
                        className="hod-icon-btn hod-icon-btn-danger"
                        onClick={() => handleDeleteBlock(block)}
                        disabled={blockActionBusyId === block.id}
                      >
                        {blockActionBusyId === block.id ? 'Working...' : 'Delete'}
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>

            <form className="hod-add-block" onSubmit={handleAddBlock}>
              <label htmlFor="hod-block-name">Add a block</label>
              <div className="hod-row hod-row-inline">
                <input
                  id="hod-block-name"
                  value={newBlockName}
                  onChange={(event) => {
                    setNewBlockName(event.target.value)
                    setBlockError('')
                  }}
                  placeholder="e.g., Block F"
                  maxLength="50"
                />
                <button type="submit" className="hod-save" disabled={savingBlock}>
                  {savingBlock ? 'Saving...' : 'Add Block'}
                </button>
              </div>
              {blockError && <p className="hod-error">{blockError}</p>}
            </form>

            <div className="hod-actions">
              <button type="button" className="hod-cancel" onClick={onClose}>Close</button>
            </div>
          </div>
        </div>
      )}

      {showQuickBlock && canManageBlocks && (
        <div className="hod-backdrop" onMouseDown={closeQuickBlock}>
          <form
            className="hod-modal"
            onSubmit={saveQuickBlock}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="hod-heading">
              <div>
                <h2>Add Block</h2>
                <p>Create a new block before assigning homeowners to it.</p>
              </div>
              <button type="button" className="hod-close" onClick={closeQuickBlock} aria-label="Close">×</button>
            </div>

            <label htmlFor="hod-quick-block-name">Block name</label>
            <input
              id="hod-quick-block-name"
              value={quickBlockName}
              onChange={(event) => {
                setQuickBlockName(event.target.value)
                setQuickBlockError('')
              }}
              placeholder="e.g., Block F"
              maxLength="50"
              autoFocus
              required
            />

            {quickBlockError && <p className="hod-error">{quickBlockError}</p>}

            <div className="hod-actions">
              <button type="button" className="hod-cancel" onClick={closeQuickBlock} disabled={savingQuickBlock}>
                Cancel
              </button>
              <button type="submit" className="hod-save" disabled={savingQuickBlock}>
                {savingQuickBlock ? 'Saving...' : 'Save Block'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
