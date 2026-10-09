import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import './DateField.css'

const svgProps = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
const Calendar = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
    <rect x="3" y="4" width="18" height="17" rx="2" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
)
const ChevronRight = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}><polyline points="9 18 15 12 9 6" /></svg>
)
const X = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTH_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const DISPLAY_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

// Date maths uses YYYY-MM-DD strings in UTC so the picker never shifts a day
// because of the viewer's time zone.
const pad = (n) => String(n).padStart(2, '0')
const toKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`
const parseKey = (key) => {
  const [y, m, d] = String(key).split('-').map(Number)
  return { y, m: m - 1, d }
}
const todayKey = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

function buildMonth(year, month) {
  const startOffset = new Date(Date.UTC(year, month, 1)).getUTCDay()
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(Date.UTC(year, month, 1 - startOffset + i))
    return {
      key: toKey(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month,
    }
  })
}

/**
 * Styled date picker (styles live in TreasurerServiceRevenue.css, .tsr-date-*).
 * value / min / max are YYYY-MM-DD strings; '' means no date.
 */
export default function DateField({ value, onChange, min, max, placeholder = 'Any date', ariaLabel }) {
  const today = todayKey()
  const [open, setOpen] = useState(false)
  const [alignRight, setAlignRight] = useState(false)
  const [view, setView] = useState(() => {
    const base = parseKey(value || today)
    return { y: base.y, m: base.m }
  })
  const rootRef = useRef(null)
  const popRef = useRef(null)
  const popId = useId()
  const days = useMemo(() => buildMonth(view.y, view.m), [view])

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
    }
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Open toward the left when the calendar would run off the right edge.
  useEffect(() => {
    if (!open || !rootRef.current || !popRef.current) return
    const trigger = rootRef.current.getBoundingClientRect()
    setAlignRight(trigger.left + popRef.current.offsetWidth > window.innerWidth - 12)
  }, [open])

  function openPicker() {
    const base = parseKey(value || today)
    setView({ y: base.y, m: base.m })
    setOpen(true)
  }

  function shiftMonth(delta) {
    setView(({ y, m }) => {
      const date = new Date(Date.UTC(y, m + delta, 1))
      return { y: date.getUTCFullYear(), m: date.getUTCMonth() }
    })
  }

  const isDisabled = (key) => Boolean((min && key < min) || (max && key > max))

  function pick(key) {
    if (isDisabled(key)) return
    onChange(key)
    setOpen(false)
  }

  return (
    <div className="tsr-date" ref={rootRef}>
      <button
        type="button"
        className={`tsr-date-trigger${open ? ' is-open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popId}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openPicker())}
      >
        <span className={`tsr-date-text${value ? '' : ' is-placeholder'}`}>
          {value ? DISPLAY_FORMAT.format(new Date(`${value}T00:00:00Z`)) : placeholder}
        </span>
        <Calendar size={16} />
      </button>

      {open && (
        <div className={`tsr-date-popover${alignRight ? ' align-right' : ''}`} id={popId} role="dialog" aria-label="Choose date" ref={popRef}>
          <div className="tsr-date-head">
            <button type="button" className="tsr-date-nav tsr-date-prev" onClick={() => shiftMonth(-1)} aria-label="Previous month">
              <ChevronRight size={16} />
            </button>
            <strong>{MONTH_FORMAT.format(new Date(Date.UTC(view.y, view.m, 1)))}</strong>
            <button type="button" className="tsr-date-nav" onClick={() => shiftMonth(1)} aria-label="Next month">
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="tsr-date-weekdays" aria-hidden="true">
            {WEEKDAYS.map((w) => <span key={w}>{w}</span>)}
          </div>

          <div className="tsr-date-grid" role="grid">
            {days.map((d) => (
              <button
                key={d.key}
                type="button"
                role="gridcell"
                className={['tsr-date-day', d.inMonth ? '' : 'is-outside', d.key === today ? 'is-today' : '', d.key === value ? 'is-selected' : ''].join(' ').trim()}
                disabled={isDisabled(d.key)}
                aria-selected={d.key === value}
                onClick={() => pick(d.key)}
              >
                {d.day}
              </button>
            ))}
          </div>

          <div className="tsr-date-foot">
            <button type="button" className="tsr-date-link" onClick={() => { onChange(''); setOpen(false) }} disabled={!value}>
              <X size={13} /> Clear
            </button>
            <button type="button" className="tsr-date-link" onClick={() => pick(today)} disabled={isDisabled(today)}>
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  )
}