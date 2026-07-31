import { useEffect, useRef } from 'react'

const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click']

/**
 * Automatically calls `onTimeout` after `timeoutMinutes` of user inactivity.
 * Any of the events in ACTIVITY_EVENTS resets the countdown. This enforces
 * the "Session Timeout" value configured in System Settings, which was
 * previously saved to the database but never actually acted on anywhere.
 */
export default function useSessionTimeout(timeoutMinutes, onTimeout) {
  const timerRef = useRef(null)
  const onTimeoutRef = useRef(onTimeout)

  // Keep the latest onTimeout callback without needing to re-attach listeners.
  useEffect(() => {
    onTimeoutRef.current = onTimeout
  }, [onTimeout])

  useEffect(() => {
    const minutes = Number(timeoutMinutes)

    if (!minutes || minutes <= 0) {
      return undefined
    }

    const timeoutMs = minutes * 60 * 1000

    function resetTimer() {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }

      timerRef.current = setTimeout(() => {
        onTimeoutRef.current?.()
      }, timeoutMs)
    }

    resetTimer()

    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, resetTimer, { passive: true })
    })

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
      ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, resetTimer)
      })
    }
  }, [timeoutMinutes])
}
