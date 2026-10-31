import { describe, expect, it, vi } from 'vitest'
import { notifyAction, notifySuccess, subscribeActionFeedback } from './actionFeedback'

describe('action feedback delivery', () => {
  it('delivers repeated identical saves as separate notifications', () => {
    const notices = []
    const unsubscribe = subscribeActionFeedback((notice) => notices.push(notice))
    notifySuccess('Contact saved.')
    notifySuccess('Contact saved.')
    unsubscribe()
    expect(notices).toHaveLength(2)
    expect(notices[0]).toMatchObject({ message: 'Contact saved.', tone: 'success' })
    expect(notices[0].id).not.toBe(notices[1].id)
  })
  it('does not announce cleared or empty messages', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeActionFeedback(listener)
    notifySuccess('')
    notifySuccess('   ')
    notifySuccess(null)
    unsubscribe()
    expect(listener).not.toHaveBeenCalled()
  })
  it('preserves a partial-save warning and stops delivery after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeActionFeedback(listener)
    notifyAction('The block was renamed, but homeowner records need checking.', 'warning')
    unsubscribe()
    notifySuccess('Another save.')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].tone).toBe('warning')
  })
})
