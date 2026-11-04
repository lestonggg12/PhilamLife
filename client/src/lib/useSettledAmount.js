import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { totalSettledServiceReceipts } from './serviceReceiptSettlement'

// A partial service receipt must not show a remaining balance until later
// linked payments have been verified. Never substitute zero for a failed read.
export function useSettledAmountStatus(row) {
  const id = row && String(row.payment_status || '').toLowerCase() === 'partial'
    ? row.id
    : null

  const [state, setState] = useState({ id: null, amount: 0, error: '' })

  useEffect(() => {
    if (!id) {
      setState({ id: null, amount: 0, error: '' })
      return undefined
    }

    let cancelled = false
    setState({ id: null, amount: 0, error: '' })

    Promise.resolve()
      .then(() => supabase
        .from('service_transactions')
        .select('amount_paid')
        .eq('balance_of', id)
        .neq('payment_status', 'voided'))
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) throw error
        const amount = totalSettledServiceReceipts(data)
        setState({ id, amount, error: '' })
      })
      .catch((failure) => {
        if (!cancelled) {
          setState({
            id,
            amount: 0,
            error: `Could not verify subsequent service payments: ${failure?.message || 'Connection failed.'} Close the receipt and retry.`,
          })
        }
      })

    return () => { cancelled = true }
  }, [id])

  if (!id) return { amount: 0, loading: false, error: '' }
  if (state.id !== id) return { amount: 0, loading: true, error: '' }
  return { amount: state.amount, loading: false, error: state.error }
}
