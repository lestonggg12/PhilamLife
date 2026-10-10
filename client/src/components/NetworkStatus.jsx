import React, { useCallback, useEffect, useRef, useState } from 'react'
import ErrorPage from './ErrorPage'
import './NetworkStatus.css'

// Same-origin file, requested with a unique query so the service worker's
// precache can't answer it. It only succeeds when the network is really there.
async function canReachServer() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(`/icons/icon-192.png?ping=${Date.now()}`, {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller.signal,
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export default function NetworkStatus() {
  const [offline, setOffline] = useState(
    () => typeof navigator !== 'undefined' && navigator.onLine === false,
  )
  const [checking, setChecking] = useState(false)
  const [stillOffline, setStillOffline] = useState(false)
  const [restored, setRestored] = useState(false)
  const wasOffline = useRef(offline)

  useEffect(() => {
    const goOffline = () => {
      setOffline(true)
      setStillOffline(false)
    }
    const goOnline = () => setOffline(false)

    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  // Brief "Back online" confirmation after a drop.
  useEffect(() => {
    if (offline) {
      wasOffline.current = true
      return undefined
    }
    if (!wasOffline.current) return undefined
    wasOffline.current = false
    setRestored(true)
    const timer = setTimeout(() => setRestored(false), 3000)
    return () => clearTimeout(timer)
  }, [offline])

  const retry = useCallback(async () => {
    setChecking(true)
    setStillOffline(false)
    const ok = await canReachServer()
    setChecking(false)
    if (ok) setOffline(false)
    else setStillOffline(true)
  }, [])

  return (
    <>
      {offline && (
        <div className="network-overlay">
          <ErrorPage
            role="alert"
            icon="offline"
            tone="warning"
            title="No internet connection"
            message="We can't reach PHILAM Life right now. Check your Wi-Fi or mobile data, then try again."
            hint={
              stillOffline
                ? "Still can't connect. Make sure you're online and try again."
                : "Anything you've typed is still here. We'll reconnect automatically when you're back online."
            }
            actions={[
              {
                label: checking ? 'Checking…' : 'Try again',
                onClick: retry,
                primary: true,
                disabled: checking,
              },
            ]}
          />
        </div>
      )}

      {restored && (
        <div className="network-toast" role="status">
          You're back online
        </div>
      )}
    </>
  )
}