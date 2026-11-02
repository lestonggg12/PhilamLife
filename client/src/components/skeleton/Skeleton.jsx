import React from 'react'
import './skeleton.css'

export default function Skeleton({
  variant = 'rect',
  width,
  height,
  radius,
  lines = 1,
  className = '',
  style,
}) {
  const styles = {
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(radius !== undefined ? { borderRadius: radius } : {}),
    ...style,
  }

  if (variant === 'text') {
    return (
      <span className={`skeleton skeleton-text ${className}`.trim()} style={styles} aria-hidden="true">
        {Array.from({ length: lines }, (_, index) => (
          <span
            className="skeleton-text-line"
            key={index}
            style={index === lines - 1 ? { width: '60%' } : undefined}
          />
        ))}
      </span>
    )
  }

  return <span className={`skeleton skeleton-${variant} ${className}`.trim()} style={styles} aria-hidden="true" />
}
