import React, { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown } from './Icons'

// A disclosure of the existing profile actions; authorization stays with the page.
export default function HomeownerActionsMenu({ children }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return undefined
    function closeOutside(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    function closeOnEscape(event) {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div
      className="homeowner-actions-disclosure"
      ref={rootRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <button
        type="button"
        ref={triggerRef}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        Manage <ChevronDown size={15} />
      </button>
      {open && (
        <div
          id={panelId}
          className="homeowner-actions-popover"
          role="group"
          aria-label="Homeowner actions"
          onClick={(event) => {
            if (event.target.closest('button')) setOpen(false)
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}
