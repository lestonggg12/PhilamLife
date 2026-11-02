import React from 'react'
import './skeleton.css'
import useDelayedLoading from './useDelayedLoading'

export default function SkeletonRegion({ loading, skeleton, children }) {
  const showSkeleton = useDelayedLoading(loading)

  return (
    <div className="skeleton-region" aria-busy={loading}>
      {showSkeleton && <div className="skeleton-region-placeholder">{skeleton}</div>}
      <div className={`skeleton-region-content ${showSkeleton ? 'skeleton-region-content-hidden' : ''}`}>
        {children}
      </div>
      {loading && <span className="skeleton-region-status" role="status">Loading</span>}
    </div>
  )
}
