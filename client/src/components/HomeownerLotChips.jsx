import React from 'react'
import './HomeownerLotChips.css'
import { classificationLabel } from '../lib/propertyClassification'

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
          <small className={`lot-classification lot-classification--${lot.property_classification || 'unknown'}`}>
            {['moved', 'transferred'].includes(lot.homeowner_status) ? 'Former account' : classificationLabel(lot.property_classification)}
          </small>
        </button>
      ))}
    </nav>
  )
}
