import React from 'react'
import './ReportsPage.css'
import { BarChart3, AlertCircle, DollarSign, TrendingUp } from '../components/Icons'

export default function ReportsPage() {
  return (
    <div className="page">
      <div className="page-header glass-card">
        <div>
          <h2>Reports</h2>
          <p>Generate financial and operational reports</p>
        </div>
        <button className="btn btn-primary">+ Generate Report</button>
      </div>

      <div className="reports-grid">
        <div className="report-card glass-card">
          <h3><BarChart3 size={20} /> Monthly Collections</h3>
          <p>View collections by month</p>
          <button className="btn btn-secondary">Generate</button>
        </div>

        <div className="report-card glass-card">
          <h3><AlertCircle size={20} /> Unpaid Accounts</h3>
          <p>List of unpaid homeowners</p>
          <button className="btn btn-secondary">Generate</button>
        </div>

        <div className="report-card glass-card">
          <h3><DollarSign size={20} /> Annual Summary</h3>
          <p>Yearly financial summary</p>
          <button className="btn btn-secondary">Generate</button>
        </div>

        <div className="report-card glass-card">
          <h3><TrendingUp size={20} /> Expenses</h3>
          <p>Track all disbursements</p>
          <button className="btn btn-secondary">Generate</button>
        </div>
      </div>
    </div>
  )
}
