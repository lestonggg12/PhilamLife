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
    expect(addChargeForm).toContain('<DateField')
    expect(addChargeForm).toContain('value={chargeForm.dueDate}')
    expect(addChargeForm).toContain("name: 'dueDate'")
    expect(addChargeForm).toContain('min={todayDateKey()}')
    expect(addChargeForm).toContain('required')
  })
})

describe('Record Payment draft initialization', () => {
  it('uses the same initializer from Homeowners and Payments', () => {
    const initializer = source.slice(source.indexOf('  const openPaymentDraft = useCallback'), source.indexOf("  // A profile's Record Payment"))
    const prefill = source.slice(source.indexOf("  // A profile's Record Payment"), source.indexOf('  // Dues payments'))
    expect(prefill).toContain('openPaymentDraft(property)')
    expect(prefill).not.toContain('setShowForm(true)')
    expect(source).toContain('onClick={openForm}')
    expect(source).toMatch(/function openForm\(\) \{\s*openPaymentDraft\(\)/)
    expect(initializer).toContain('...paymentLotFields(property)')
    expect(initializer).toContain('paymentSubmissionKeyRef.current = null')
    expect(initializer).toContain('paymentAttemptRef.current = null')
  })

  it('creates the receipt retry key on save and reuses it after a failed response', () => {
    const submit = source.slice(source.indexOf('  async function recordPayment'), source.indexOf('  // Preview for the Add Charge'))
    expect(submit).not.toContain('Payment session expired')
    expect(submit).toContain('paymentSubmissionKeyRef.current ??= crypto.randomUUID()')
    expect(submit).toContain(".eq('submission_key', paymentSubmissionKey).maybeSingle()")
    expect(submit).toContain('submission_key: paymentSubmissionKey')
    expect(submit).toContain('p_submission_key: paymentSubmissionKey')
    const clearKey = submit.indexOf('paymentSubmissionKeyRef.current = null')
    expect(clearKey).toBeGreaterThan(submit.indexOf('setReceipt(data)'))
    expect(clearKey).toBeLessThan(submit.lastIndexOf('} catch (error)'))
  })
})
