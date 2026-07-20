import React, { useState } from 'react'
import { ChevronDown, Home, DollarSign, AlertCircle, CheckCircle, Clock } from '../components/Icons'
import BlockOverviewCard from '../components/BlockOverviewCard'
import ExpandedBlockView from '../components/ExpandedBlockView'
import HomeownerLedgerModal from '../components/HomeownerLedgerModal'
import PaymentCheckoutModal from '../components/PaymentCheckoutModal'
import ReceiptModal from '../components/ReceiptModal'
import './SecretaryPayables.css'

// Mock data
const MOCK_BLOCKS = [
  {
    id: 1,
    name: 'Block A',
    totalUnits: 24,
    paidAccounts: 18,
    unpaidAccounts: 6,
    collectionRate: 75,
    totalOutstanding: 45000,
  },
  {
    id: 2,
    name: 'Block B',
    totalUnits: 20,
    paidAccounts: 12,
    unpaidAccounts: 8,
    collectionRate: 60,
    totalOutstanding: 72000,
  },
  {
    id: 3,
    name: 'Block C',
    totalUnits: 18,
    paidAccounts: 16,
    unpaidAccounts: 2,
    collectionRate: 89,
    totalOutstanding: 12000,
  },
  {
    id: 4,
    name: 'Block D',
    totalUnits: 22,
    paidAccounts: 22,
    unpaidAccounts: 0,
    collectionRate: 100,
    totalOutstanding: 0,
  },
]

const MOCK_HOMEOWNERS = {
  1: [
    {
      id: 101,
      name: 'Maria Santos',
      lot: 'A-1',
      address: 'Lot 1, Block A, PHILAM Village',
      phone: '(088) 555-1001',
      email: 'maria@email.com',
      status: 'paid',
      lastPayment: '2026-04-15',
      amountDue: 0,
      daysOverdue: 0,
      avatar: '👩‍🦰',
    },
    {
      id: 102,
      name: 'Juan Dela Cruz',
      lot: 'A-2',
      address: 'Lot 2, Block A, PHILAM Village',
      phone: '(088) 555-1002',
      email: 'juan@email.com',
      status: 'overdue',
      lastPayment: '2026-02-10',
      amountDue: 7500,
      daysOverdue: 50,
      avatar: '👨‍🦱',
    },
    {
      id: 103,
      name: 'Ana Garcia',
      lot: 'A-3',
      address: 'Lot 3, Block A, PHILAM Village',
      phone: '(088) 555-1003',
      email: 'ana@email.com',
      status: 'pending',
      lastPayment: '2026-03-20',
      amountDue: 3000,
      daysOverdue: 0,
      avatar: '👩‍🦲',
    },
    {
      id: 104,
      name: 'Carlos Reyes',
      lot: 'A-4',
      address: 'Lot 4, Block A, PHILAM Village',
      phone: '(088) 555-1004',
      email: 'carlos@email.com',
      status: 'overdue',
      lastPayment: '2026-01-05',
      amountDue: 15000,
      daysOverdue: 116,
      avatar: '👨',
    },
    {
      id: 105,
      name: 'Rosa Morales',
      lot: 'A-5',
      address: 'Lot 5, Block A, PHILAM Village',
      phone: '(088) 555-1005',
      email: 'rosa@email.com',
      status: 'paid',
      lastPayment: '2026-04-10',
      amountDue: 0,
      daysOverdue: 0,
      avatar: '👵',
    },
    {
      id: 106,
      name: 'Miguel Torres',
      lot: 'A-6',
      address: 'Lot 6, Block A, PHILAM Village',
      phone: '(088) 555-1006',
      email: 'miguel@email.com',
      status: 'overdue',
      lastPayment: '2026-02-28',
      amountDue: 19500,
      daysOverdue: 63,
      avatar: '👨‍💼',
    },
  ],
  2: [
    {
      id: 201,
      name: 'Lisa Wang',
      lot: 'B-1',
      address: 'Lot 1, Block B, PHILAM Village',
      phone: '(088) 555-2001',
      email: 'lisa@email.com',
      status: 'paid',
      lastPayment: '2026-04-12',
      amountDue: 0,
      daysOverdue: 0,
      avatar: '👩‍🦳',
    },
    {
      id: 202,
      name: 'Robert Kim',
      lot: 'B-2',
      address: 'Lot 2, Block B, PHILAM Village',
      phone: '(088) 555-2002',
      email: 'robert@email.com',
      status: 'overdue',
      lastPayment: '2026-01-15',
      amountDue: 22500,
      daysOverdue: 106,
      avatar: '👨‍🎓',
    },
  ],
}

