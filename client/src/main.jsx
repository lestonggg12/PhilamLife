import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { recoverPreloadError } from './lib/appLoadRecovery'
import './styles/globals.css'
import './styles/Mobile.css'
import './styles/motion.css'
// Vite's entry URL changes with the build. A stale tab can recover once
// without repeatedly refreshing when the new deployment is also unavailable.
window.addEventListener('vite:preloadError', () => recoverPreloadError(window, import.meta.url))

class AppLoadBoundary extends React.Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="app-load-error" role="alert" aria-labelledby="app-load-error-title">
        <div className="app-load-error-content">
          <div className="app-load-error-brand">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-8H9v8H4a1 1 0 0 1-1-1z" /></svg>
            <span>PHILAM Village</span>
          </div>
          <section className="app-load-error-card">
            <div className="app-load-error-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" focusable="false"><path d="M20 16.5a4.5 4.5 0 0 0-1.6-8.7A6.5 6.5 0 0 0 6 7a5 5 0 0 0-1 9.9" /><path d="M12 11v5" /><path d="M12 20h.01" /></svg>
            </div>
            <h1 id="app-load-error-title">Unable to load this page</h1>
            <p className="app-load-error-message">Something interrupted loading. Please reload the page to try again.</p>
            <div className="app-load-error-actions">
              <button type="button" className="app-load-error-reload" onClick={() => window.location.reload()}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17" /></svg>
                Reload page
              </button>
              <a href="/" className="app-load-error-home">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-8H9v8H4a1 1 0 0 1-1-1z" /></svg>
                Back to home
              </a>
            </div>
            <p className="app-load-error-hint">If the problem continues, contact your administrator.</p>
          </section>
        </div>
      </main>
    )
  }
}

document.addEventListener('wheel', (event) => {
  const el = document.activeElement
  if (el instanceof HTMLInputElement && el.type === 'number' && el === event.target) {
    el.blur()
  }
}, { passive: true })

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppLoadBoundary><App /></AppLoadBoundary>
  </React.StrictMode>,
)