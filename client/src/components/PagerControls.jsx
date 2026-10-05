import React from 'react'
import { pageCount, PAGE_ROWS } from '../lib/pagedQuery'
import { shiftMonthKey, monthLabel, currentManilaMonthKey } from '../lib/pagedQuery'
import './PagerControls.css'

/**
 * "Showing 51-100 of 1,234" with Previous / Next.
 * `page` is 0-based. `total` is null while the exact total is unknown (an
 * uncounted search with more pages to come): then Next is always available and the
 * text omits the total. Renders nothing when everything fits on one page.
 */
export function Pager({ page, total, onPageChange, disabled = false, size = PAGE_ROWS }) {
  const unknownTotal = total === null || total === undefined
  if (!unknownTotal && (!total || total <= size)) return null

  const first = page * size + 1
  const last = unknownTotal ? (page + 1) * size : Math.min(total, (page + 1) * size)
  const pages = unknownTotal ? null : pageCount(total, size)
  const canGoNext = unknownTotal ? true : page + 1 < pages

  return (
    <nav className="pager" aria-label="Pagination">
      <button
        type="button"
        className="pager-button"
        onClick={() => onPageChange(page - 1)}
        disabled={disabled || page <= 0}
      >
        Previous
      </button>
      <span className="pager-indicator">
        {unknownTotal
          ? `Showing ${first.toLocaleString('en-PH')}–${last.toLocaleString('en-PH')} · Page ${page + 1}`
          : `Showing ${first.toLocaleString('en-PH')}–${last.toLocaleString('en-PH')} of ${total.toLocaleString('en-PH')} · Page ${page + 1} of ${pages.toLocaleString('en-PH')}`}
      </span>
      <button
        type="button"
        className="pager-button"
        onClick={() => onPageChange(page + 1)}
        disabled={disabled || !canGoNext}
      >
        Next
      </button>
    </nav>
  )
}

/** ‹ October 2026 ›  plus a "This month" shortcut. `monthKey` is 'YYYY-MM'. */
export function MonthSwitcher({ monthKey, onChange, disabled = false }) {
  const thisMonth = currentManilaMonthKey()
  const atCurrent = monthKey === thisMonth

  return (
    <div className="month-switcher" role="group" aria-label="Month">
      <button
        type="button"
        className="month-switcher-arrow"
        onClick={() => onChange(shiftMonthKey(monthKey, -1))}
        disabled={disabled}
        aria-label="Previous month"
      >
        ‹
      </button>
      <span className="month-switcher-label">{monthLabel(monthKey)}</span>
      <button
        type="button"
        className="month-switcher-arrow"
        onClick={() => onChange(shiftMonthKey(monthKey, 1))}
        disabled={disabled || atCurrent}
        aria-label="Next month"
      >
        ›
      </button>
      {!atCurrent && (
        <button
          type="button"
          className="month-switcher-today"
          onClick={() => onChange(thisMonth)}
          disabled={disabled}
        >
          This month
        </button>
      )}
    </div>
  )
}
