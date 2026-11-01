import { useCallback, useState } from 'react'
import { notifySuccess } from './actionFeedback'

// Route success feedback through the shared toast host.
export function useSuccessNotice() {
  const [notice, setNoticeState] = useState('')
  const setNotice = useCallback((message) => {
    setNoticeState(message)
    if (message) notifySuccess(message)
  }, [])
  return [notice, setNotice]
}
