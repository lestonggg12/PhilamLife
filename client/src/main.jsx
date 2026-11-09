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
      <main role="alert" style={{ maxWidth: 480, margin: '12vh auto', padding: 24 }}>
        <h1>The page could not load</h1>
        <p>Check your connection, then reload the page to try again.</p>
        <button type="button" onClick={() => window.location.reload()}>Reload page</button>
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