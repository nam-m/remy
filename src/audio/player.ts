// Plays Remy's voice: cached step clips, live verdict speech, and the browser-speech
// fallback. One voice at a time: every play first stops whatever is playing.

import { createBrowserSpeech, type BrowserSpeech } from './browserSpeech.ts'
import { silentWavUrl } from './silence.ts'
import { clipCache, type ClipCache, type ObjectUrls } from './clipCache.ts'

export interface AudioPlayer {
  unlock(): Promise<void> // call from the Start button click
  preload(id: string, blob: Blob): void
  play(id: string, fallbackText?: string): Promise<void> // cached clip, or browser speech if missing
  playBlob(blob: Blob): Promise<void>
  speakLive(text: string): Promise<void> // api.speak → playBlob; on failure, browser speech
  stop(): void // stops both <audio> and speechSynthesis
}

/** The parts of an `<audio>` element the player uses. */
export interface AudioElement {
  src: string
  play(): Promise<void>
  pause(): void
  addEventListener(type: 'ended' | 'error', listener: () => void): void
  removeEventListener(type: 'ended' | 'error', listener: () => void): void
}

export interface AudioPlayerDeps {
  /** Text → speech audio, e.g. the API client's `speak`. Injected so audio doesn't depend on it. */
  speak(text: string): Promise<Blob>
  cache?: ClipCache
  speech?: BrowserSpeech
  /** Defaults to one <audio> for the whole page, shared by every player (see pageAudio). */
  createAudio?: () => AudioElement
  urls?: ObjectUrls
  /** How this page tells other open pages of the app it started talking. Defaults to a BroadcastChannel. */
  channel?: VoiceChannel | null
  /** Milliseconds; the later page to start talking wins. */
  now?: () => number
  pageId?: string
}

/** The parts of a BroadcastChannel the player uses. */
export interface VoiceChannel {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
}

/**
 * One <audio> for the whole page, kept on globalThis. A second player (a hot reload, a duplicate
 * provider) then plays on the same element, so starting a clip replaces whatever the first one was
 * saying instead of playing over it.
 */
const PAGE_AUDIO = Symbol.for('remy.pageAudio')
function pageAudio(): AudioElement {
  const page = globalThis as unknown as Record<symbol, AudioElement | undefined>
  return (page[PAGE_AUDIO] ??= new Audio())
}

type Outcome = 'ended' | 'failed' | 'stopped'

export function createAudioPlayer(deps: AudioPlayerDeps): AudioPlayer {
  const cache = deps.cache ?? clipCache
  const speech = deps.speech ?? createBrowserSpeech()
  const urls = deps.urls ?? URL
  const createAudio = deps.createAudio ?? pageAudio

  // One element for everything, created on first use. Reusing it matters on Safari,
  // where the autoplay unlock applies to the element that played inside the click.
  let element: AudioElement | null = null
  const audio = () => (element ??= createAudio())

  // Bumped by every stop(). A playback whose token is stale was cut off and must not
  // fall back to speech or start late (e.g. a verdict arriving after the cook moved on).
  let token = 0
  let finishCurrent: ((o: Outcome) => void) | null = null

  const stop = () => {
    token++
    const finish = finishCurrent
    finishCurrent = null
    finish?.('stopped')
    element?.pause()
    speech.cancel()
  }

  // Another open page of the app (a second tab) must not talk over this one: whichever page started
  // talking last wins, and the other stops. Ties go to the larger page id.
  const pageId = deps.pageId ?? Math.random().toString(36).slice(2)
  const now = deps.now ?? Date.now
  const channel = deps.channel !== undefined ? deps.channel : typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('remy-voice')
  let startedAt = 0
  channel?.addEventListener('message', ({ data }) => {
    const other = data as { id?: unknown; t?: unknown } | null
    if (typeof other?.id !== 'string' || typeof other.t !== 'number' || other.id === pageId) return
    if (other.t > startedAt || (other.t === startedAt && other.id > pageId)) stop()
  })

  /** Every new voice starts here: cut whatever was playing, here and on other pages. */
  const begin = () => {
    stop()
    startedAt = now()
    channel?.postMessage({ id: pageId, t: startedAt })
    return token
  }

  const isCurrent = (t: number) => t === token

  const playUrl = (url: string, t: number) =>
    new Promise<Outcome>((resolve) => {
      const el = audio()
      const finish = (outcome: Outcome) => {
        el.removeEventListener('ended', onEnded)
        el.removeEventListener('error', onError)
        if (finishCurrent === finish) finishCurrent = null
        resolve(outcome)
      }
      const onEnded = () => finish('ended')
      const onError = () => finish('failed')
      finishCurrent = finish
      el.addEventListener('ended', onEnded)
      el.addEventListener('error', onError)
      el.src = url
      el.play().catch(() => finish(isCurrent(t) ? 'failed' : 'stopped'))
    })

  const playBlobAs = async (blob: Blob, t: number) => {
    const url = urls.createObjectURL(blob)
    try {
      return await playUrl(url, t)
    } finally {
      urls.revokeObjectURL(url)
    }
  }

  const sayIfCurrent = (text: string | undefined, t: number) =>
    text && isCurrent(t) ? speech.say(text) : Promise.resolve()

  return {
    unlock() {
      // Both plays must start synchronously inside the click handler.
      speech.unlock()
      const el = audio()
      el.src = silentWavUrl()
      return el.play().catch(() => {})
    },

    preload(id, blob) {
      cache.put(id, blob)
    },

    async play(id, fallbackText) {
      const t = begin()
      const url = cache.get(id)
      if (!url) return sayIfCurrent(fallbackText, t)
      const outcome = await playUrl(url, t)
      if (outcome === 'failed') await sayIfCurrent(fallbackText, t)
    },

    async playBlob(blob) {
      await playBlobAs(blob, begin())
    },

    async speakLive(text) {
      const t = begin()
      let blob: Blob
      try {
        blob = await deps.speak(text)
      } catch {
        return sayIfCurrent(text, t)
      }
      if (!isCurrent(t)) return
      const outcome = await playBlobAs(blob, t)
      if (outcome === 'failed') await sayIfCurrent(text, t)
    },

    stop,
  }
}
