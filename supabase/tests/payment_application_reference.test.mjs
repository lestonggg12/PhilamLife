// Dependency-free reference checks for the SQL application-difference contract.
// NOT a replacement for executing the SQL regression on an isolated database.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const rows = (...items) => items.map(([kind, id, unpaid]) => ({ kind, ref_id: id, unpaid }))
const dues = '00000000-0000-0000-0000-000000000101'
const penalty = '00000000-0000-0000-0000-000000000102'
function preview(before, after, effect) {
  assert.ok(Number.isInteger(effect) && effect >= 0)
  const original = new Map(before.map(x => [`${x.kind}:${x.ref_id}`, x]))
  const later = new Map(after.map(x => [`${x.kind}:${x.ref_id}`, x]))
  assert.equal(original.size, before.length)
  assert.equal(later.size, after.length)
  const items = []
  for (const x of before) {
    const remainder = later.get(`${x.kind}:${x.ref_id}`)?.unpaid || 0
    const amount = x.unpaid - remainder
    assert.ok(amount >= 0, 'paying cannot increase old unpaid items')
    if (amount > 0) items.push({ kind: x.kind, ref_id: x.ref_id, amount })
  }
  for (const x of after) assert.ok(original.has(`${x.kind}:${x.ref_id}`), 'no new unpaid item')
  const applied = items.reduce((sum, x) => sum + x.amount, 0)
  assert.ok(applied <= effect, 'cannot allocate more than payment effect')
  return { applied, unapplied: effect - applied, items }
}

test('ordinary payment settles the recorded dues', () => {
  assert.deepEqual(preview(rows(['dues', dues, 800]), [], 800), {
    applied: 800, unapplied: 0, items: [{kind:'dues',ref_id:dues,amount:800}]
  })
})
test('advance without an existing bill does not invent a charge link', () => {
  assert.deepEqual(preview([], [], 500), { applied: 0, unapplied: 500, items: [] })
})
test('partial settlement preserves the unpaid difference', () => {
  assert.equal(preview(rows(['dues',dues,800]), rows(['dues',dues,500]),300).applied,300)
})
test('CCTV credit is netted to its month before the cash application', () => {
  assert.equal(preview(rows(['dues',dues,600]),[],600).applied,600)
})
test('one-month-free annual prepayment distinguishes 8800 cash, 800 noncash', () => {
  const result = preview([],[],9600)
  assert.equal(result.unapplied,9600)
  assert.equal(8800+800,9600)
})
test('manual waiver stays separate from cash allocated to charges', () => {
  const savedCash=preview(rows(['dues',dues,1000]),rows(['dues',dues,400]),600)
  assert.equal(savedCash.applied,600)
  assert.equal(400-100,300) // later waiver is a separate account adjustment
})
test('voided payment retains historical issuance evidence without a new application', () => {
  const issuance = preview(rows(['dues',dues,600]),[],600)
  const status = 'Voided'
  assert.equal(status,'Voided')
  assert.equal(issuance.applied,600)
  // The production view must join this preserved issuance to payments.status.
})
test('annual penalty can be identified independently from regular dues', () => {
  const result=preview(rows(['dues',dues,600],['penalty',penalty,70]),rows(['dues',dues,600]),70)
  assert.equal(result.items[0].kind,'penalty')
  assert.equal(result.applied,70)
})
test('mixed payment separates historical settlement and future credit', () => {
  assert.deepEqual(preview(rows(['dues',dues,500]),[],700).unapplied,200)
})
test('fail closed on increasing debt or over-allocation', () => {
  assert.throws(()=>preview(rows(['dues',dues,500]),[],400),/allocate more/)
  assert.throws(()=>preview(rows(['dues',dues,500]),rows(['dues',dues,600]),400),/increase/)
})
