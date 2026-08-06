import React, { useEffect, useMemo, useState } from 'react'
import { AlertCircle, DollarSign } from '../components/Icons'
import BlockOverviewCard from '../components/BlockOverviewCard'
import ExpandedBlockView from '../components/ExpandedBlockView'
import HomeownerLedgerModal from '../components/HomeownerLedgerModal'
import PaymentCheckoutModal from '../components/PaymentCheckoutModal'
import ReceiptModal from '../components/ReceiptModal'
import { supabase } from '../lib/supabaseClient'
import { fetchLedgerAccounts, postLedgerPayment } from '../lib/hoaLedger'
import './SecretaryPayables.css'

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
})

const date = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeZone: 'Asia/Manila',
})

const normalize = (value) => String(value ?? '').trim().toLowerCase()

function currentManilaPeriod() {
  return new Intl.DateTimeFormat('en-PH', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  }).format(new Date())
}

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
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [blocks, setBlocks] = useState([])
  const [properties, setProperties] = useState([])
  const [payments, setPayments] = useState([])
  const [ledgerAccounts, setLedgerAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [expandedBlockId, setExpandedBlockId] = useState(null)
  const [selectedHomeowner, setSelectedHomeowner] = useState(null)
  const [showLedgerModal, setShowLedgerModal] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [paymentData, setPaymentData] = useState(null)
  const [receiptData, setReceiptData] = useState(null)

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

    const [blockResult, propertyResult, paymentResult, accountResult] =
      await Promise.all([
        supabase.from('blocks').select('id, name').order('name'),
        supabase
          .from('properties')
          .select('id, block, lot_number, homeowner_name')
          .order('homeowner_name'),
        supabase
          .from('payments')
          .select('*')
          .order('paid_at', { ascending: false }),
        fetchLedgerAccounts()
          .then((data) => ({ data, error: null }))
          .catch((error) => ({ data: [], error })),
      ])

    const errors = [
      blockResult.error,
      propertyResult.error,
      paymentResult.error,
      accountResult.error,
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
    setLedgerAccounts(accountResult.data || [])
    setLoading(false)
  }

  const homeownersByBlock = useMemo(() => {
    const grouped = new Map()

    properties.forEach((property) => {
      const propertyPayments = payments.filter((payment) =>
        paymentMatchesProperty(payment, property),
      )
      const activePayments = propertyPayments.filter(
        (payment) => payment.status !== 'Voided',
      )
      const latestPayment = activePayments[0]
      const account = ledgerAccounts.find(
        (item) => Number(item.propertyId) === Number(property.id),
      )
      const amountDue = account?.balance || 0
      const overdue = account
        ? account.days1To30 + account.days31To60 + account.days61To90 + account.days90Plus
        : 0

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
          ? date.format(new Date(latestPayment.paid_at))
          : 'No payment yet',
        amountDue,
        penaltyAmount: 0,
        totalDue: amountDue,
        daysOverdue: 0,
        unallocatedCredit: account?.unallocatedCredit || 0,
        avatar: '🏠',
        payments: propertyPayments,
      }

      const key = normalize(property.block)
      grouped.set(key, [...(grouped.get(key) || []), homeowner])
    })

    return grouped
  }, [ledgerAccounts, payments, properties])

  const blockSummaries = useMemo(() => {
    const knownBlocks = [...blocks]

    properties.forEach((property) => {
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

  function handleBlockExpand(blockId) {
    setExpandedBlockId((current) => (current === blockId ? null : blockId))
  }

  function handleViewLedger(homeowner) {
    setSelectedHomeowner(homeowner)
    setShowLedgerModal(true)
  }

  function handlePayDues(homeowner) {
    if (!canManagePayments) return

    setSelectedHomeowner(homeowner)
    setPaymentData({
      homeowner: homeowner.name,
      block: homeowner.block,
      lot: homeowner.lot,
      amount: homeowner.amountDue,
      period: currentManilaPeriod(),
    })
    setShowPaymentModal(true)
  }

  async function handlePaymentConfirmed(form) {
    if (!canManagePayments) {
      throw new Error('Only a Secretary or Treasurer can record payments.')
    }

    if (!currentUser?.id) {
      throw new Error('Your user profile could not be verified. Please sign in again.')
    }

    const postedPayment = await postLedgerPayment({
      propertyId: selectedHomeowner.id,
      amount: form.amount,
      paymentMethod: form.method,
      referenceNumber: form.referenceNumber,
      paymentPurpose: 'Association Dues',
      coveragePeriod: form.period,
      note: form.note,
    })

    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('property_id', Number(selectedHomeowner.id))
      .order('paid_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw error
    const savedPayment = data || postedPayment
    if (!savedPayment?.id) throw new Error('Payment posted, but the receipt could not be loaded.')

    setShowPaymentModal(false)
    setReceiptData({
      orNumber: savedPayment.receipt_number,
      date: date.format(new Date(savedPayment.paid_at)),
      homeowner: savedPayment.homeowner_name,
      lot: `${savedPayment.block_name}, ${savedPayment.lot_number}`,
      amount: Number(savedPayment.amount_paid) || 0,
      method: savedPayment.payment_method,
      period: savedPayment.coverage_period,
    })
    await loadPage()
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
          <div className="blocks-grid">
            {blockSummaries.map((block) => (
              <div key={block.id} className="block-section">
                <BlockOverviewCard
                  block={block}
                  isExpanded={expandedBlockId === block.id}
                  onExpand={() => handleBlockExpand(block.id)}
                />

                {expandedBlockId === block.id && (
                  <ExpandedBlockView
                    block={block}
                    homeowners={block.homeowners}
                    canRecordPayment={canManagePayments}
                    onViewLedger={handleViewLedger}
                    onPayDues={handlePayDues}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showLedgerModal && selectedHomeowner && (
        <HomeownerLedgerModal
          homeowner={selectedHomeowner}
          ledger={selectedHomeowner.payments.map((payment) => ({
            id: payment.id,
            date: date.format(new Date(payment.paid_at)),
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

      {showPaymentModal && paymentData && (
        <PaymentCheckoutModal
          paymentData={paymentData}
          onConfirm={handlePaymentConfirmed}
          onCancel={() => setShowPaymentModal(false)}
        />
      )}

      {receiptData && (
        <ReceiptModal
          receiptData={receiptData}
          onClose={() => setReceiptData(null)}
        />
      )}
    </div>
  )
}