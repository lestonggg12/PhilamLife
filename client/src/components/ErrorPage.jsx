import React from 'react'
import { Link } from 'react-router-dom'
import './ErrorPage.css'

const icons = {
  offline: (
    <>
      <line x1="2" y1="2" x2="22" y2="22" />
      <path d="M8.5 16.5a5 5 0 0 1 7 0" />
      <path d="M2 8.82a15 15 0 0 1 4.17-2.65" />
      <path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76" />
      <path d="M16.85 11.25a10 10 0 0 1 2.22 1.68" />
      <path d="M5 13a10 10 0 0 1 5.24-2.76" />
      <line x1="12" y1="20" x2="12.01" y2="20" />
    </>
  ),
  notFound: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </>
  ),
  forbidden: (
    <>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </>
  ),
}

/**
 * Shared status page (offline / 404 / 403).
 * `inline` renders inside the app layout instead of covering the whole screen.
 */
export default function ErrorPage({
  icon = 'notFound',
  code,
  title,
  message,
  hint,
  actions = [],
  inline = false,
  tone = 'default',
  role = undefined,
}) {
  return (
    <div
      className={`error-page${inline ? ' error-page--inline' : ''} error-page--${tone}`}
      role={role}
    >
      <div className="error-card">
        <span className="error-icon" aria-hidden="true">
          <svg
            width="34"
            height="34"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {icons[icon]}
          </svg>
        </span>

        {code && <p className="error-code">{code}</p>}
        <h1 className="error-title">{title}</h1>
        <p className="error-message">{message}</p>
        {hint && <p className="error-hint">{hint}</p>}

        {actions.length > 0 && (
          <div className="error-actions">
            {actions.map((action) => {
              const className = `btn ${action.primary ? 'btn-primary' : 'btn-secondary'} error-btn`
              return action.to ? (
                <Link key={action.label} to={action.to} className={className}>
                  {action.label}
                </Link>
              ) : (
                <button
                  key={action.label}
                  type="button"
                  className={className}
                  onClick={action.onClick}
                  disabled={action.disabled}
                >
                  {action.label}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}