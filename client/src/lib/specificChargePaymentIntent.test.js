import { describe, expect, it } from 'vitest'
import {
  financialSubmissionIntent,
  assertFinancialSubmissionMatches,
  requireUnchangedFinancialAttempt,
} from './financialSubmissionIntegrity'

const payment = {
  submission_key: '11111111-1111-4111-8111-111111111111',
  property_id: 1846,
  recorded_by: '56a36ea0-ba3c-4a10-96de-a0a66cb7ff97',
  charge_type: 'Penalty / Late Fee',
  specific_charge_id: 'fc9ec2b9-42c0-43c5-89d7-324d9a63a790',
  coverage_period: 'Penalty / Late Fee — selected penalty',
  amount: 20,
  amount_paid: 20,
  payment_method: 'Cash',
  reference_number: null,
  note: null,
}

describe('Specific penalty payment submission identity', () => {
  it('accepts the saved payment only with the exact selected charge', () => {
    const expected = financialSubmissionIntent('payment', payment)
    const persisted = {
  ...payment,
  id: 9001,
  receipt_number: 'OR-2026-009001',
  status: 'Completed',
}
    expect(assertFinancialSubmissionMatches(expected, persisted)).toBe(persisted)
    expect(() => assertFinancialSubmissionMatches(expected, {
      ...persisted,
      specific_charge_id: 'b97eed18-d094-432b-8605-4cd09e1bf1b9',
    })).toThrow()
  })

  it('does not allow a retry to redirect money to a different charge', () => {
    const first = financialSubmissionIntent('payment', payment)
    const changed = financialSubmissionIntent('payment', {
      ...payment,
      specific_charge_id: 'b97eed18-d094-432b-8605-4cd09e1bf1b9',
    })
    expect(() => requireUnchangedFinancialAttempt(first, changed)).toThrow()
  })

  it('keeps existing general payments un-targeted', () => {
    const general = financialSubmissionIntent('payment', {
      ...payment,
      charge_type: 'Balance Payment',
      specific_charge_id: null,
    })
    expect(general.specific_charge_id).toBe('')
  })
})
