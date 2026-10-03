import React from 'react'
import './Loader.css'

/**
 * PHILAM Village loading indicator.
 *
 * variant="fullscreen"  app boot, auth check, route changes (covers the viewport)
 * variant="panel"       inside cards, tables, and page sections (default)
 * variant="inline"      small, sits within a line of content or a button row
 */
export default function Loader({
  variant = 'panel',
  text = 'PHILAM Village',
  label = 'Loading',
}) {
  return (
    <div className={`tl-wrap tl-${variant}`} role="status" aria-live="polite">
      <span className="tl-text" data-text={text} aria-hidden="true" />
      <span className="tl-sr">{label}</span>
    </div>
  )
}