const MOCK_LEDGER = {
  101: [
    { date: '2026-04-15', type: 'Payment', description: 'March 2026 Dues', amount: -7500, balance: 0 },
    { date: '2026-03-15', type: 'Charge', description: 'March 2026 HPAssessment', amount: 7500, balance: 7500 },
    { date: '2026-02-15', type: 'Payment', description: 'February 2026 Dues', amount: -7500, balance: 0 },
  ],
  102: [
    { date: '2026-04-20', type: 'Charge', description: 'April 2026 HOA Assessment', amount: 7500, balance: 7500 },
    { date: '2026-03-20', type: 'Charge', description: 'March 2026 HOA Assessment', amount: 7500, balance: 0 },
    { date: '2026-02-10', type: 'Payment', description: 'January 2026 Dues', amount: -7500, balance: -7500 },
  ],
}

export default function SecretaryPayablesPage() {
  const [expandedBlockId, setExpandedBlockId] = useState(null)
  const [selectedHomeowner, setSelectedHomeowner] = useState(null)
  const [showLedgerModal, setShowLedgerModal] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showReceiptModal, setShowReceiptModal] = useState(false)
  const [paymentData, setPaymentData] = useState(null)
  const [receiptData, setReceiptData] = useState(null)

  const handleBlockExpand = (blockId) => {
    setExpandedBlockId(expandedBlockId === blockId ? null : blockId)
  }

  const handleViewLedger = (homeowner) => {
    setSelectedHomeowner(homeowner)
    setShowLedgerModal(true)
  }

  const handlePayDues = (homeowner) => {
    setSelectedHomeowner(homeowner)
    setPaymentData({
      homeowner: homeowner.name,
      lot: homeowner.lot,
      amount: homeowner.amountDue,
      period: 'April 2026',
    })
    setShowPaymentModal(true)
  }

  const handlePaymentConfirmed = (method) => {
    setReceiptData({
      orNumber: `OR-${Date.now()}`,
      date: new Date().toLocaleDateString(),
      homeowner: paymentData.homeowner,
      lot: paymentData.lot,
      amount: paymentData.amount,
      method: method,
      period: paymentData.period,
    })
    setShowPaymentModal(false)
    setShowReceiptModal(true)
  }

  const handleCloseLedger = () => {
    setShowLedgerModal(false)
    setSelectedHomeowner(null)
  }

  return (
    <div className="secretary-payables-page">
      <div className="payables-header">
        <div>
          <h1>📊 Payables & Collections</h1>
          <p>Manage block collections and homeowner dues</p>
        </div>
        <div className="header-stats">
          <div className="stat-badge">
            <DollarSign size={20} />
            <span>₱201,000 Outstanding</span>
          </div>
          <div className="stat-badge">
            <AlertCircle size={20} />
            <span>16 Overdue</span>
          </div>
        </div>
      </div>

      <div className="payables-content">
        <div className="blocks-grid">
          {MOCK_BLOCKS.map((block) => (
            <div key={block.id} className="block-section">
              <BlockOverviewCard
                block={block}
                isExpanded={expandedBlockId === block.id}
                onExpand={() => handleBlockExpand(block.id)}
              />

              {expandedBlockId === block.id && MOCK_HOMEOWNERS[block.id] && (
                <ExpandedBlockView
                  block={block}
                  homeowners={MOCK_HOMEOWNERS[block.id]}
                  onViewLedger={handleViewLedger}
                  onPayDues={handlePayDues}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {showLedgerModal && selectedHomeowner && (
        <HomeownerLedgerModal
          homeowner={selectedHomeowner}
          ledger={MOCK_LEDGER[selectedHomeowner.id] || []}
          onClose={handleCloseLedger}
          onPayClick={() => {
            handleCloseLedger()
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

      {showReceiptModal && receiptData && (
        <ReceiptModal
          receiptData={receiptData}
          onClose={() => setShowReceiptModal(false)}
        />
      )}
    </div>
  )
}
