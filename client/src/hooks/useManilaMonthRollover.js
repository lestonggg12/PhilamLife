
import { useEffect, useRef } from 'react'

export function manilaMonth(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(value)
  const date = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return date.year + '-' + date.month
}

export default function useManilaMonthRollover(onRollover) {
  const callback = useRef(onRollover)
  callback.current = onRollover

  useEffect(() => {
    let last = manilaMonth()
    const check = () => {
      const current = manilaMonth()
      if (current === last) return
      last = current
      callback.current(current)
    }
    const interval = setInterval(check, 30000)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [])
}
