import React, { useEffect } from 'react'
import './ReceiptSheet.css'

/**
 * The formal Official Receipt document. Used on screen (inside ReceiptDialog)
 * and, rendered to static markup, in the print window (lib/printReceipt.jsx),
 * so what is seen on screen is exactly what is printed.
 */
export default function ReceiptSheet({ model }) {
  const { organization, voided } = model

  return (
    <article className={`rcpt${voided ? ' is-voided' : ''}`}>
      {voided && <div className="rcpt-watermark" aria-hidden="true">VOID</div>}

      <header className="rcpt-head">
        <div className="rcpt-org">
          <h2 className="rcpt-org-name">{organization.name}</h2>
          {organization.address && <p>{organization.address}</p>}
          {organization.contact && <p>{organization.contact}</p>}
        </div>
        <div className="rcpt-doc">
          <p className="rcpt-doc-title">{model.title}</p>
          <p className="rcpt-doc-sub">{model.subtitle}</p>
        </div>
      </header>

      <div className="rcpt-meta">
        <div>
          <span>Receipt No.</span>
          <strong className="rcpt-number">{model.receiptNumber}</strong>
        </div>
        <div>
          <span>Date issued</span>
          <strong>{model.issuedAt}</strong>
        </div>
        <div>
          <span>Status</span>
          <strong className={`rcpt-status${voided ? ' is-void' : ''}`}>{model.statusLabel}</strong>
        </div>
      </div>

      {voided && (
        <div className="rcpt-void-banner">
          <strong>This receipt has been voided and is not valid as proof of payment.</strong>
          {model.voidReason && <span>Reason: {model.voidReason}</span>}
        </div>
      )}

      <dl className="rcpt-details">
        {model.details.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>

      <table className="rcpt-table">
        <thead>
          <tr>
            <th>Particulars</th>
            <th className="rcpt-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {model.lines.map((line, index) => (
            <tr key={index}>
              <td>
                <strong>{line.description}</strong>
                {line.meta && <small>{line.meta}</small>}
              </td>
              <td className="rcpt-right">{line.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="rcpt-summary">
        {model.summary.map((item) => (
          <div key={item.label} className={item.strong ? 'is-strong' : undefined}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>

      <div className="rcpt-words">
        <span>Amount in words</span>
        <strong>{model.amountInWords}</strong>
      </div>

      {model.notes.map((note) => (
        <p key={note.label} className="rcpt-note">
          <strong>{note.label}:</strong> {note.text}
        </p>
      ))}

      <footer className="rcpt-foot">
        <div className="rcpt-sign">
          <span className="rcpt-sign-line" />
          <strong>{model.issuedBy}</strong>
          <small>Received by</small>
        </div>
        <p>
          This computer-generated receipt reflects a permanent transaction record
          saved in the {organization.name} system.
        </p>
      </footer>
    </article>
  )
}

/**
 * Modal wrapper shared by every page that shows a receipt.
 *   <ReceiptDialog model={...} onClose={...} onPrint={...}>extra action buttons</ReceiptDialog>
 * Extra buttons should use the classes rcpt-btn + rcpt-btn-secondary / rcpt-btn-danger.
 */
export function ReceiptDialog({ model, onClose, onPrint, dismissOnBackdrop = true, children }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="rcpt-backdrop"
      role="presentation"
      onMouseDown={dismissOnBackdrop ? onClose : undefined}
    >
      <div
        className="rcpt-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Official receipt ${model.receiptNumber}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="rcpt-dialog-scroll">
          <ReceiptSheet model={model} />
        </div>
        <div className="rcpt-actions">
          <button type="button" className="rcpt-btn rcpt-btn-secondary" onClick={onClose}>Close</button>
          {children}
          <button type="button" className="rcpt-btn rcpt-btn-primary" onClick={onPrint}>Print / Save as PDF</button>
        </div>
      </div>
    </div>
  )
}
