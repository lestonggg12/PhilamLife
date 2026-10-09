import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import './Select.css'

const svgProps = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
const Chevron = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" {...svgProps}><polyline points="6 9 12 15 18 9" /></svg>
)
const CheckIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" {...svgProps}><polyline points="20 6 9 17 4 12" /></svg>
)

/**
 * Styled single-select that looks the same in every browser (a native
 * <select> list cannot be styled). Styles: Select.css.
 *
 *   <Select value={v} onChange={setV} ariaLabel="Category"
 *           options={[{ value: 'a', label: 'Option A' }, ...]} />
 *
 * Keyboard: Arrow keys, Home/End, Enter/Space to choose, Escape to close.
 * The list opens upward when there is no room below (e.g. inside a modal).
 */
export default function Select({ value, options, onChange, ariaLabel, placeholder = 'Select', disabled = false }) {
  const [open, setOpen] = useState(false)
  const [openUp, setOpenUp] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef(null)
  const listRef = useRef(null)
  const listId = useId()

  const selectedIndex = useMemo(() => options.findIndex((o) => o.value === value), [options, value])
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  // Flip upward if the list would run off the bottom of the window.
  useEffect(() => {
    if (!open || !rootRef.current || !listRef.current) return
    const trigger = rootRef.current.getBoundingClientRect()
    const height = listRef.current.offsetHeight
    const roomBelow = window.innerHeight - trigger.bottom - 12
    setOpenUp(roomBelow < height && trigger.top > roomBelow)
  }, [open])

  useEffect(() => {
    if (!open || !listRef.current) return
    listRef.current.children[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  function openList() {
    if (disabled) return
    setActiveIndex(Math.max(selectedIndex, 0))
    setOpen(true)
  }

  function choose(index) {
    const option = options[index]
    if (option) onChange(option.value)
    setOpen(false)
  }

  function onKeyDown(event) {
    if (disabled) return
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault()
        openList()
      }
      return
    }
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); setActiveIndex((i) => Math.min(i + 1, options.length - 1)); break
      case 'ArrowUp': event.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); break
      case 'Home': event.preventDefault(); setActiveIndex(0); break
      case 'End': event.preventDefault(); setActiveIndex(options.length - 1); break
      case 'Enter':
      case ' ': event.preventDefault(); choose(activeIndex); break
      case 'Escape': event.preventDefault(); setOpen(false); break
      case 'Tab': setOpen(false); break
      default: break
    }
  }

  return (
    <div className="sel-root" ref={rootRef}>
      <button
        type="button"
        className={`sel-trigger${open ? ' is-open' : ''}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        <span className={`sel-text${selected ? '' : ' is-placeholder'}`}>{selected ? selected.label : placeholder}</span>
        <span className="sel-chevron"><Chevron /></span>
      </button>

      {open && (
        <ul className={`sel-popover${openUp ? ' open-up' : ''}`} id={listId} role="listbox" ref={listRef}>
          {options.map((option, index) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className={`sel-option${index === activeIndex ? ' is-active' : ''}${option.value === value ? ' is-selected' : ''}`}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              {option.value === value && <CheckIcon />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}