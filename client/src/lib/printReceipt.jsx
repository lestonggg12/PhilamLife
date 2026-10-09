import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReceiptSheet from '../components/ReceiptSheet'
import receiptCss from '../components/ReceiptSheet.css?inline'

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

/**
 * Opens the receipt in its own window and starts the browser's print dialog
 * ("Save as PDF" is available there). The window is drawn from the same
 * ReceiptSheet component and stylesheet as the on-screen receipt.
 */
export function printReceipt(model, onPopupBlocked) {
  const printWindow = window.open('', '_blank', 'width=900,height=800')

  if (!printWindow) {
    onPopupBlocked?.('Please allow pop-ups to print this receipt.')
    return
  }

  const markup = renderToStaticMarkup(<ReceiptSheet model={model} />)

  printWindow.addEventListener(
    'load',
    () => {
      printWindow.focus()
      printWindow.print()
    },
    { once: true },
  )

  printWindow.document.write(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(model.receiptNumber)} - Official Receipt</title>
    <style>
      @page { size: A4 portrait; margin: 14mm; }
      html, body { margin: 0; padding: 0; background: #fff; }
      body { padding: 0; }
      ${receiptCss}
      .rcpt { max-width: none; }
    </style>
  </head>
  <body>${markup}</body>
</html>`)
  printWindow.document.close()
}
