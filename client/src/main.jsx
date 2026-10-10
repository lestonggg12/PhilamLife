import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'
import './styles/Mobile.css'
document.addEventListener('wheel', (event) => {
  const el = document.activeElement
  if (el instanceof HTMLInputElement && el.type === 'number' && el === event.target) {
    el.blur()
  }
}, { passive: true })

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)