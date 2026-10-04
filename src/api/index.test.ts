import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApi } from './index.ts'

// A developer's own env/.env.local may set VITE_MOCK_API; the tests must not depend on it.
beforeEach(() => {
  vi.stubEnv('VITE_MOCK_API', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  window.history.pushState({}, '', '/')
})

const at = (search: string) => window.history.pushState({}, '', `/${search}`)

describe('createApi', () => {
  it('uses the real backend by default', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 502 }))
    await expect(createApi().parseRecipe('pancakes')).rejects.toMatchObject({ kind: 'upstream' })
    expect(fetchSpy).toHaveBeenCalledWith('/api/parse', expect.anything())
    fetchSpy.mockRestore()
  })

  it('uses the mock when the URL says ?mock', async () => {
    vi.useFakeTimers()
    at('?mock')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const result = createApi().parseRecipe('anything')
    await vi.advanceTimersByTimeAsync(1000)
    await expect(result).resolves.toMatchObject({ title: 'Pancakes' })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
    vi.useRealTimers()
  })

  it('uses the mock when VITE_MOCK_API is 1', async () => {
    vi.useFakeTimers()
    vi.stubEnv('VITE_MOCK_API', '1')
    const result = createApi().parseRecipe('anything')
    await vi.advanceTimersByTimeAsync(1000)
    await expect(result).resolves.toMatchObject({ title: 'Pancakes' })
    vi.useRealTimers()
  })

  it('makes the mock fail with ?mock=fail', async () => {
    vi.useFakeTimers()
    at('?mock=fail')
    const result = createApi().parseRecipe('anything').catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await result).toMatchObject({ kind: 'upstream' })
    vi.useRealTimers()
  })

  it('makes the mock slow with ?mock=slow', async () => {
    vi.useFakeTimers()
    at('?mock=slow')
    let done = false
    void createApi().parseRecipe('anything').then(() => (done = true))
    await vi.advanceTimersByTimeAsync(5000)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1500)
    expect(done).toBe(true)
    vi.useRealTimers()
  })
})
