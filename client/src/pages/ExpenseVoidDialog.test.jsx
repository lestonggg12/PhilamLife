import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ExpenseVoidDialog from './ExpenseVoidDialog'
const props = { expense: { description: 'Fixture expense' }, reason: '', onReason() {}, onCancel() {}, onConfirm() {} }
describe('expense cancellation reason dialog', () => {
  it('requires a labeled reason before confirming', () => {
    const html = renderToStaticMarkup(<ExpenseVoidDialog {...props} />)
    expect(html).toContain('role="dialog"'); expect(html).toContain('Cancellation reason'); expect(html).toContain('minLength="5"'); expect(html).toContain('maxLength="500"'); expect(html).toContain('disabled="">Void expense')
  })
  it('keeps the error with the form and disables controls while saving', () => {
    const html = renderToStaticMarkup(<ExpenseVoidDialog {...props} reason="Wrong amount" busy error="Audit unavailable" />)
    expect(html).toContain('role="alert"'); expect(html).toContain('Audit unavailable'); expect(html).toContain('Voiding…')
  })
  it('does not render when no expense is selected', () => {
    expect(renderToStaticMarkup(<ExpenseVoidDialog {...props} expense={null} />)).toBe('')
  })
})
