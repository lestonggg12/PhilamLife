import React from 'react'
import { notifySuccess } from './actionFeedback'
import { renderToStaticMarkup } from 'react-dom/server'
import PreprintedReceipt from '../components/PreprintedReceipt'
import receiptCss from '../components/PreprintedReceipt.css?inline'
import { alignmentValue, normalizePaperNumber, preprintedLayoutError, RECEIPT_PAPER } from './preprintedReceipt'

const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

// Only filled-in values are sent to the printer. No preprinted artwork is in
// this document, even when the browser's background-printing option is enabled.
export function receiptPrintHtml(model, setup = {}) {
  normalizePaperNumber(setup.paperNumber)
  const error = preprintedLayoutError(model.preprinted)
  if (error) throw new Error(error)
  const alignment = { x: alignmentValue(setup.alignment?.x), y: alignmentValue(setup.alignment?.y) }
  const markup = renderToStaticMarkup(<PreprintedReceipt model={model} guide={false} alignment={alignment} />)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>${escapeHtml(model.receiptNumber)} - Invoice details</title><style>
    @page { size: ${RECEIPT_PAPER.width}mm ${RECEIPT_PAPER.height}mm; margin: 0; }
    html, body { margin: 0; padding: 0; width: ${RECEIPT_PAPER.width}mm; height: ${RECEIPT_PAPER.height}mm; background: transparent; }
    ${receiptCss}
  </style></head><body>${markup}</body></html>`
}

export function printReceipt(model, onPrintError, setup = {}) {
  let html
  try { html = receiptPrintHtml(model, setup) }
  catch (error) { onPrintError?.(error.message); return }
  const printWindow = window.open('', '_blank', 'width=650,height=850')
  if (!printWindow) { onPrintError?.('Please allow pop-ups to print this receipt.'); return }
  printWindow.addEventListener('load', () => {
    printWindow.focus()
    notifySuccess(`Print window opened for receipt ${model.receiptNumber}.`)
    printWindow.print()
  }, { once: true })
  printWindow.document.write(html)
  printWindow.document.close()
}
