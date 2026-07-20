import React, { useState } from 'react'
import { X, CreditCard, Bank, Check } from './Icons'
import './PaymentCheckoutModal.css'

export default function PaymentCheckoutModal({
  paymentData,
  onConfirm,
  onCancel,
}) {
  const [selectedMethod, setSelectedMethod] = useState('card')
  const [isProcessing, setIsProcessing] = useState(false)

  const paymentMethods = [
    { id: 'card', name: 'Credit/Debit Card', icon: CreditCard },
    { id: 'bank', name: 'Bank Transfer', icon: Bank },
    { id: 'cash', name: 'Cash Payment', icon: null },
  ]

  const handleConfirm = async () => {
    setIsProcessing(true)
    // Simulate payment processing
    setTimeout(() => {
      onConfirm(selectedMethod)
      setIsProcessing(false)
    }, 1500)
  }

  return (
    <div className="payment-modal-overlay" onClick={onCancel}>
      <div className="payment-modal" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" onClick={onCancel}>
          <X size={24} />
        </button>

        <div className="payment-header">
          <h2>💳 Checkout</h2>
          <p>Confirm payment details</p>
        </div>

        {/* Summary */}
        <div className="payment-summary">
          <div className="summary-row">
            <span className="label">Homeowner</span>
            <span className="value">{paymentData.homeowner}</span>
          </div>
          <div className="summary-row">
            <span className="label">Lot Number</span>
            <span className="value">{paymentData.lot}</span>
          </div>
          <div className="summary-row">
            <span className="label">Period</span>
            <span className="value">{paymentData.period}</span>
          </div>
          <div className="summary-row total">
            <span className="label">Amount Due</span>
            <span className="amount">₱{paymentData.amount.toLocaleString()}</span>
          </div>
        </div>

        {/* Payment Method Selection */}
        <div className="payment-methods">
          <h3>Select Payment Method</h3>
          <div className="methods-grid">
            {paymentMethods.map((method) => {
              const IconComponent = method.icon
              return (
                <label key={method.id} className="method-option">
                  <input
                    type="radio"
                    name="payment-method"
                    value={method.id}
                    checked={selectedMethod === method.id}
                    onChange={(e) => setSelectedMethod(e.target.value)}
                  />
                  <span className="method-card">
                    {IconComponent && <IconComponent size={24} />}
                    {!IconComponent && '💵'}
                    <span className="method-name">{method.name}</span>
                  </span>
                </label>
              )
            })}
          </div>
        </div>

        {/* Method Details */}
        {selectedMethod === 'card' && (
          <div className="method-details">
            <p className="info-text">
              You will be redirected to a secure payment gateway to complete your card transaction.
            </p>
          </div>
        )}

        {selectedMethod === 'bank' && (
          <div className="method-details">
            <p className="info-text">
              Bank details will be provided after confirmation. Payment reference will be automatically generated.
            </p>
          </div>
        )}

        {selectedMethod === 'cash' && (
          <div className="method-details">
            <p className="info-text">
              Please bring cash to the HOA office. A receipt will be issued upon payment.
            </p>
          </div>
        )}

        {/* Footer Actions */}
        <div className="payment-footer">
          <button
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={isProcessing}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleConfirm}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <>
                <span className="spinner"></span>
                Processing...
              </>
            ) : (
              <>
                <Check size={16} /> Confirm Payment
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
