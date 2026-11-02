import { useEffect, useRef } from 'react'

// Modal behavior stays beside Contact Manager; no shared app behavior changes.
export default function useContactDialog(open, busy, onClose) {
  const ref = useRef(null)
  const state = useRef({ busy, onClose })
  state.current = { busy, onClose }
  useEffect(() => {
    if (!open) return undefined
    const previous = document.activeElement
    const dialog = ref.current
    const focusable = () => [...dialog.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')]
      .filter((element) => !element.matches(':disabled') && element.tabIndex >= 0 && element.getClientRects().length > 0)
    const focusFirst = () => (focusable()[0] || dialog).focus()
    focusFirst()
    function keepFocus(event) {
      if (!dialog.contains(event.target)) focusFirst()
    }
    function onKeyDown(event) {
      if (event.defaultPrevented) return // Let an open date/select popover consume Escape first.
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (!state.current.busy) state.current.onClose()
      }
      if (event.key === 'Tab') {
        const items = focusable()
        const first = items[0]
        const last = items[items.length - 1]
        if (!first) { event.preventDefault(); dialog.focus() }
        else if (event.shiftKey && (event.target === first || event.target === dialog)) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && (event.target === last || event.target === dialog)) { event.preventDefault(); first.focus() }
      }
    }
    dialog.addEventListener('keydown', onKeyDown)
    document.addEventListener('focusin', keepFocus)
    return () => {
      dialog.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('focusin', keepFocus)
      if (previous?.isConnected) previous.focus()
    }
  }, [open])
  useEffect(() => { if (open && busy) ref.current?.focus() }, [open, busy])
  return ref
}
