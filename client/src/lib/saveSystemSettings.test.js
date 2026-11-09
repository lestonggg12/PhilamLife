import { describe, expect, it, vi } from 'vitest'
import { saveSystemSettings } from './saveSystemSettings'

function fixture(response) {
  const query = {
    rpc: vi.fn().mockResolvedValue(response),
  }
  return { client: { rpc: query.rpc }, query }
}

const saved = { id: 1, settings_revision: 2, hoa_name: 'Confirmed HOA', date_format: 'DD/MM/YYYY', session_timeout: 15 }

describe('confirmed system settings save', () => {
  it('refreshes the shared context with the returned database row, not a draft', async () => {
    const { client, query } = fixture({ data: saved, error: null })
    const refresh = vi.fn().mockResolvedValue({ error: null })
    const draft = { hoa_name: 'Draft HOA', session_timeout: 30 }
    const result = await saveSystemSettings(client, { hoa_name: 'Confirmed HOA' }, 1, refresh)
    expect(query.rpc).toHaveBeenCalledWith('save_system_settings_guarded', expect.objectContaining({
      p_expected_revision: 1,
      p_hoa_name: 'Confirmed HOA',
    }))
    expect(refresh).toHaveBeenCalledWith(saved)
    expect(result).toEqual({ settings: saved, refreshError: null, cacheError: null })
  })

  it('propagates a database authorization error without refreshing', async () => {
    const denied = { code: 'PGRST116', message: 'The result contains 0 rows' }
    const { client } = fixture({ data: null, error: denied })
    const refresh = vi.fn()
    await expect(saveSystemSettings(client, {}, 1, vi.fn())).rejects.toEqual(denied)
    expect(refresh).not.toHaveBeenCalled()
  })

  it.each([null, {}, { id: 2 }])('rejects an absent or unexpected singleton row: %j', async (data) => {
    const { client } = fixture({ data, error: null })
    const refresh = vi.fn()
    await expect(saveSystemSettings(client, {}, 1, refresh)).rejects.toThrow('No settings row was updated')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('propagates a write transport failure without refreshing', async () => {
    const { client, query } = fixture({})
    query.rpc.mockRejectedValue(new Error('Network unavailable'))
    const refresh = vi.fn()
    await expect(saveSystemSettings(client, {}, 1, refresh)).rejects.toThrow('Network unavailable')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('preserves the committed-save outcome when shared refresh throws', async () => {
    const { client, query } = fixture({ data: saved, error: null })
    const error = new Error('Session ended')
    const result = await saveSystemSettings(client, {}, 1, vi.fn().mockRejectedValue(error))
    expect(result).toEqual({ settings: saved, refreshError: error, cacheError: null })
    expect(query.rpc).toHaveBeenCalledOnce()
  })

  it('reports a returned refresh error separately from the committed write', async () => {
    const { client } = fixture({ data: saved, error: null })
    const error = new Error('Shared context unavailable')
    expect((await saveSystemSettings(client, {}, 1, async () => ({ error }))).refreshError).toBe(error)
  })

  it('distinguishes a cache failure from a failed database save or context update', async () => {
    const { client } = fixture({ data: saved, error: null })
    const cacheError = new Error('Storage blocked')
    expect(await saveSystemSettings(client, {}, 1, async () => ({ error: null, cacheError })))
      .toEqual({ settings: saved, refreshError: null, cacheError })
  })

  it('waits for the shared refresh before returning success', async () => {
    const { client } = fixture({ data: saved, error: null })
    let release
    const refresh = vi.fn(() => new Promise((resolve) => { release = resolve }))
    let finished = false
    const pending = saveSystemSettings(client, {}, 1, refresh).then(() => { finished = true })
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    expect(finished).toBe(false)
    release({ error: null })
    await pending
    expect(finished).toBe(true)
  })
})
