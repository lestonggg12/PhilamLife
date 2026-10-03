import { useEffect, useState } from 'react'

export default function useAnimatedPopover(initialOpen = false, duration = 180) {
  const [open, setOpen] = useState(initialOpen)
  const [mounted, setMounted] = useState(initialOpen)
  const [visible, setVisible] = useState(initialOpen)

  useEffect(() => {
    if (!mounted) return undefined
    const frame = requestAnimationFrame(() => setVisible(open))
    return () => cancelAnimationFrame(frame)
  }, [mounted, open])

  useEffect(() => {
    if (open || !mounted) return undefined
    const timer = window.setTimeout(() => setMounted(false), duration)
    return () => window.clearTimeout(timer)
  }, [duration, mounted, open])

  function show() {
    setMounted(true)
    setOpen(true)
  }

  function hide() {
    setOpen(false)
    setVisible(false)
  }

  function toggle() {
    if (open) hide()
    else show()
  }

  return {
    open,
    mounted,
    visible,
    show,
    hide,
    toggle,
  }
}
