import { describe, expect, it, vi } from 'vitest'
import { confirmedTransfer, contactSearchFilters, loadContactCounts, loadContactPage, moveContact, requireEffectiveDate, saveContactDetails } from './contactManager'

const contact = { id: 4, homeowner_id: 'person-id', homeowner_status: 'active', contact_phone: '111', contact_email: null, contact_updated_at: '2026-11-01T00:00:00.123456+00:00', status_updated_at: null }
function client(result) {
  const chain = {}
  for (const key of ['select', 'eq', 'or', 'order']) chain[key] = vi.fn(() => chain)
  const finish = vi.fn(async () => { if (result instanceof Error) throw result; return result })
  chain.single = finish
  chain.range = finish
  chain.then = (resolve, reject) => finish().then(resolve, reject)
  return { rpc: vi.fn(() => chain), from: vi.fn(() => chain), chain }
}

describe('Contact directory reads', () => {
  it('keeps explicit block and lot filters separate from the name search', () => {
    const [lot, block, firstName, lastName] = contactSearchFilters('Block 3, Lot 04 Sofia Santos')
    expect(lot).toBe('lot_number.eq.4')
    expect(block).toContain('block.ilike."Block 3"')
    expect(block).toContain('block.ilike."% Block 03"')
    expect(block).not.toContain('lot_number')
    expect(firstName).toContain('homeowner_name.ilike."%Sofia%"')
    expect(lastName).toContain('homeowner_name.ilike."%Santos%"')
  })
  it('searches a single digit by lot and keeps ordinary name tokens', () => {
    expect(contactSearchFilters('4')[0]).toContain('lot_number.eq.4')
    expect(contactSearchFilters('Blocker Lottie')).toHaveLength(2)
  })
  it('preserves the shared escaping rules', () => {
    expect(contactSearchFilters('C,%"() * 12')).toEqual(contactSearchFilters('C 12'))
  })
  it('returns verified zero totals instead of treating failed reads as zero', async () => {
    expect(await loadContactCounts(client({ count: 0, error: null }))).toEqual({ active: 0, moved: 0, transferred: 0 })
  })
  it.each([{ count: null, error: { message: 'Denied' } }, new Error('Offline'), { count: null, error: null }])('rejects failed or unknown counts: %j', async (result) => {
    await expect(loadContactCounts(client(result))).rejects.toBeTruthy()
  })
  it('combines tokens, status, exact total and stable pagination', async () => {
    const c = client({ data: [contact], count: 55, error: null })
    expect(await loadContactPage(c, 'active', contactSearchFilters('Block C Lot 12'), 1)).toEqual({ rows: [contact], total: 55 })
    expect(c.chain.eq).toHaveBeenCalledWith('homeowner_status', 'active')
    expect(c.chain.or).toHaveBeenCalledTimes(2)
    expect(c.chain.or.mock.calls[0][0]).toBe('lot_number.eq.12')
    expect(c.chain.range).toHaveBeenCalledWith(50, 99)
    expect(c.chain.order.mock.calls).toEqual([['homeowner_name', { ascending: true }], ['id', { ascending: true }]])
  })
  it('signals that a previously valid page disappeared after the results shrank', async () => {
    const error = { code: 'PGRST103', message: 'Requested range not satisfiable' }
    await expect(loadContactPage(client({ error }), 'active', [], 1)).resolves.toEqual({ pageOutOfRange: true })
    await expect(loadContactPage(client({ error }), 'active', [], 0)).rejects.toEqual(error)
  })
  it('does not add a status restriction to All statuses', async () => {
    const c = client({ data: [], count: 0, error: null })
    await loadContactPage(c, 'all', [], 0)
    expect(c.chain.eq).not.toHaveBeenCalled()
  })
  it.each([{ data: null, count: null, error: { message: 'Denied' } }, new Error('Offline'), { data: null, count: 0 }])('rejects a failed directory response: %j', async (result) => {
    await expect(loadContactPage(client(result), 'moved', [], 0)).rejects.toBeTruthy()
  })
})

describe('Contact Manager confirmed mutations', () => {
  it('sends the original shared-contact snapshot without rounding its timestamp', async () => {
    const c = client({ data: contact, error: null })
    await saveContactDetails(c, contact, { phone: ' 0917   123 ', email: ' TEST@EXAMPLE.COM ' })
    expect(c.rpc).toHaveBeenCalledWith('save_homeowner_contact', {
      p_property_id: 4, p_expected_homeowner_id: 'person-id', p_expected_phone: '111', p_expected_email: null,
      p_expected_updated_at: contact.contact_updated_at, p_phone: '0917 123', p_email: 'test@example.com',
    })
    expect(c.from).not.toHaveBeenCalled()
  })
  it('preserves a conflict or denied response instead of reporting success', async () => {
    const error = { code: '40001', message: 'Contact details changed. Reload.' }
    await expect(saveContactDetails(client({ error }), contact, { phone: '222', email: '' })).rejects.toEqual(error)
  })
  it.each([{ data: null }, { data: { id: 99 } }, new Error('Offline')])('rejects unconfirmed saves: %j', async (result) => {
    await expect(saveContactDetails(client(result), contact, { phone: '', email: '' })).rejects.toBeTruthy()
  })
  it.each([{ phone: 'x'.repeat(31), email: '' }, { phone: '', email: 'invalid' }])('validates contact input before calling the server', async (form) => {
    const c = client({ data: contact })
    await expect(saveContactDetails(c, contact, form)).rejects.toBeTruthy()
    expect(c.rpc).not.toHaveBeenCalled()
  })
  it('moves using identity and status version, requiring a confirmed moved row', async () => {
    const c = client({ data: { ...contact, homeowner_status: 'moved' } })
    await moveContact(c, contact, { effectiveDate: '2026-01-01', reason: ' Note ' })
    expect(c.rpc).toHaveBeenCalledWith('move_homeowner', { p_property_id: 4, p_expected_homeowner_id: 'person-id', p_expected_updated_at: null, p_effective_date: '2026-01-01', p_note: 'Note' })
    await expect(moveContact(client({ data: contact }), contact, { effectiveDate: '2026-01-01', reason: '' })).rejects.toThrow('could not be confirmed')
  })
  it('refuses an already closed source before submitting a Move', async () => {
    const c = client({})
    await expect(moveContact(c, { ...contact, homeowner_status: 'transferred' }, { effectiveDate: '2026-01-01', reason: '' })).rejects.toThrow('active')
    expect(c.rpc).not.toHaveBeenCalled()
  })
  it.each(['-infinity', 'infinity', '2026-02-30', '', '0000-01-01', '10000-01-01', '2026-11-03'])('rejects invalid/future effective date %s', (value) => {
    expect(() => requireEffectiveDate(value, '2026-11-02')).toThrow('valid effective date')
  })
  it('accepts a valid historical date and today', () => {
    expect(requireEffectiveDate('2017-01-01', '2026-11-02')).toBe('2017-01-01')
    expect(requireEffectiveDate('2026-11-02', '2026-11-02')).toBe('2026-11-02')
  })
  it.each([null, [], [{}], [{ new_property_id: 8 }], { new_property_id: 8, transferred_balance: null }, { new_property_id: 8, transferred_balance: 'NaN' }])('does not invent a zero transfer amount: %j', (value) => {
    expect(() => confirmedTransfer(value)).toThrow('could not be confirmed')
  })
  it('accepts confirmed debt, zero and advance-credit transfers', () => {
    for (const amount of ['500.00', 0, '-200.50']) expect(confirmedTransfer([{ new_property_id: 8, transferred_balance: amount }]).transferred_balance).toBe(Number(amount))
  })
})
