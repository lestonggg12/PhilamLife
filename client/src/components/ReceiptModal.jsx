import React from 'react'
import { X, Download, Mail, Printer } from './Icons'
import './ReceiptModal.css'

export default function ReceiptModal({ receiptData, onClose }) {
  const handlePrint = () => {
    window.print()
  }

  const handleEmail = () => {
    // Mock email functionality
    alert(
      `Receipt ${receiptData.orNumber} would be sent to ${receiptData.homeowner}`
    )
  }

  return (
    <div className="receipt-modal-overlay" onClick={onClose}>
      <div className="receipt-modal" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}>
          <X size={24} />
        </button>

        <div className="receipt-container no-print">
          <div className="receipt-document">
            {/* Receipt Header */}
            <div className="receipt-header print-section">
              <div className="receipt-logo">
                <h1>🏠 PHILAM VILLAGE HOA</h1>
                <p>Cagayan de Oro City</p>
              </div>

              <div className="receipt-title">
                <h2>OFFICIAL RECEIPT</h2>
              </div>

              <div className="receipt-or-number">
                <span className="label">Receipt No.:</span>
                <span className="number">{receiptData.orNumber}</span>
              </div>
            </div>

            {/* Payment Details */}
            <div className="receipt-details print-section">
              <div className="detail-section">
                <h3>PAYMENT RECEIVED FROM:</h3>
                <div className="detail-row">
                  <span className="label">Name:</span>
                  <span className="value">{receiptData.homeowner}</span>
                </div>
                <div className="detail-row">
                  <span className="label">Property:</span>
                  <span className="value">{receiptData.lot}</span>
                </div>
              </div>

              <div className="detail-section">
                <h3>PAYMENT INFORMATION:</h3>
                <div className="detail-row">
                  <span className="label">Payment Date:</span>
                  <span className="value">{receiptData.date}</span>
                </div>
                <div className="detail-row">
                  <span className="label">Period Covered:</span>
                  <span className="value">{receiptData.period}</span>
                </div>
                <div className="detail-row">
                  <span className="label">Payment Method:</span>
                  <span className="value capitalize">{receiptData.method}</span>
                </div>
              </div>
            </div>

            {/* Amount Section */}
            <div className="receipt-amount print-section">
              <table className="amount-table">
                <tbody>
                  <tr>
                    <td className="description">HOA Monthly Assessment</td>
                    <td className="amount">₱{receiptData.amount.toLocaleString()}</td>
                  </tr>
                  <tr className="total-row">
                    <td className="description">TOTAL AMOUNT PAID</td>
                    <td className="amount">₱{receiptData.amount.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="receipt-footer print-section">
              <div className="signature-section">
                <p className="signature-line">__________________</p>
                <p className="signature-label">Authorized Officer</p>
              </div>

              <div className="receipt-notes">
                <p>
                  ✓ Thank you for your payment. Your account has been updated.
                </p>
                <p>
                  For inquiries, contact the HOA office at (088) 858-1234
                </p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="receipt-actions">
            <button className="action-btn download-btn" onClick={handlePrint}>
              <Printer size={18} />
              Print Receipt
            </button>
            <button className="action-btn email-btn" onClick={handleEmail}>
              <Mail size={18} />
              Send via Email
            </button>
            <button className="action-btn close-btn-action" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
