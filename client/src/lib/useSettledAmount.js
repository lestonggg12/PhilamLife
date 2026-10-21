import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

// For a partial service receipt, returns how much was collected later through
// its linked balance receipts (voided ones excluded). Returns 0 for any other
// row. The original receipt stays a historical record; this only lets its
// reprint show that the balance has since been settled.
export function useSettledAmount(row) {
  const id = row && row.payment_status === 'partial' ? row.id : null
  const [state, setState] = useState({ id: null, amount: 0 })

  useEffect(() => {
    if (!id) return undefined
    let cancelled = false
    supabase
      .from('service_transactions')
      .select('amount_paid')
      .eq('balance_of', id)
      .neq('payment_status', 'voided')
      .then(({ data, error }) => {
        if (cancelled || error) return
        const total = (data || []).reduce((sum, item) => sum + (Number(item.amount_paid) || 0), 0)
        setState({ id, amount: Math.round(total * 100) / 100 })
      })
    return () => {
      cancelled = true
    }
  }, [id])

  return id && state.id === id ? state.amount : 0
}
