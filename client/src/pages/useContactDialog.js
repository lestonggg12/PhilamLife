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
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusable = (root) => [...root.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')]
      .filter((element) => !element.matches(':disabled') && element.tabIndex >= 0 && element.getClientRects().length > 0)
    const openControl = () => dialog.querySelector('button[aria-expanded="true"][aria-controls]')
    const popupFor = (control) => control && document.getElementById(control.getAttribute('aria-controls'))
    const focusFirst = () => (focusable(dialog)[0] || dialog).focus()
    focusFirst()
    function keepFocus(event) {
      if (!dialog.contains(event.target) && !popupFor(openControl())?.contains(event.target)) focusFirst()
    }
    function onKeyDown(event) {
      if (event.defaultPrevented) return
      const control = openControl()
      const popup = popupFor(control)
      if (event.key === 'Escape') {
        if (popup) {
          control.focus()
          return
        }
        event.preventDefault()
        event.stopPropagation()
        if (!state.current.busy) state.current.onClose()
      }
      if (event.key !== 'Tab') return
      const items = focusable(dialog)
      if (popup) items.splice(items.indexOf(control) + 1, 0, ...focusable(popup))
      const index = items.indexOf(event.target)
      const next = event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : (index + 1) % items.length
      event.preventDefault()
      const target = items[next] || dialog
      target.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('focusin', keepFocus)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('focusin', keepFocus)
      document.body.style.overflow = overflow
      if (previous?.isConnected) previous.focus()
    }
  }, [open])
  useEffect(() => { if (open && busy) ref.current?.focus() }, [open, busy])
  return ref
}
