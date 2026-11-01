import { fetchTableVerified } from './fetchAll'

// Explicit Admin-readable application scope. Confidential case records stay
// Secretary-only; do not use a privileged key or broaden RLS for this export.
export const ADMIN_EXPORT_TABLES = Object.freeze([
  'account_adjustments',
  'accounting_periods',
  'activity_log',
  'amenity_services',
  'annual_penalty_assessments',
  'annual_penalty_policy',
  'annual_penalty_schedules',
  'balance_entries',
  'bank_deposits',
  'blocks',
  'collection_actions',
  'documents',
  'events',
  'expenses',
  'homeowner_balance_transfers',
  'homeowners',
  'late_payment_penalties',
  'late_penalty_year_rates',
  'moved_account_reconciliations',
  'payment_allocations',
  'payments',
  'profiles',
  'properties',
  'property_charges',
  'property_payment_allocations',
  'receipt_paper_numbers',
  'service_transactions',
  'system_settings',
  'user_management_logs',
  'violations',
])

export async function buildAdminDataExport(client, {
  exportedBy = null,
  exportedAt = new Date().toISOString(),
} = {}) {
  const results = await Promise.all(ADMIN_EXPORT_TABLES.map(async (table) => {
    const result = await fetchTableVerified(client, table, {
      tiebreaker: table === 'late_penalty_year_rates' ? 'year' : 'id',
    })
    if (result.error) throw new Error(`Unable to export ${table}: ${result.error.message}`)
    return { table, rows: result.data || [], count: result.count }
  }))

  return {
    exported_at: exportedAt,
    timezone: 'Asia/Manila',
    exported_by: exportedBy,
    export_scope: {
      name: 'Admin application data',
      version: 1,
      table_count: ADMIN_EXPORT_TABLES.length,
      row_counts: Object.fromEntries(results.map(({ table, count }) => [table, count])),
      excluded_tables: ['grievance_cases', 'grievance_events'],
      excluded_components: [
        'Confidential grievance cases and history (Secretary-only)',
        'Supabase Auth accounts, passwords and sessions',
        'Storage file contents (document metadata is included)',
        'Database schema, policies, functions, sequences and server configuration',
      ],
      consistency: 'Counts verified per table; not a single transactional snapshot across tables.',
    },
    tables: Object.fromEntries(results.map(({ table, rows }) => [table, rows])),
  }
}
