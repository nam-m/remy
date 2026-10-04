# env/

Put your API keys here. Nothing in this folder is committed except this file and `.env.example`.

1. Copy the example: `cp env/.env.example env/.env.local`
2. Fill in `GEMINI_API_KEY` (needed for `/api/parse` and `/api/check`) and, when you want Remy's real voice, `ELEVENLABS_API_KEY`.
3. Restart `npm run dev`. Vite reads this folder (`envDir` in `vite.config.ts`), and `scripts/devApi.ts` passes the keys to the local API; they never reach the browser.

Set `VITE_MOCK_API=1` to run against the stand-in backend with no keys.

On Vercel, set the same names in the project's environment variables instead.

## Checking what the app is using

`npm run dev` shows a small tag at the top of the page:

- **Stand-in backend** means no `/api` call is made: `VITE_MOCK_API=1` is set here, or the URL has `?mock`. Remove the flag (and `?mock`) to use the real backend.
- **Hat cam: Logitech not found** means the app only opens the Logitech cam. To use this laptop's camera, open the page with `?cam=any`.
- The terminal prints `POST /api/parse 200` for each real backend call, so no such line means the backend isn't being reached.

Saving this folder's files restarts the dev server for you. If something looks stale, stop every `npm run dev` / `npm run prototype` and start one.
