import { useEffect, useRef, useState } from 'react'

const DEFAULT_SHOW_DELAY = 120
const DEFAULT_MIN_VISIBLE = 400

export default function useDelayedLoading(
  loading,
  { showDelay = DEFAULT_SHOW_DELAY, minVisible = DEFAULT_MIN_VISIBLE } = {},
) {
  const [showSkeleton, setShowSkeleton] = useState(false)
  const visibleAt = useRef(0)

  useEffect(() => {
    if (!loading) {
      const remaining = Math.max(minVisible - (Date.now() - visibleAt.current), 0)
      const timer = window.setTimeout(() => setShowSkeleton(false), remaining)
      return () => window.clearTimeout(timer)
    }

    const timer = window.setTimeout(() => {
      visibleAt.current = Date.now()
      setShowSkeleton(true)
    }, showDelay)
    return () => window.clearTimeout(timer)
  }, [loading])

  return showSkeleton
}
