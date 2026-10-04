// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { handleApiRequest, syncEnvKeys, type ApiHandler } from './devApiCore.ts'

const json = (body: unknown) => JSON.stringify(body)
const request = (over: Partial<Parameters<typeof handleApiRequest>[0]> = {}) => ({
  route: 'parse',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  bodyText: json({ recipe: 'pancakes' }),
  ...over,
})

/** A handler that records what it was given and answers 200 with a JSON body. */
function recordingHandler(): { handler: ApiHandler; seen: { method?: string; headers?: Record<string, unknown>; body?: unknown } } {
  const seen: { method?: string; headers?: Record<string, unknown>; body?: unknown } = {}
  const handler: ApiHandler = async (req, res) => {
    Object.assign(seen, { method: req.method, headers: req.headers, body: req.body })
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ ok: true })
  }
  return { handler, seen }
}

describe('handleApiRequest', () => {
  it('gives the handler the method, the headers in lower case, and the JSON body parsed', async () => {
    const { handler, seen } = recordingHandler()
    await handleApiRequest(request(), async () => handler)
    expect(seen).toEqual({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { recipe: 'pancakes' },
    })
  })

  it('returns what the handler answered: status, headers and JSON body', async () => {
    const { handler } = recordingHandler()
    const out = await handleApiRequest(request(), async () => handler)
    expect(out.status).toBe(200)
    expect(out.headers).toMatchObject({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json' })
    expect(JSON.parse(String(out.body))).toEqual({ ok: true })
  })

  it('passes a handler error status through', async () => {
    const handler: ApiHandler = async (_req, res) => {
      res.status(422).json({ error: { kind: 'unprocessable', message: 'Recipe has no steps.' } })
    }
    const out = await handleApiRequest(request(), async () => handler)
    expect(out.status).toBe(422)
    expect(JSON.parse(String(out.body)).error.kind).toBe('unprocessable')
  })

  it('lets the handler decide about other methods, so a GET gets its own 405', async () => {
    const { handler, seen } = recordingHandler()
    await handleApiRequest(request({ method: 'GET', bodyText: '' }), async () => handler)
    expect(seen.method).toBe('GET')
    expect(seen.body).toBeUndefined()
  })

  it('sends raw bytes through untouched, as audio would be', async () => {
    const handler: ApiHandler = async (_req, res) => {
      res.setHeader('Content-Type', 'audio/mpeg')
      res.status(200).send(Buffer.from([1, 2, 3]))
    }
    const out = await handleApiRequest(request(), async () => handler)
    expect(out.headers['Content-Type']).toBe('audio/mpeg')
    expect(Buffer.from(out.body as Buffer)).toEqual(Buffer.from([1, 2, 3]))
  })

  it('answers 400 in the API error shape when the body is not valid JSON, without calling the handler', async () => {
    const { handler } = recordingHandler()
    const spy = vi.fn(handler)
    const out = await handleApiRequest(request({ bodyText: '{not json' }), async () => spy)
    expect(out.status).toBe(400)
    expect(JSON.parse(String(out.body))).toEqual({ error: { kind: 'bad_request', message: 'The request body is not valid JSON.' } })
    expect(spy).not.toHaveBeenCalled()
  })

  it('answers 404 for a route that does not exist', async () => {
    const out = await handleApiRequest(request({ route: 'nope' }), async () => null)
    expect(out.status).toBe(404)
    expect(JSON.parse(String(out.body)).error.kind).toBe('unknown')
  })

  it.each(['../secret', 'a/b', '', 'Parse!', '.env'])('never loads a route named %j', async (route) => {
    const load = vi.fn(async () => null)
    const out = await handleApiRequest(request({ route }), load)
    expect(out.status).toBe(404)
    expect(load).not.toHaveBeenCalled()
  })

  it('answers 500 without a stack trace when the handler throws', async () => {
    const handler: ApiHandler = async () => {
      throw new Error('kaboom at /Users/someone/secret/path.ts:12')
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await handleApiRequest(request(), async () => handler)
    expect(out.status).toBe(500)
    const body = JSON.parse(String(out.body))
    expect(body.error.kind).toBe('unknown')
    expect(body.error.message).not.toContain('/Users')
  })

  it('answers 500 when the route cannot be loaded because it has an error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await handleApiRequest(request(), async () => {
      throw new SyntaxError('Unexpected token')
    })
    expect(out.status).toBe(500)
  })

  it('treats a handler that never answered as a 500', async () => {
    const handler: ApiHandler = async () => {}
    const out = await handleApiRequest(request(), async () => handler)
    expect(out.status).toBe(500)
  })
})

describe('syncEnvKeys', () => {
  const KEYS = ['GEMINI_API_KEY', 'ELEVENLABS_API_KEY']

  it('copies the keys in the file into the environment', () => {
    const target: Record<string, string | undefined> = {}
    syncEnvKeys(KEYS, { GEMINI_API_KEY: 'a' }, target, new Set())
    expect(target).toEqual({ GEMINI_API_KEY: 'a' })
  })

  it('replaces a key it set earlier when the file changes, as after a Vite restart', () => {
    const target: Record<string, string | undefined> = {}
    const setByUs = new Set<string>()
    syncEnvKeys(KEYS, { GEMINI_API_KEY: 'half-pasted' }, target, setByUs)
    syncEnvKeys(KEYS, { GEMINI_API_KEY: 'the-full-key' }, target, setByUs)
    expect(target.GEMINI_API_KEY).toBe('the-full-key')
  })

  it('drops a key it set once its line is removed from the file', () => {
    const target: Record<string, string | undefined> = {}
    const setByUs = new Set<string>()
    syncEnvKeys(KEYS, { GEMINI_API_KEY: 'a' }, target, setByUs)
    syncEnvKeys(KEYS, {}, target, setByUs)
    expect(target.GEMINI_API_KEY).toBeUndefined()
  })

  it('leaves a key exported in the shell alone', () => {
    const target: Record<string, string | undefined> = { GEMINI_API_KEY: 'from-the-shell' }
    syncEnvKeys(KEYS, { GEMINI_API_KEY: 'from-the-file' }, target, new Set())
    expect(target.GEMINI_API_KEY).toBe('from-the-shell')
  })
})
