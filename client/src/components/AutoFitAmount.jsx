import React, { useLayoutEffect, useRef } from 'react'

// Preserve the complete amount; reduce type only when its card needs it.
export default function AutoFitAmount({ value, className }) {
  const containerRef = useRef(null)
  const textRef = useRef(null)

  useLayoutEffect(() => {
    const container = containerRef.current
    const text = textRef.current
    let active = true
    function fit() {
      if (!active || !container.clientWidth) return
      const maximum = parseFloat(getComputedStyle(container).fontSize)
      text.style.fontSize = `${maximum}px`
      const available = Math.max(1, container.clientWidth - 1)
      let size = maximum
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const width = text.getBoundingClientRect().width
        if (width <= available) break
        size *= available / width
        text.style.fontSize = `${size}px`
      }
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(container)
    document.fonts?.ready.then(fit)
    return () => { active = false; observer.disconnect() }
  }, [value])

  return (
    <div ref={containerRef} className={className} title={String(value)} style={{ minWidth: 0 }}>
      <span ref={textRef} style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  )
}
