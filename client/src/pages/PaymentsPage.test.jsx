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
    const clearKey = submit.lastIndexOf('paymentSubmissionKeyRef.current = null')
    expect(clearKey).toBeGreaterThan(submit.indexOf('setReceipt(data)'))
    expect(clearKey).toBeLessThan(submit.lastIndexOf('} catch (error)'))
  })
})

describe('Payment save notices', () => {
  it('shows a confirmed discount rejection before recovery and lets staff correct the draft', () => {
    const rejection = source.slice(source.indexOf("result.error.code === '22023'"), source.indexOf("if (previous.error) throw new Error('Receipt recovery"))
    expect(rejection).toContain('There is no outstanding debt eligible for this discount.')
    expect(rejection).toContain('The original amount exceeds the unpaid charges for this payment purpose.')
    expect(rejection).toContain('paymentAttemptRef.current = null')
    expect(rejection).toContain('discountAttemptRef.current = null')
    expect(rejection).toContain('paymentSubmissionKeyRef.current = null')
    expect(rejection).toContain("title: 'Payment not saved'")
    expect(rejection).toContain('message: result.error.message')
    expect(rejection).toContain('return')
  })

  it('opens an acknowledgeable pop-up for save failures and reserves retry guidance for uncertain saves', () => {
    expect(source).toContain('open={!!paymentSaveNotice}')
    expect(source).toContain('message={paymentSaveNotice?.message}')
    expect(source).toContain('onConfirm={() => setPaymentSaveNotice(null)}')
    expect(source).toContain("title: 'Payment could not be confirmed'")
    expect(source).toContain('Refresh payment history before retrying to avoid a duplicate.')
    expect(source).not.toContain('setFormError(`The payment could not be confirmed.')
  })

  it('skips the advance-credit prompt for manual discounts', () => {
    expect(source).toContain('const advance = manualDiscount.enabled ? null : paymentAdvanceConfirmation(')
  })
})
