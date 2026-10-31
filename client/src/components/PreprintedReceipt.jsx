import React from 'react'
import { wrapReceiptText } from '../lib/preprintedReceipt'
import './PreprintedReceipt.css'

export default function PreprintedReceipt({ model, paperNumber = '', alignment = { x: 0, y: 0 }, guide = true }) {
  const f = model.preprinted || {}
  return <article className="paper-receipt" aria-label="Preprinted service invoice preview">
    {guide && <div className="paper-guide" aria-hidden="true">
      <header><strong>{model.organization.name}</strong><small>{model.organization.address}</small><small>NON VAT Reg. TIN: (preprinted on paper)</small></header>
      <div className="paper-guide-title">SERVICE<br /><b>INVOICE</b><br />EXEMPT<em>No. {paperNumber || '____'}</em></div>
      <span className="guide-date">DATE</span>
      <div className="guide-customer"><div>SOLD TO:</div><p>Registered Name:</p><p>TIN:</p><p>Business Address:</p><p>Business Style:</p></div>
      <div className="guide-items"><div className="guide-item-heading"><span>Item Description / Nature of Service</span><span>Quantity</span><span>Unit Cost / Price</span><span>Amount</span></div>{Array.from({ length: 6 }, (_, i) => <div className="guide-item-row" key={i}><span /><span /><span /><span /></div>)}</div>
      <div className="guide-id">SC/PWD/NAAC/MOV/<br />Solo Parent ID No.<hr />Signature:</div>
      <div className="guide-totals">{['Total Sales', 'Less: Discount', 'Less: Withholding Tax', 'TOTAL AMOUNT DUE'].map((label) => <div key={label}><span>{label}</span><span /></div>)}</div>
      <span className="guide-issued">Issued by:</span><span className="guide-customer-sign">By:</span>
      <div className="guide-sign-left">Authorized Signature</div><div className="guide-sign-right">Customer Name &amp; Signature</div>
      <footer>Preprinted form guide only<br />Printer and BIR details are already on the paper.</footer>
    </div>}
    <div className="paper-values" style={{ '--paper-offset-x': `${alignment.x}mm`, '--paper-offset-y': `${alignment.y}mm` }}>
      <div className="paper-reference">{model.receiptNumber}</div>
      <div className="paper-method">{wrapReceiptText(f.method, 59).map((line, i) => <div key={i}>{line}</div>)}</div>
      <div className="paper-date">{f.date}</div>
      <div className="paper-name">{wrapReceiptText(f.name, 57).map((line, i) => <div key={i}>{line}</div>)}</div>
      <div className="paper-lot">{f.lot}</div>
      <div className="paper-description">{wrapReceiptText(f.description).map((line, i) => <div key={i}>{line}</div>)}</div>
      <div className="paper-quantity">{f.quantity}</div><div className="paper-unit">{f.unitPrice}</div><div className={`paper-line-amount${String(f.lineAmount || "").length > 14 ? " paper-long-amount" : ""}`}>{f.lineAmount}</div>
      <div className="paper-total-sales">{f.totalSales}</div><div className="paper-discount">{f.discount}</div><div className="paper-total-paid">{f.totalPaid}</div>
      <div className="paper-issued-by">{wrapReceiptText(f.issuedBy, 26).map((line, i) => <div key={i}>{line}</div>)}</div>
      {model.voided && <div className="paper-cancelled">CANCELLED — NOT VALID</div>}
    </div>
  </article>
}
