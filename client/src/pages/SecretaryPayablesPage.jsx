import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, DollarSign } from '../components/Icons'
import BlockPayablesSection from '../components/BlockPayablesSection'
import HomeownerLedgerModal from '../components/HomeownerLedgerModal'
import { supabase } from '../lib/supabaseClient'
import { useOrganization } from '../context/OrganizationContext'
import { computeLateFee } from '../lib/latepenalty'
import './SecretaryPayables.css'

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
})

const normalize = (value) => String(value ?? '').trim().toLowerCase()

function paymentMatchesProperty(payment, property) {
  if (payment.property_id != null) {
    return Number(payment.property_id) === Number(property.id)
  }

  return (
    normalize(payment.homeowner_name) === normalize(property.homeowner_name) &&
    normalize(payment.block_name) === normalize(property.block) &&
    normalize(payment.lot_number).replace(/^lot\s*/, '') ===
      String(property.lot_number)
  )
}

export default function SecretaryPayablesPage({ user: suppliedUser }) {
  const { organization } = useOrganization()
  const navigate = useNavigate()
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [blocks, setBlocks] = useState([])
  const [properties, setProperties] = useState([])
  const [payments, setPayments] = useState([])
  const [penaltySettings, setPenaltySettings] = useState({ duesAmount: 0, dueDay: 5, gracePeriodDays: 0, latePenalty: 0 })
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [expandedBlockId, setExpandedBlockId] = useState(null)
  const [selectedHomeowner, setSelectedHomeowner] = useState(null)
  const [showLedgerModal, setShowLedgerModal] = useState(false)

  const role = currentUser?.role?.trim().toLowerCase()
  const canManagePayments = role === 'secretary' || role === 'treasurer'
  useEffect(() => {
    loadPage()
    resolveCurrentUser()
  }, [])

  async function resolveCurrentUser() {
    if (suppliedUser) {
      setCurrentUser(suppliedUser)
      return
    }

    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !authUser) return

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .single()

    if (!profileError) setCurrentUser(profile)
  }

  async function loadPage() {
    setLoading(true)
    setPageError('')

    const [blockResult, propertyResult, paymentResult, settingsResult] =
      await Promise.all([
        supabase.from('blocks').select('id, name').order('name'),
        supabase
          .from('properties')
          .select('id, block, lot_number, homeowner_name, homeowner_status')
          .order('homeowner_name'),
        supabase
          .from('payments')
          .select('*')
          .order('paid_at', { ascending: false }),
        supabase
          .from('system_settings')
          .select('dues_amount, due_day, grace_period_days, late_penalty')
          .eq('id', 1)
          .maybeSingle(),
      ])

    const errors = [
      blockResult.error,
      propertyResult.error,
      paymentResult.error,
      settingsResult.error,
    ].filter(Boolean)

    if (errors.length > 0) {
      setPageError(
        `Some collection records could not be loaded: ${errors
          .map((error) => error.message)
          .join(' ')}`,
      )
    }

    setBlocks(blockResult.data || [])
    setProperties(propertyResult.data || [])
    setPayments(paymentResult.data || [])
    setPenaltySettings({
      duesAmount: Number(settingsResult.data?.dues_amount) || 0,
      dueDay: Number(settingsResult.data?.due_day) || 5,
      gracePeriodDays: Number(settingsResult.data?.grace_period_days) || 0,
      latePenalty: Number(settingsResult.data?.late_penalty) || 0,
    })
    setLoading(false)
  }

  const homeownersByBlock = useMemo(() => {
    const grouped = new Map()

    properties.forEach((property) => {
      if ((property.homeowner_status || 'active') !== 'active') return

      const propertyPayments = payments.filter((payment) =>
        paymentMatchesProperty(payment, property),
      )
      const activePayments = propertyPayments.filter(
        (payment) => payment.status !== 'Voided',
      )
      const latestPayment = activePayments[0]
      const amountDue = latestPayment
        ? Number(latestPayment.remaining_balance) || 0
        : penaltySettings.duesAmount
      const lateFee = computeLateFee({
        balance: amountDue,
        dueDay: penaltySettings.dueDay,
        gracePeriodDays: penaltySettings.gracePeriodDays,
        latePenalty: penaltySettings.latePenalty,
      })
      const overdue = lateFee.isOverdue ? amountDue : 0

      const homeowner = {
        id: property.id,
        name: property.homeowner_name,
        block: property.block,
        lot: `Lot ${property.lot_number}`,
        address: `Lot ${property.lot_number}, ${property.block}`,
        status: amountDue <= 0
          ? 'paid'
          : overdue > 0
            ? 'overdue'
            : 'pending',
        lastPayment: latestPayment?.paid_at
          ? organization.formatDate(latestPayment.paid_at)
          : 'No payment yet',
        amountDue,
        penaltyAmount: lateFee.penaltyAmount,
        totalDue: lateFee.totalDue,
        daysOverdue: lateFee.daysOverdue,
        unallocatedCredit: 0,
        avatar: '🏠',
        payments: propertyPayments,
      }

      const key = normalize(property.block)
      grouped.set(key, [...(grouped.get(key) || []), homeowner])
    })

    return grouped
  }, [penaltySettings, payments, properties])

  const blockSummaries = useMemo(() => {
    const knownBlocks = [...blocks]

    properties.forEach((property) => {
      if ((property.homeowner_status || 'active') !== 'active') return
      if (!knownBlocks.some((block) => normalize(block.name) === normalize(property.block))) {
        knownBlocks.push({ id: `property-${property.block}`, name: property.block })
      }
    })

    return knownBlocks.map((block) => {
      const homeowners = homeownersByBlock.get(normalize(block.name)) || []
      const paidAccounts = homeowners.filter(
        (homeowner) => homeowner.amountDue <= 0,
      ).length
      const unpaidAccounts = homeowners.length - paidAccounts
      const totalOutstanding = homeowners.reduce(
        (sum, homeowner) => sum + homeowner.amountDue,
        0,
      )

      return {
        ...block,
        totalUnits: homeowners.length,
        paidAccounts,
        unpaidAccounts,
        collectionRate:
          homeowners.length > 0
            ? Math.round((paidAccounts / homeowners.length) * 100)
            : 0,
        totalOutstanding,
        homeowners,
      }
    })
  }, [blocks, homeownersByBlock, properties])

  const totals = useMemo(
    () =>
      blockSummaries.reduce(
        (result, block) => ({
          outstanding: result.outstanding + block.totalOutstanding,
          accounts: result.accounts + block.unpaidAccounts,
        }),
        { outstanding: 0, accounts: 0 },
      ),
    [blockSummaries],
  )

  function handleBlockToggle(blockId) {
    setExpandedBlockId((current) => (current === blockId ? null : blockId))
  }

  function handleViewLedger(homeowner) {
    setSelectedHomeowner(homeowner)
    setShowLedgerModal(true)
  }

  function handlePayDues(homeowner) {
    if (!canManagePayments) return

    navigate('/payments', {
      state: {
        prefill: {
          propertyId: String(homeowner.id),
          homeownerName: homeowner.name,
          blockName: homeowner.block,
          lotNumber: String(homeowner.lot).replace(/^lot\s*/i, ''),
          paymentPurpose: 'Association Dues',
          previousBalance: String(homeowner.amountDue || 0),
        },
      },
    })
  }

  function closeLedger() {
    setShowLedgerModal(false)
    setSelectedHomeowner(null)
  }

  return (
    <div className="secretary-payables-page">
      <div className="payables-header">
        <div>
          <h1>Payables & Collections</h1>
          <p>Review block collections, homeowner balances, and payment history.</p>
        </div>
        <div className="header-stats">
          <div className="stat-badge">
            <DollarSign size={20} />
            <span>{loading ? 'Loading...' : `${peso.format(totals.outstanding)} outstanding`}</span>
          </div>
          <div className="stat-badge">
            <AlertCircle size={20} />
            <span>{loading ? '—' : totals.accounts} outstanding account{totals.accounts === 1 ? '' : 's'}</span>
          </div>
        </div>
      </div>

      {pageError && <p className="payables-error">{pageError}</p>}

      <div className="payables-content">
        {loading ? (
          <div className="payables-state">Loading payables and collections...</div>
        ) : blockSummaries.length === 0 ? (
          <div className="payables-state">No blocks or homeowner records found.</div>
        ) : (
         <div className="blocks-stack">
  {blockSummaries.map((block) => (
    <BlockPayablesSection
      key={block.id}
      block={block}
      homeowners={block.homeowners}
      canRecordPayment={canManagePayments}
      isExpanded={expandedBlockId === block.id}
      onToggle={() => handleBlockToggle(block.id)}
      onViewLedger={handleViewLedger}
      onPayDues={handlePayDues}
    />
  ))}
</div>
        )}
      </div>

      {showLedgerModal && selectedHomeowner && (
        <HomeownerLedgerModal
          homeowner={selectedHomeowner}
          ledger={selectedHomeowner.payments.map((payment) => ({
            id: payment.id,
            date: organization.formatDate(payment.paid_at),
            type: 'Payment',
            description: payment.coverage_period,
            amount: -(Number(payment.amount_paid) || 0),
            balance: Number(payment.remaining_balance) || 0,
          }))}
          canRecordPayment={canManagePayments}
          onClose={closeLedger}
          onPayClick={() => {
            closeLedger()
            handlePayDues(selectedHomeowner)
          }}
        />
      )}
    </div>
  )
}