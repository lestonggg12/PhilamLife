import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './DateField.css'

const svgProps = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
const Chevron = () => <svg width="16" height="16" viewBox="0 0 24 24" {...svgProps}><polyline points="9 18 15 12 9 6" /></svg>
const Calendar = () => <svg width="16" height="16" viewBox="0 0 24 24" {...svgProps}><rect x="3" y="4" width="18" height="17" rx="2" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MONTHS = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2020, month, 1))))
const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const pad = (value) => String(value).padStart(2, '0')
const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const parseDateKey = (key) => {
  const [year, month, day] = String(key || '').split('-').map(Number)
  return Number.isFinite(year) && Number.isFinite(month) ? { year, month: month - 1, day: day || 1 } : null
}
const monthKey = (year, month) => `${year}-${pad(month + 1)}`
const dateKey = (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
const buildDays = (year, month) => {
  const first = new Date(Date.UTC(year, month, 1))
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(year, month, 1 - first.getUTCDay() + index))
    return { key: dateKey(date), day: date.getUTCDate(), inMonth: date.getUTCMonth() === month }
  })
}

export { todayKey, parseDateKey, buildDays }

export default function DateField({
  value, onChange, min, max, placeholder = 'Any date', ariaLabel, required = false,
  disabled = false, name, clearable = true, markedDates = [], markedDatesLabel = 'Marked dates',
  monthOnly = false,
}) {
  const today = todayKey()
  const initial = parseDateKey(value) || parseDateKey(today)
  const [open, setOpen] = useState(false)
  const [openUp, setOpenUp] = useState(false)
  const [popPosition, setPopPosition] = useState(null)
  const [view, setView] = useState({ year: initial.year, month: initial.month })
  const rootRef = useRef(null)
  const popRef = useRef(null)
  const popId = useId()
  const days = useMemo(() => buildDays(view.year, view.month), [view])
  const marked = useMemo(() => new Set(markedDates.map((item) => typeof item === 'string' ? item : item.key)), [markedDates])
  const selectedDate = value ? parseDateKey(value) : null

  useEffect(() => {
    if (!open) return undefined
    const outside = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target) && !popRef.current?.contains(event.target)) setOpen(false)
    }
    const escape = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape) }
  }, [open])

  useEffect(() => {
    if (!open || !rootRef.current || !popRef.current) return
    const updatePosition = () => {
      const rect = rootRef.current.getBoundingClientRect()
      const width = Math.min(popRef.current.offsetWidth, window.innerWidth - 32)
      const height = popRef.current.offsetHeight
      const roomBelow = Math.max(0, window.innerHeight - rect.bottom - 8)
      const roomAbove = Math.max(0, rect.top - 8)
      const shouldOpenUp = roomBelow < height && roomAbove > roomBelow
      const left = Math.min(Math.max(16, rect.left), window.innerWidth - width - 16)
      const top = shouldOpenUp ? rect.top - height - 8 : rect.bottom + 8
      setOpenUp(shouldOpenUp)
      setPopPosition({ left, top: Math.max(8, top) })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, view])

  const disabledDate = (key) => Boolean((min && key < min) || (max && key > max))
  const disabledMonth = (key) => Boolean((min && `${key}-31` < min) || (max && `${key}-01` > max))
  const openPicker = () => {
    const next = parseDateKey(value) || parseDateKey(today)
    setView({ year: next.year, month: next.month })
    setOpen(true)
  }
  const shift = (delta) => setView(({ year, month }) => {
    const next = new Date(Date.UTC(year, month + (monthOnly ? 0 : delta), 1))
    if (monthOnly) return { year: year + delta, month }
    return { year: next.getUTCFullYear(), month: next.getUTCMonth() }
  })
  const pick = (key) => {
    if (disabledDate(key)) return
    onChange(key)
    setOpen(false)
  }
  const pickMonth = (month) => {
    const key = monthKey(view.year, month)
    if (disabledMonth(key)) return
    onChange(key)
    setOpen(false)
  }
  const displayValue = value
    ? (monthOnly ? monthFormat.format(new Date(`${value}-01T00:00:00Z`)) : dateFormat.format(new Date(`${value}T00:00:00Z`)))
    : placeholder

  return (
    <div className={`tsr-date${disabled ? ' is-disabled' : ''}`} ref={rootRef}>
      {name && <input className="tsr-date-hidden" tabIndex={-1} aria-hidden="true" name={name} value={value || ''} required={required} readOnly />}
      <button type="button" className={`tsr-date-trigger${open ? ' is-open' : ''}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={popId} aria-label={ariaLabel} disabled={disabled} onClick={() => (open ? setOpen(false) : openPicker())}>
        <span className={`tsr-date-text${value ? '' : ' is-placeholder'}`}>{displayValue}</span><Calendar />
      </button>
      {open && createPortal((
        <div className={`tsr-date-popover${openUp ? ' open-up' : ''}${monthOnly ? ' is-month-only' : ''}`} id={popId} role="dialog" aria-label={monthOnly ? 'Choose month' : 'Choose date'} ref={popRef} style={popPosition || undefined}>
          <div className="tsr-date-head">
            <button type="button" className="tsr-date-nav tsr-date-prev" onClick={() => shift(-1)} aria-label={monthOnly ? 'Previous year' : 'Previous month'}><Chevron /></button>
            <strong>{monthOnly ? view.year : monthFormat.format(new Date(Date.UTC(view.year, view.month, 1)))}</strong>
            <button type="button" className="tsr-date-nav" onClick={() => shift(1)} aria-label={monthOnly ? 'Next year' : 'Next month'}><Chevron /></button>
          </div>
          {monthOnly ? (
            <div className="tsr-date-month-grid" role="grid">
              {MONTHS.map((label, month) => <button key={label} type="button" role="gridcell" className={`tsr-date-month${selectedDate?.year === view.year && selectedDate.month === month ? ' is-selected' : ''}`} disabled={disabledMonth(monthKey(view.year, month))} onClick={() => pickMonth(month)}>{label.slice(0, 3)}</button>)}
            </div>
          ) : (
            <>
              <div className="tsr-date-weekdays" aria-hidden="true">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
              <div className="tsr-date-grid" role="grid">{days.map((day) => <button key={day.key} type="button" role="gridcell" className={['tsr-date-day', !day.inMonth && 'is-outside', day.key === today && 'is-today', day.key === value && 'is-selected', marked.has(day.key) && 'has-marker'].filter(Boolean).join(' ')} disabled={disabledDate(day.key)} aria-selected={day.key === value} onClick={() => pick(day.key)}>{day.day}</button>)}</div>
            </>
          )}
          <div className="tsr-date-legend-row">
            <div className="tsr-date-legend"><span><i className="tsr-date-key-today" />Today</span>{markedDates.length > 0 && <span><i className="tsr-date-key-marker" />{markedDatesLabel}</span>}</div>
            <button type="button" className="tsr-date-today-link" onClick={() => monthOnly ? pickMonth(Number(today.slice(5, 7)) - 1) : pick(today)} disabled={monthOnly ? disabledMonth(today.slice(0, 7)) : disabledDate(today)}>Jump to today</button>
          </div>
          {!monthOnly && clearable && <button type="button" className="tsr-date-clear" onClick={() => { onChange(''); setOpen(false) }} disabled={!value}>Clear</button>}
        </div>
      ), document.body)}
    </div>
  )
}
