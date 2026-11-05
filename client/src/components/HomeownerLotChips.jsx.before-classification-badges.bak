import React from 'react'
import './HomeownerLotChips.css'

export default function HomeownerLotChips({ lots, selectedId, onSelect }) {
  if (lots.length < 2) return null
  return (
    <nav className="homeowner-lot-chips" aria-label="Homeowner lots">
      {lots.map((lot) => (
        <button
          key={lot.id}
          type="button"
          aria-current={String(lot.id) === String(selectedId) ? 'page' : undefined}
          onClick={() => onSelect(lot.id)}
        >
          {lot.block}, Lot {lot.lot_number}
        </button>
      ))}
    </nav>
  )
}
