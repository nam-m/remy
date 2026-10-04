// Runs one of the Vercel-style functions in api/ for a request, the way Vercel
// would, but inside the dev server. The functions get a request with the
// method, lower-case headers and the parsed JSON body, and a response with
// status(), json(), send() and setHeader(). Everything that can go wrong comes
// back as an error in the API's own shape, never a stack trace.

export interface DevRequest {
  method?: string
  headers: Record<string, string>
  body?: unknown
}

export interface DevResponse {
  setHeader(name: string, value: string): DevResponse
  status(code: number): DevResponse
  json(body: unknown): DevResponse
  send(body: unknown): DevResponse
}

export type ApiHandler = (req: DevRequest, res: DevResponse) => Promise<void>

export interface ApiRequest {
  /** The route name, e.g. "parse" for /api/parse. */
  route: string
  method: string
  headers: Record<string, string | string[] | undefined>
  bodyText: string
}

export interface ApiReply {
  status: number
  headers: Record<string, string>
  body: string | Buffer
}

const ROUTE = /^[a-z][a-z0-9-]*$/

const failure = (status: number, kind: string, message: string): ApiReply => ({
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify({ error: { kind, message } }),
})

/** `load` finds the handler for a route, or null if there is none. */
export async function handleApiRequest(
  { route, method, headers, bodyText }: ApiRequest,
  load: (route: string) => Promise<ApiHandler | null>,
): Promise<ApiReply> {
  // Only plain route names: nothing that could reach outside api/.
  if (!ROUTE.test(route)) return failure(404, 'unknown', 'Not found.')

  let handler: ApiHandler | null
  try {
    handler = await load(route)
  } catch (error) {
    console.error(`[api] could not load /api/${route}:`, error)
    return failure(500, 'unknown', `Could not load /api/${route}. See the dev server console.`)
  }
  if (!handler) return failure(404, 'unknown', 'Not found.')

  let body: unknown
  if (bodyText !== '') {
    try {
      body = JSON.parse(bodyText)
    } catch {
      return failure(400, 'bad_request', 'The request body is not valid JSON.')
    }
  }

  const lowered: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) lowered[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value
  }

  const reply: ApiReply = { status: 0, headers: {}, body: '' }
  const res: DevResponse = {
    setHeader(name, value) {
      reply.headers[name] = value
      return res
    },
    status(code) {
      reply.status = code
      return res
    },
    json(value) {
      if (!Object.keys(reply.headers).some((h) => h.toLowerCase() === 'content-type')) {
        reply.headers['Content-Type'] = 'application/json'
      }
      reply.body = JSON.stringify(value)
      return res
    },
    send(value) {
      reply.body = value as string | Buffer
      return res
    },
  }

  try {
    await handler({ method, headers: lowered, body }, res)
  } catch (error) {
    console.error(`[api] /api/${route} threw:`, error)
    return failure(500, 'unknown', 'Something went wrong.')
  }

  if (reply.status === 0) return failure(500, 'unknown', `/api/${route} did not answer.`)
  return reply
}

/**
 * Copies API keys from the env file into the process environment. Vite restarts the dev server inside
 * the same process whenever the env file changes, so a key this function set earlier has to be replaced
 * by the new value, or dropped when its line is removed; otherwise the first value saved sticks until
 * the whole process is restarted. A key exported in the shell, which this function never set, still
 * wins over the file.
 */
export function syncEnvKeys(
  keys: readonly string[],
  file: Record<string, string>,
  target: Record<string, string | undefined>,
  setByUs: Set<string>,
): void {
  for (const key of keys) {
    if (target[key] && !setByUs.has(key)) continue
    if (file[key]) {
      target[key] = file[key]
      setByUs.add(key)
    } else if (setByUs.has(key)) {
      delete target[key]
      setByUs.delete(key)
    }
  }
}
