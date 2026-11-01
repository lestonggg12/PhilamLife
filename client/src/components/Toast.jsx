import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { subscribeActionFeedback } from '../lib/actionFeedback'
import './Toast.css'

const ToastContext = createContext(null)
let nextToastId = 0

function ToastItem({ toast, onDismiss }) {
  const [paused, setPaused] = useState(false)
  const startedAt = useRef(Date.now())
  const remaining = useRef(3000)

  useEffect(() => {
    if (toast.type === 'error' || paused) return undefined
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current)
    return () => {
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current))
      window.clearTimeout(timer)
    }
  }, [toast.id, toast.type, paused, onDismiss])

  const pause = () => {
    if (!paused) {
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current))
      setPaused(true)
    }
  }

  const resume = () => {
    startedAt.current = Date.now()
    setPaused(false)
  }

  return (
    <article
      className={`toast toast-${toast.type}`}
      role={toast.type === 'error' ? 'alert' : 'status'}
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) resume()
      }}
    >
      <span className="toast-mark" aria-hidden="true">{toast.type === 'error' ? '!' : '✓'}</span>
      <p>{toast.message}</p>
      <button type="button" aria-label="Dismiss notification" onClick={() => onDismiss(toast.id)}>×</button>
      {toast.type !== 'error' && <span className={`toast-countdown${paused ? ' is-paused' : ''}`} />}
    </article>
  )
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => {
    setToasts((items) => items.filter((item) => item.id !== id))
  }, [])

  const add = useCallback((message, type = 'success') => {
    const text = String(message ?? '').trim()
    if (!text) return undefined
    const toast = { id: ++nextToastId, message: text, type }
    setToasts((items) => [...items, toast].slice(-3))
    return toast.id
  }, [])

  const toast = useMemo(() => ({
    success: (message) => add(message, 'success'),
    error: (message) => add(message, 'error'),
    info: (message) => add(message, 'info'),
  }), [add])

  useEffect(() => subscribeActionFeedback((notice) => {
    add(notice.message, notice.tone === 'warning' ? 'error' : notice.tone)
  }), [add])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <aside className="toast-stack" aria-label="Notifications">
        {toasts.map((item) => <ToastItem key={item.id} toast={item} onDismiss={dismiss} />)}
      </aside>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const toast = useContext(ToastContext)
  if (!toast) throw new Error('useToast must be used inside ToastProvider')
  return toast
}
