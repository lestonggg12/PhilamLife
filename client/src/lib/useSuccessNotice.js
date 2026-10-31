import { useCallback, useState } from 'react'
import { notifySuccess } from './actionFeedback'

// Keep existing inline notices while also announcing success above open dialogs.
export function useSuccessNotice() {
  const [notice, setNoticeState] = useState('')
  const setNotice = useCallback((message) => {
    setNoticeState(message)
    if (message) notifySuccess(message)
  }, [])
  return [notice, setNotice]
}
