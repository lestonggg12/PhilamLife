import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { Clock } from './Icons'
import './TimePicker.css'

const PERIODS = ['AM', 'PM']
const HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
const pad = (n) => String(n).padStart(2, '0')
const to24 = (h12, period) => (h12 % 12) + (period === 'PM' ? 12 : 0)

// "HH:mm" or "HH:mm:ss" -> minutes since midnight (null when empty/invalid)
export function timeToMinutes(value) {
  if (!value) return null
  const [h, m] = String(value).split(':')
  const hours = Number(h)
  const minutes = Number(m)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  return hours * 60 + minutes
}

// "14:00" -> "02:00 PM" (or "2:00 PM" when padHour is false)
export function formatTime12(value, padHour = true) {
  const total = timeToMinutes(value)
  if (total === null) return ''
  const h24 = Math.floor(total / 60)
  const h12 = h24 % 12 || 12
  return `${padHour ? pad(h12) : h12}:${pad(total % 60)} ${h24 < 12 ? 'AM' : 'PM'}`
}

// Back-to-back ranges are allowed (a start equal to another range's end is not an overlap).
export function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && endA > startB
}

function parseDraft(value) {
  const total = timeToMinutes(value)
  if (total === null) return { h: null, m: null, p: null }
  const h24 = Math.floor(total / 60)
  return { h: h24 % 12 || 12, m: total % 60, p: h24 < 12 ? 'AM' : 'PM' }
}

/**
 * value / onChange use a 24-hour "HH:mm" string (or "").
 * mode: 'start' | 'end'.  counterpart: the other picker's value ("HH:mm" or "").
 * bookedRanges: [{ start: 'HH:mm', end: 'HH:mm' }]
 */
