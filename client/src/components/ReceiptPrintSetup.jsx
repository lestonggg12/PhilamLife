import React, { useEffect, useState } from 'react'
import { alignmentValue, readPrintAlignment } from '../lib/preprintedReceipt'

export default function ReceiptPrintSetup({ model, onReady }) {
  const [alignment, setAlignment] = useState(readPrintAlignment)

  useEffect(() => {
    onReady({ key: `${model.kind}:${model.sourceId}`, alignment, ready: true })
  }, [model.kind, model.sourceId, alignment, onReady])

  function changeAlignment(axis, value) {
    const next = { ...alignment, [axis]: alignmentValue(value) }
    setAlignment(next)
    try { localStorage.setItem('philamlife-receipt-alignment-v1', JSON.stringify(next)) } catch { /* Printing can continue without local preferences. */ }
  }
  return <section className="receipt-print-setup" aria-label="Preprinted paper setup">
    <details className="receipt-alignment"><summary>Printer alignment</summary>
      <p>Use half-letter paper (139.7 × 215.9 mm), Actual size / 100%, and turn off browser headers and footers. Test on plain paper first.</p>
      <div className="receipt-alignment-row">
        <label>Move right (+) / left (−), mm<input type="number" step="0.5" min="-5" max="5" value={alignment.x} onChange={(event) => changeAlignment('x', event.target.value)} /></label>
        <label>Move down (+) / up (−), mm<input type="number" step="0.5" min="-5" max="5" value={alignment.y} onChange={(event) => changeAlignment('y', event.target.value)} /></label>
        <button type="button" className="rcpt-btn rcpt-btn-secondary" onClick={() => { setAlignment({ x: 0, y: 0 }); try { localStorage.removeItem('philamlife-receipt-alignment-v1') } catch {} }}>Reset</button>
      </div>
    </details>
  </section>
}
