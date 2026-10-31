import { useState } from 'react'
import { PAGE_ROWS } from './pagedQuery'

// Every word may match a different field: "Lily Block 3 Lot 12".
export function matchesHomeownerSearch(property, search) {
  const words = String(search || '').toLowerCase().split(/[\s,]+/).filter(Boolean)
  const fields = [property.homeowner_name, property.block,
    `Lot ${property.lot_number ?? ''}`, property.contact_phone, property.contact_email]
    .map((value) => String(value ?? '').toLowerCase())
  return words.every((word) => fields.some((field) => field.includes(word)))
}

// Reset immediately when filters change; clamp after a refresh removes rows.
export function useListPage(rows, filters, size = PAGE_ROWS) {
  const key = JSON.stringify(filters)
  const [position, setPosition] = useState({ key, page: 0 })
  if (position.key !== key) setPosition({ key, page: 0 })
  const page = position.key === key
    ? Math.min(position.page, Math.max(0, Math.ceil(rows.length / size) - 1)) : 0
  return {
    page,
    rows: rows.slice(page * size, (page + 1) * size),
    setPage: (next) => setPosition({ key, page: Math.max(0, next) }),
  }
}
