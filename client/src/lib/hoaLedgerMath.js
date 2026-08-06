export const firstValue = (row, keys, fallback = null) => {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null) {
      return row[key]
    }
  }

  return fallback
}

export const moneyValue = (row, keys) => {
  const value = Number(firstValue(row, keys, 0))
  return Number.isFinite(value) ? value : 0
}

export function calculateCreditsByProperty(payments, allocations) {
  const allocatedByPayment = new Map()

  allocations.forEach((allocation) => {
    if (allocation.reversed_at) return

    const paymentId = Number(allocation.payment_id)

    allocatedByPayment.set(
      paymentId,
      (allocatedByPayment.get(paymentId) || 0) +
        moneyValue(allocation, ['amount']),
    )
  })

  const creditByProperty = new Map()

  payments.forEach((payment) => {
    const isVoided =
      String(payment.status || '').toLowerCase() === 'voided'

    if (isVoided || payment.property_id == null) return

    const paid = moneyValue(payment, ['amount_paid', 'amount'])
    const allocated =
      allocatedByPayment.get(Number(payment.id)) || 0
    const propertyId = Number(payment.property_id)

    creditByProperty.set(
      propertyId,
      (creditByProperty.get(propertyId) || 0) +
        Math.max(paid - allocated, 0),
    )
  })

  return creditByProperty
}

export function addRunningBalances(lines) {
  let runningBalance = 0

  return [...lines]
    .sort((left, right) => {
      const leftDate = new Date(
        firstValue(left, ['occurred_at'], 0),
      )

      const rightDate = new Date(
        firstValue(right, ['occurred_at'], 0),
      )

      const dateDifference = leftDate - rightDate

      return (
        dateDifference ||
        String(left.source_id || '').localeCompare(
          String(right.source_id || ''),
        )
      )
    })
    .map((line) => {
      runningBalance +=
        moneyValue(line, ['debit']) -
        moneyValue(line, ['credit'])

      return {
        ...line,
        running_balance: runningBalance,
      }
    })
}