import React from 'react'
import './PaymentsPage.css'

export default function PaymentsPage() {
  const payments = [
    { id: 1, homeowner: 'John Doe', property: 'Block A, Lot 1', amount: '₱5,000', date: '2024-04-28', method: 'Cash' },
    { id: 2, homeowner: 'Maria Santos', property: 'Block A, Lot 2', amount: '₱3,500', date: '2024-04-27', method: 'Bank Transfer' },
    { id: 3, homeowner: 'Carlos Reyes', property: 'Block B, Lot 5', amount: '₱2,000', date: '2024-04-26', method: 'Check' },
  ]

  return (
    <div className="page">
      <div className="page-header glass-card">
        <div>
          <h2>Payments</h2>
          <p>Record and track all payments</p>
        </div>
        <button className="btn btn-primary">+ Record Payment</button>
      </div>

      <div className="payments-content glass-card">
        <table>
          <thead>
            <tr>
              <th>Homeowner</th>
              <th>Property</th>
              <th>Amount</th>
              <th>Date</th>
              <th>Method</th>
              <th>Receipt</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((payment) => (
              <tr key={payment.id}>
                <td><strong>{payment.homeowner}</strong></td>
                <td>{payment.property}</td>
                <td className="amount">{payment.amount}</td>
                <td>{payment.date}</td>
                <td>{payment.method}</td>
                <td>
                  <button className="btn btn-secondary">View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
