import { useEffect, useRef } from 'react'
import { useOrganization } from '../context/OrganizationContext'

// Browser-side idle logout. This does NOT revoke an already-issued JWT on the server.
const LAST_ACTIVITY = 'philam-idle-last-activity'
const EVENTS = ['pointerdown', 'keydown', 'touchstart', 'scroll']
export default function SessionSecurity({ children, onExpired }) {
  const { organization } = useOrganization()
  const expireRef = useRef(onExpired)
  expireRef.current = onExpired

  useEffect(() => {
    const minutes = Math.max(5, Math.min(1440, Number(organization.sessionTimeoutMinutes) || 120))
    const limit = minutes * 60 * 1000
    let last = Number(sessionStorage.getItem(LAST_ACTIVITY)) || Date.now()
    let expired = false
    let lastWrite = 0
    const expire = () => {
      if (expired) return
      if (Date.now() - last < limit) return
      expired = true
      sessionStorage.removeItem(LAST_ACTIVITY)
      void expireRef.current()
    }
    const activity = () => {
      expire()
      if (expired) return
      last = Date.now()
      if (last - lastWrite > 5000) {
        lastWrite = last
        sessionStorage.setItem(LAST_ACTIVITY, String(last))
      }
    }
    // Check inactivity BEFORE registering activity handlers.
    expire()
    const timer = window.setInterval(expire, 15000)
    window.addEventListener('focus', expire)
    document.addEventListener('visibilitychange', expire)
    EVENTS.forEach(event => window.addEventListener(event, activity, { passive: true }))
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', expire)
      document.removeEventListener('visibilitychange', expire)
      EVENTS.forEach(event => window.removeEventListener(event, activity))
    }
  }, [organization.sessionTimeoutMinutes])

  return children
}
