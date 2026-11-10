/** A standalone, print-safe payment activity detail. No balance or dues inference. */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const money = (v) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(v) || 0);
const manilaDate = (v) => {
  if (!v) return '—';
  const date = new Date(v);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric',
  }).format(date);
};
const currentDate = () => new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila', year: 'numeric', month: 'long', day: 'numeric',
}).format(new Date());

/** @returns {string} Fully escaped HTML document for the selected homeowner/month. */
export function buildPaymentMonthPrintHtml({ hoaName, preparedBy = '', preparedRole = '', homeownerName, block, lot, month, year, records = [], dues = 0, services = 0, other = 0, total = 0 }) {
  const period = `${month} ${year}`;
  const rows = records.length ? records.map((record, i) => `<tr>
    <td class="nowrap">${esc(manilaDate(record.paidAt))}</td>
    <td class="reference">${esc(record.receipt || '—')}</td>
    <td><strong>${esc(record.category || 'Payment')}</strong><span class="desc">${esc(record.description || '—')}</span></td>
    <td>${esc(record.method || '—')}</td>
    <td>${esc(record.status || '—')}</td>
    <td class="money">${esc(money(record.amount))}</td>
  </tr>`).join('\n') : `<tr><td colspan="6" class="empty">No payment transactions were recorded for this lot during ${esc(period)}.</td></tr>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(period)} — Homeowner Payment Activity</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #edf0f3; color: #252c35; font-family: Arial, Helvetica, sans-serif; font-size: 11px; line-height: 1.45; }
  .toolbar { max-width: 216mm; margin: 18px auto 0; display: flex; justify-content: space-between; align-items: center; gap: 16px; color: #516071; font-size: 12px; }
  .toolbar button { appearance: none; border: 1px solid #26364c; border-radius: 5px; background: #26364c; color: #fff; padding: 10px 16px; font-size: 12px; font-weight: 700; cursor: pointer; }
  .paper { width: 216mm; min-height: 279mm; margin: 12px auto 36px; padding: 19mm 17mm 17mm; background: #fff; box-shadow: 0 8px 24px rgba(22,37,53,.12); }
  .topline { width: 34px; height: 3px; margin-bottom: 17px; background: #26364c; }
  .org { margin: 0; font-size: 18px; line-height: 1.22; font-weight: 700; color: #26364c; }
  .org-sub { margin: 4px 0 27px; font-size: 10px; letter-spacing: 1.4px; color: #607081; text-transform: uppercase; }
  .doc-type { margin: 0; font-size: 10px; letter-spacing: 1.25px; text-transform: uppercase; font-weight: 700; color: #58677a; }
  h1 { margin: 6px 0 7px; color: #26364c; font-size: 23px; line-height: 1.15; letter-spacing: -.4px; }
  .subtitle { margin: 0; color: #687687; font-size: 11px; }
  .identity { display: grid; grid-template-columns: 1.3fr 1fr 1fr; gap: 14px; margin: 26px 0 20px; padding: 16px 0; border-top: 1px solid #cbd3db; border-bottom: 1px solid #cbd3db; }
  .label { display: block; margin-bottom: 5px; font-size: 9px; font-weight: 700; color: #647184; letter-spacing: .8px; text-transform: uppercase; }
  .value { display: block; font-size: 12px; font-weight: 700; overflow-wrap: anywhere; }
  .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; border: 1px solid #d4dbe2; margin-bottom: 27px; }
  .summary > div { padding: 12px; min-width: 0; }
  .summary > div + div { border-left: 1px solid #d4dbe2; }
  .summary .value { font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .summary > div:last-child { background: #f3f5f7; }
  .summary > div:last-child .value { color: #26364c; }
  h2 { margin: 0 0 10px; font-size: 13px; color: #26364c; }
  .table-meta { display: flex; justify-content: space-between; gap: 12px; margin: 0 0 12px; color: #58677a; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  col:nth-child(1) { width: 14%; } col:nth-child(2) { width: 15%; } col:nth-child(3) { width: 29%; } col:nth-child(4) { width: 14%; } col:nth-child(5) { width: 11%; } col:nth-child(6) { width: 17%; }
  th { text-align: left; padding: 9px 7px; border-top: 2px solid #26364c; border-bottom: 1px solid #cbd3db; font-size: 9px; text-transform: uppercase; letter-spacing: .4px; color: #26364c; }
  td { padding: 10px 7px; vertical-align: top; border-bottom: 1px solid #e1e5e9; overflow-wrap: anywhere; }
  td strong { display: block; font-size: 10px; font-weight: 700; }
  .desc { display: block; color: #5e6b78; font-size: 10px; margin-top: 3px; }
  .money { white-space: nowrap; font-variant-numeric: tabular-nums; text-align: right; }
  th:last-child { text-align: right; }
  .empty { text-align: center; padding: 25px 10px; color: #626e7b; }
  .totalrow { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; border-top: 2px solid #26364c; margin-top: 13px; padding-top: 13px; font-size: 12px; }
  .totalrow strong { font-size: 17px; color: #26364c; font-variant-numeric: tabular-nums; }
  .footnote { margin-top: 33px; padding-top: 13px; border-top: 1px solid #cbd3db; color: #5f6a77; font-size: 10px; line-height: 1.6; }
  .footnote p { margin: 0 0 6px; }
  .prepared-signature { width: 275px; max-width: 100%; margin: 36px 0 0 auto; color: #26364c; break-inside: avoid; page-break-inside: avoid; }
  .signature-label { font-weight: 700; font-size: 11px; }
  .signature-space { height: 49px; border-bottom: 1px solid #26364c; }
  .signature-name { margin-top: 7px; font-weight: 700; font-size: 12px; overflow-wrap: anywhere; }
  .signature-role { margin-top: 2px; color: #58677a; font-size: 10px; text-transform: capitalize; }
  .signature-caption { margin-top: 5px; font-size: 9px; color: #58677a; }
  @media print {
    @page { size: letter portrait; margin: 14mm 15mm; }
    body { background: #fff; font-size: 10px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .toolbar { display: none !important; }
    .paper { margin: 0; padding: 0; width: auto; min-height: 0; box-shadow: none; }
    .identity, .summary, .totalrow, h2 { break-inside: avoid; }
    tr { break-inside: avoid; }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
  }
  @media (max-width: 800px) {
    .toolbar { padding: 0 16px; }
    .paper { width: 100%; min-height: 0; margin: 12px auto; padding: 22px 18px; box-shadow: none; }
    .identity { grid-template-columns: repeat(2,minmax(0,1fr)); }
    .summary { grid-template-columns: repeat(2,minmax(0,1fr)); }
    .summary > div:nth-child(3) { border-left: 0; border-top: 1px solid #d4dbe2; }
    .summary > div:nth-child(4) { border-top: 1px solid #d4dbe2; }
    table { min-width: 650px; }
    .table-wrap { overflow-x: auto; }
  }
</style></head><body>
<div class="toolbar"><span>Homeowner payment activity · Print preview</span><button type="button" onclick="window.print()">Print / Save as PDF</button></div>
<article class="paper">
  <div class="topline"></div>
  <p class="org">${esc(hoaName || 'Homeowners Association')}</p>
  <p class="org-sub">Homeowners Association · Payment records</p>
  <p class="doc-type">Property payment record</p>
  <h1>Monthly Payment Activity</h1>
  <p class="subtitle">${esc(period)} · Prepared ${esc(currentDate())}</p>
  <section class="identity" aria-label="Property details">
    <div><span class="label">Homeowner</span><span class="value">${esc(homeownerName || 'Not recorded')}</span></div>
    <div><span class="label">Block / Lot</span><span class="value">${esc(block ?? '—')} / ${esc(lot ?? '—')}</span></div>
    <div><span class="label">Reporting month</span><span class="value">${esc(period)}</span></div>
  </section>
  <section class="summary" aria-label="Payment category totals">
    <div><span class="label">Association dues paid</span><span class="value">${esc(money(dues))}</span></div>
    <div><span class="label">Services paid</span><span class="value">${esc(money(services))}</span></div>
    <div><span class="label">Other payments</span><span class="value">${esc(money(other))}</span></div>
    <div><span class="label">Total received</span><span class="value">${esc(money(total))}</span></div>
  </section>
  <section aria-label="Payment transaction details">
    <h2>Recorded transactions</h2>
    <div class="table-meta"><span>Payment dates in Asia/Manila time</span><span>${records.length} ${records.length === 1 ? 'transaction' : 'transactions'}</span></div>
    <div class="table-wrap"><table><colgroup><col><col><col><col><col><col></colgroup>
      <thead><tr><th>Date paid</th><th>Receipt</th><th>Category / Coverage</th><th>Method</th><th>Status</th><th>Amount paid</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="totalrow"><span>Total recorded payments for ${esc(period)}</span><strong>${esc(money(total))}</strong></div>
  </section>
  <footer class="footnote">
    <p><strong>Basis:</strong> This report lists non-voided payments by payment date in Manila time, not by the month covered by association dues. Values are sourced from the selected lot's recorded transactions.</p>
    <p><strong>Important:</strong> This is a payment-activity summary, not an official receipt, billing statement, balance confirmation, or certification that association dues are fully paid. Unpaid dues and outstanding balances are not calculated here.</p>
  </footer>
  <section class="prepared-signature" aria-label="Report preparation and signature">
    <div class="signature-label">Prepared by</div>
    <div class="signature-space" aria-label="Blank space for handwritten signature"></div>
    <div class="signature-name">${esc(preparedBy || 'Not recorded')}</div>
    ${preparedRole ? '<div class="signature-role">' + esc(preparedRole) + '</div>' : ''}
    <div class="signature-caption">Signature above printed name</div>
  </section>
</article></body></html>`;
}

/** Open a reviewable print page. Browser Print can also save it as PDF. */
export function openPaymentMonthPrint(data) {
  // Triggered directly from the Print button so browsers allow the new tab.
  const preview = window.open('', '_blank');
  if (!preview) {
    window.alert('Your browser blocked the print preview. Allow pop-ups for this application, then try again.');
    return;
  }
  preview.document.open();
  preview.document.write(buildPaymentMonthPrintHtml(data));
  preview.document.close();
  preview.focus();
}
