// A Vite plugin that serves the functions in api/ while `npm run dev` runs, so the
// app can talk to the real backend locally with no Vercel account or CLI.
// Keys come from env/.env.local and stay in the dev server's process: Vite only
// sends VITE_-prefixed variables to the browser, and these have no such prefix.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv, type Plugin } from 'vite'
import { handleApiRequest, syncEnvKeys, type ApiHandler } from './devApiCore.ts'

const KEYS = ['GEMINI_API_KEY', 'ELEVENLABS_API_KEY']
const MAX_BODY_BYTES = 2 * 1024 * 1024

/** The keys this plugin has put in process.env, so a restart can replace them (see syncEnvKeys). */
const setByUs = new Set<string>()

export function devApi(): Plugin {
  return {
    name: 'remy-dev-api',
    apply: 'serve',

    config(_config, { mode }) {
      syncEnvKeys(KEYS, loadEnv(mode, join(process.cwd(), 'env'), ''), process.env, setByUs)
    },

    configureServer(server) {
      if (server.config.env.VITE_MOCK_API === '1') {
        server.config.logger.warn(
          '\n  VITE_MOCK_API=1: the app uses the stand-in backend and never calls /api.\n  Clear it in env/.env.local to use the real one.\n',
        )
      }
      if (!process.env.GEMINI_API_KEY) {
        server.config.logger.warn(
          '\n  /api/parse and /api/check will fail: GEMINI_API_KEY is not set.\n  Add it to env/.env.local and restart the dev server.\n',
        )
      }

      server.middlewares.use('/api', async (req, res) => {
        const started = Date.now()
        const route = (req.url ?? '').split('?')[0].replace(/^\//, '')

        const chunks: Buffer[] = []
        let size = 0
        for await (const chunk of req) {
          size += (chunk as Buffer).length
          if (size > MAX_BODY_BYTES) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: { kind: 'bad_request', message: 'The request body is too large.' } }))
            return
          }
          chunks.push(chunk as Buffer)
        }

        const reply = await handleApiRequest(
          { route, method: req.method ?? 'GET', headers: req.headers, bodyText: Buffer.concat(chunks).toString('utf8') },
          async (name) => {
            if (!existsSync(join(server.config.root, 'api', `${name}.ts`))) return null
            const module = await server.ssrLoadModule(`/api/${name}.ts`)
            return module.default as ApiHandler
          },
        )

        res.statusCode = reply.status
        for (const [name, value] of Object.entries(reply.headers)) res.setHeader(name, value)
        res.end(reply.body)
        server.config.logger.info(`  ${req.method} /api/${route} ${reply.status} ${Date.now() - started}ms`)
      })
    },
  }
}