export default function TimePicker({
  label,
  value,
  onChange,
  minuteStep = 5,
  bookedRanges = [],
  mode = 'start',
  counterpart = '',
  loading = false,
  disabled = false,
  invalid = false,
}) {
  const uid = useId()
  const triggerRef = useRef(null)
  const popRef = useRef(null)
  const didFocus = useRef(false)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({ h: null, m: null, p: null })
  const [pos, setPos] = useState(null)

  const minuteOptions = useMemo(() => {
    const step = Math.max(1, Number(minuteStep) || 5)
    const list = []
    for (let m = 0; m < 60; m += step) list.push(m)
    const current = timeToMinutes(value)
    if (current !== null && !list.includes(current % 60)) list.push(current % 60)
    return list.sort((a, b) => a - b)
  }, [minuteStep, value])

  const booked = useMemo(
    () =>
      bookedRanges
        .map((r) => ({ start: timeToMinutes(r.start), end: timeToMinutes(r.end) }))
        .filter((r) => r.start !== null && r.end !== null && r.end > r.start),
    [bookedRanges],
  )
  const other = timeToMinutes(counterpart)

  // Why a time (minutes since midnight) cannot be chosen: 'booked' | 'order' | null
  const reasonFor = useCallback(
    (t) => {
      if (mode === 'start') {
        if (booked.some((r) => t >= r.start && t < r.end)) return 'booked'
        if (other !== null) {
          if (t >= other) return 'order'
          if (booked.some((r) => rangesOverlap(t, other, r.start, r.end))) return 'booked'
        }
        return null
      }
      if (other !== null) {
        if (t <= other) return 'order'
        if (booked.some((r) => rangesOverlap(other, t, r.start, r.end))) return 'booked'
        return null
      }
      if (booked.some((r) => t > r.start && t <= r.end)) return 'booked'
      return null
    },
    [mode, booked, other],
  )

  // Looks through every time matching the fixed parts; returns the first usable one,
  // or the reason nothing is usable.
  const scan = useCallback(
    (fixed) => {
      const reasons = new Set()
      const periods = fixed.p ? [fixed.p] : PERIODS
      const hours = fixed.h ? [fixed.h] : HOURS
      const mins = fixed.m !== null ? [fixed.m] : minuteOptions
      for (const p of periods) {
        for (const h of hours) {
          for (const m of mins) {
            const reason = reasonFor(to24(h, p) * 60 + m)
            if (!reason) return { first: { h, m, p }, reason: null }
            reasons.add(reason)
          }
        }
      }
      return { first: null, reason: reasons.has('booked') ? 'booked' : 'order' }
    },
    [minuteOptions, reasonFor],
  )

  const place = useCallback((event) => {
    if (event && popRef.current && popRef.current.contains(event.target)) return
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const width = Math.max(rect.width, 156)
    const popHeight = popRef.current ? popRef.current.offsetHeight : 300
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)
    const below = window.innerHeight - rect.bottom - 8
    const above = rect.top - 8
    const placeAbove = below < popHeight && above > below
    setPos({
      left,
      width,
      top: placeAbove ? Math.max(8, rect.top - popHeight - 6) : rect.bottom + 6,
    })
  }, [])

  useLayoutEffect(() => {
    if (!open) return undefined
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, place])

  useEffect(() => {
    if (!open) {
      didFocus.current = false
      return undefined
    }
    function handleDown(event) {
      if (popRef.current?.contains(event.target)) return
      if (triggerRef.current?.contains(event.target)) return
      setOpen(false)
    }
    function handleKey(event) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', handleDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  // Once positioned: scroll each column to its selection and focus the hour column.
  useEffect(() => {
    if (!open || !pos || didFocus.current || !popRef.current) return
    didFocus.current = true
    popRef.current.querySelectorAll('[data-col]').forEach((column) => {
      const selected = column.querySelector('[aria-selected="true"]')
      if (selected) {
        column.scrollTop = selected.offsetTop - column.clientHeight / 2 + selected.offsetHeight / 2
      }
    })
    focusColumn(0)
  }, [open, pos])

  function focusColumn(index) {
    const column = popRef.current?.querySelectorAll('[data-col]')[index]
    column?.querySelector('[tabindex="0"]')?.focus({ preventScroll: true })
  }

  function openPicker() {
    setDraft(parseDraft(value))
    setPos(null)
    setOpen(true)
  }

  function close(returnFocus) {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }

  function emit(next) {
    onChange(`${pad(to24(next.h, next.p))}:${pad(next.m)}`)
  }

  function pick(colKey, picked) {
    let next = { ...draft, [colKey]: picked }

    if (colKey === 'p') {
      const filled = scan(next).first
      if (!filled) return
      setDraft(filled)
      emit(filled)
      close(true)
      return
    }

    if (next.h !== null && next.m !== null && next.p !== null) {
      if (reasonFor(to24(next.h, next.p) * 60 + next.m)) {
        const keep = { h: colKey === 'h' ? picked : null, m: colKey === 'm' ? picked : null }
        const alt = scan({ ...keep, p: next.p }).first || scan({ ...keep, p: null }).first
        if (!alt) return
        next = alt
      }
      setDraft(next)
      emit(next)
      return
    }

    setDraft(next)
    const columnIndex = colKey === 'h' ? 0 : 1
    requestAnimationFrame(() => focusColumn(columnIndex + 1))
  }

  function clear() {
    setDraft({ h: null, m: null, p: null })
    onChange('')
    close(true)
  }

  function onColumnKeyDown(event) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const options = Array.from(
      event.currentTarget.querySelectorAll('[role="option"]:not([aria-disabled="true"])'),
    )
    if (!options.length) return
    const index = options.indexOf(document.activeElement)
    const last = options.length - 1
    let target = options[0]
    if (event.key === 'End') target = options[last]
    if (event.key === 'ArrowDown') target = options[Math.min(index + 1, last)]
    if (event.key === 'ArrowUp') target = options[Math.max(index - 1, 0)]
    target.focus()
  }

  function onPopoverKeyDown(event) {
    if (event.key !== 'Tab' || !popRef.current) return
    const stops = Array.from(
      popRef.current.querySelectorAll('[tabindex="0"], .tp-clear:not(:disabled)'),
    )
    if (!stops.length) return
    const leavingForward = !event.shiftKey && document.activeElement === stops[stops.length - 1]
    const leavingBack = event.shiftKey && document.activeElement === stops[0]
    if (leavingForward || leavingBack) {
      event.preventDefault()
      close(true)
    }
  }

  function renderColumn(colKey, name, items) {
    const tabbable = items.find((i) => i.selected && !i.reason) || items.find((i) => !i.reason)
    return (
      <div
        key={colKey}
        className="tp-column"
        role="listbox"
        aria-label={name}
        data-col={colKey}
        onKeyDown={onColumnKeyDown}
      >
        {items.map((item) => {
          const reasonText = item.reason === 'booked' ? 'Booked' : 'Unavailable'
          return (
            <button
              key={item.value}
              type="button"
              role="option"
              aria-selected={item.selected}
              aria-disabled={item.reason ? 'true' : undefined}
              aria-label={item.reason ? `${item.text}, ${reasonText}` : undefined}
              title={item.reason ? reasonText : undefined}
              tabIndex={tabbable === item ? 0 : -1}
              className={`tp-option${item.selected ? ' is-selected' : ''}${
                item.reason ? ' is-disabled' : ''
              }`}
              onClick={() => {
                if (!item.reason) pick(colKey, item.value)
              }}
            >
              {item.text}
            </button>
          )
        })}
      </div>
    )
  }

  const hourItems = open
    ? HOURS.map((h) => ({
        value: h,
        text: pad(h),
        selected: draft.h === h,
        reason: scan({ ...draft, h }).reason,
      }))
    : []
  const minuteItems = open
    ? minuteOptions.map((m) => ({
        value: m,
        text: pad(m),
        selected: draft.m === m,
        reason: scan({ ...draft, m }).reason,
      }))
    : []
  const periodItems = open
    ? PERIODS.map((p) => ({
        value: p,
        text: p,
        selected: draft.p === p,
        reason: scan({ ...draft, p }).reason,
      }))
    : []

  return (
    <div className="tp-field">
      <span className="tp-label" id={`${uid}-label`}>{label}</span>
      <button
        type="button"
        ref={triggerRef}
        className={`tp-trigger${open ? ' is-open' : ''}${invalid ? ' is-invalid' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-busy={loading || undefined}
        aria-labelledby={`${uid}-label ${uid}-value`}
        disabled={disabled || loading}
        onClick={() => (open ? close(false) : openPicker())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            openPicker()
          }
        }}
      >
        <span id={`${uid}-value`} className={`tp-value${value ? '' : ' is-placeholder'}`}>
          {value ? formatTime12(value) : '--:-- --'}
        </span>
        <Clock size={16} />
      </button>

      {open &&
        createPortal(
          <div
            ref={popRef}
            className="tp-popover"
            role="dialog"
            aria-label={`${label} picker`}
            style={
              pos
                ? { top: pos.top, left: pos.left, width: pos.width }
                : { visibility: 'hidden', top: 0, left: 0 }
            }
            onKeyDown={onPopoverKeyDown}
          >
            <div className="tp-columns">
              {renderColumn('h', 'Hour', hourItems)}
              {renderColumn('m', 'Minute', minuteItems)}
              {renderColumn('p', 'AM or PM', periodItems)}
            </div>
            <div className="tp-footer">
              <button type="button" className="tp-clear" onClick={clear} disabled={!value}>
                Clear
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}