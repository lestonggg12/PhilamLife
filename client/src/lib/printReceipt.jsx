import React from 'react'
import { supabase } from './supabaseClient'
import { loadReceiptAlignment, receiptAlignmentOffsets } from './receiptAlignment'
import { notifySuccess } from './actionFeedback'
import { renderToStaticMarkup } from 'react-dom/server'
import PreprintedReceipt from '../components/PreprintedReceipt'
import receiptCss from '../components/PreprintedReceipt.css?inline'
import { preprintedLayoutError, RECEIPT_PAPER } from './preprintedReceipt'

const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

// Only filled-in values are sent to the printer. No preprinted artwork is in
// this document, even when the browser's background-printing option is enabled.
export function receiptPrintHtml(model, setup = {}) {
  const error = preprintedLayoutError(model.preprinted)
  if (error) throw new Error(error)
  const alignment = receiptAlignmentOffsets(setup.alignment)
  const markup = renderToStaticMarkup(<PreprintedReceipt model={model} guide={false} alignment={alignment} />)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>${escapeHtml(model.receiptNumber)} - Invoice details</title><style>
    @page { size: ${RECEIPT_PAPER.width}mm ${RECEIPT_PAPER.height}mm; margin: 0; }
    html, body { margin: 0; padding: 0; width: ${RECEIPT_PAPER.width}mm; height: ${RECEIPT_PAPER.height}mm; background: transparent; }
    ${receiptCss}
  </style></head><body>${markup}</body></html>`
}

export async function printReceipt(model, onPrintError, setup = {}) {
  const error = preprintedLayoutError(model.preprinted)
  if (error) { onPrintError?.(error); return }
  // Open synchronously in the click handler so the fetch does not trigger a popup blocker.
  const printWindow = window.open('', '_blank', 'width=650,height=850')
  if (!printWindow) { onPrintError?.('Please allow pop-ups to print this receipt.'); return }
  try {
    printWindow.document.write('<!doctype html><title>Loading receipt</title><p>Checking shared printer alignment…</p>')
    const shared = await loadReceiptAlignment(supabase)
    if (setup.revision != null && setup.revision !== shared.revision) {
      throw new Error('Shared printer alignment changed. Reload the saved alignment in the receipt window before printing.')
    }
    if (printWindow.closed) return
    const html = receiptPrintHtml(model, { alignment: shared })
    printWindow.document.open()
    printWindow.addEventListener('load', () => {
      printWindow.focus()
      notifySuccess(`Print window opened for receipt ${model.receiptNumber}.`)
      printWindow.print()
    }, { once: true })
    printWindow.document.write(html)
    printWindow.document.close()
  } catch (failure) {
    printWindow.close()
    onPrintError?.(`Could not print receipt: ${failure.message}`)
  }
}
