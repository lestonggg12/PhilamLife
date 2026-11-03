import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./PaymentsPage.jsx', import.meta.url), 'utf8')
const recordPaymentStart = source.indexOf('showForm && canManagePayments')
const addChargeStart = source.indexOf('showCharge && canManageCharges')
const addChargeEnd = source.indexOf('showCharges && canManageCharges')

describe('Payments form final due date placement', () => {
  it('renders the final due date only in Add Charge after Amount and before the balance preview', () => {
    const recordPaymentForm = source.slice(recordPaymentStart, addChargeStart)
    const addChargeForm = source.slice(addChargeStart, addChargeEnd)
    const amountIndex = addChargeForm.indexOf('name="amount"')
    const dueDateIndex = addChargeForm.indexOf('name="dueDate"')
    const previewIndex = addChargeForm.indexOf('payment-balance-preview')

    expect(recordPaymentForm).not.toContain('Final Due Date (Required)')
    expect(addChargeForm).toContain('Final Due Date (Required)')
    expect(amountIndex).toBeGreaterThanOrEqual(0)
    expect(dueDateIndex).toBeGreaterThan(amountIndex)
    expect(previewIndex).toBeGreaterThan(dueDateIndex)
    expect(addChargeForm).toContain('value={chargeForm.dueDate}')
    expect(addChargeForm).toContain('onChange={updateChargeField}')
    expect(addChargeForm).toContain('min={todayDateKey()}')
    expect(addChargeForm).toContain('required')
  })
})
