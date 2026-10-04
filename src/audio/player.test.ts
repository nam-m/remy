import { describe, expect, it, vi, type Mock } from 'vitest'
import { FakeAudio, FakeObjectUrls, FakeSpeechSynthesis, FakeUtterance, voice } from '../test/fakes/audio.ts'
import { createBrowserSpeech, type SpeechEngine } from './browserSpeech.ts'
import { createClipCache } from './clipCache.ts'
import { createAudioPlayer } from './player.ts'
import { silentWavUrl } from './silence.ts'

const blob = (s: string) => new Blob([s], { type: 'audio/mpeg' })
const tick = () => new Promise((r) => setTimeout(r, 0))

function setup(speak: (text: string) => Promise<Blob> = async (text) => blob(text)) {
  const audio = new FakeAudio()
  const urls = new FakeObjectUrls()
  const cache = createClipCache(urls)
  const engine = new FakeSpeechSynthesis([voice('Samantha', 'en-US')])
  const speech = createBrowserSpeech({
    engine: engine as unknown as SpeechEngine,
    makeUtterance: (text) => new FakeUtterance(text) as unknown as SpeechSynthesisUtterance,
  })
  const speakSpy = vi.fn(speak)
  const created = vi.fn(() => audio)
  const player = createAudioPlayer({ speak: speakSpy, cache, speech, urls, createAudio: created, channel: null })
  const said = () => engine.spoken.filter((u) => u.volume > 0).map((u) => u.text)
  return { player, audio, urls, cache, engine, speak: speakSpy, created, said }
}

describe('silentWavUrl', () => {
  it('is a WAV data URL', () => {
    const url = silentWavUrl()
    expect(url.startsWith('data:audio/wav;base64,')).toBe(true)
    expect(atob(url.split(',')[1]).slice(0, 4)).toBe('RIFF')
  })
})

describe('AudioPlayer', () => {
  it('creates its <audio> element on first use only', async () => {
    const { player, created } = setup()
    expect(created).not.toHaveBeenCalled()
    player.preload('step-1', blob('1'))
    void player.play('step-1')
    void player.play('step-1')
    expect(created).toHaveBeenCalledTimes(1)
  })

  describe('unlock', () => {
    it('plays a silent clip and a silent utterance synchronously', async () => {
      const { player, audio, engine } = setup()
      const unlocked = player.unlock()
      expect(audio.plays).toEqual([silentWavUrl()])
      expect(engine.spoken).toHaveLength(1)
      expect(engine.spoken[0].volume).toBe(0)
      await unlocked
    })

    it('resolves even when the browser blocks it', async () => {
      const { player, audio } = setup()
      audio.failNextPlay('NotAllowedError')
      await expect(player.unlock()).resolves.toBeUndefined()
    })
  })

  describe('play', () => {
    it('plays a preloaded clip from the cache and resolves when it ends', async () => {
      const { player, audio, cache, speak } = setup()
      player.preload('step-2', blob('two'))
      let done = false
      const playing = player.play('step-2').then(() => (done = true))
      expect(audio.src).toBe(cache.get('step-2'))
      expect(audio.paused).toBe(false)
      await tick()
      expect(done).toBe(false)
      audio.finish()
      await playing
      expect(done).toBe(true)
      expect(speak).not.toHaveBeenCalled()
    })

    it('falls back to browser speech when the clip is missing', async () => {
      const { player, audio, engine, said } = setup()
      const playing = player.play('step-3@2', 'Step 3. Add half a cup of milk.')
      expect(audio.plays).toEqual([])
      expect(said()).toEqual(['Step 3. Add half a cup of milk.'])
      engine.finish()
      await playing
    })

    it('resolves silently when the clip is missing and there is no fallback text', async () => {
      const { player, said } = setup()
      await player.play('done')
      expect(said()).toEqual([])
    })

    it('falls back to browser speech when the clip cannot play', async () => {
      const { player, audio, engine, said } = setup()
      player.preload('looking', blob('x'))
      audio.failNextPlay('NotSupportedError')
      const playing = player.play('looking', 'Hold still, let me look.')
      await tick()
      expect(said()).toEqual(['Hold still, let me look.'])
      engine.finish()
      await playing
    })

    it('falls back to browser speech when the clip fails to load', async () => {
      const { player, audio, engine, said } = setup()
      player.preload('done', blob('x'))
      const playing = player.play('done', 'All done!')
      audio.breakSource()
      await tick()
      expect(said()).toEqual(['All done!'])
      engine.finish()
      await playing
    })
  })

  describe('one voice at a time', () => {
    it('a new clip stops the one playing', async () => {
      const { player, audio, cache } = setup()
      player.preload('step-1', blob('1'))
      player.preload('step-2', blob('2'))
      const first = player.play('step-1')
      const second = player.play('step-2')
      await expect(first).resolves.toBeUndefined()
      expect(audio.src).toBe(cache.get('step-2'))
      expect(audio.paused).toBe(false)
      audio.finish()
      await second
    })

    it('a clip stops browser speech', async () => {
      const { player, engine } = setup()
      const speaking = player.play('missing', 'fallback')
      player.preload('step-1', blob('1'))
      void player.play('step-1')
      await expect(speaking).resolves.toBeUndefined()
      expect(engine.pending).toBe(0)
    })

    it('a stopped clip does not fall back to speech when its play() is aborted', async () => {
      const { player, audio, said } = setup()
      player.preload('step-1', blob('1'))
      audio.failNextPlay('AbortError')
      const playing = player.play('step-1', 'fallback')
      player.stop()
      await playing
      await tick()
      expect(said()).toEqual([])
    })
  })

  describe('stop', () => {
    it('stops the clip and browser speech and resolves pending plays', async () => {
      const { player, audio, engine } = setup()
      player.preload('step-1', blob('1'))
      const clip = player.play('step-1')
      player.stop()
      await expect(clip).resolves.toBeUndefined()
      expect(audio.paused).toBe(true)
      expect(engine.cancelCount).toBeGreaterThan(0)
    })

    it('is safe before anything has played', () => {
      const { player, created } = setup()
      expect(() => player.stop()).not.toThrow()
      expect(created).not.toHaveBeenCalled()
    })
  })

  describe('playBlob', () => {
    it('plays the blob through a temporary URL and revokes it after', async () => {
      const { player, audio, urls } = setup()
      const verdict = blob('verdict')
      const playing = player.playBlob(verdict)
      expect(urls.blobs.get(audio.src)).toBe(verdict)
      const url = audio.src
      audio.finish()
      await playing
      expect(urls.revoked).toContain(url)
      expect(urls.live.size).toBe(0)
    })

    it('revokes the URL when stopped', async () => {
      const { player, urls } = setup()
      const playing = player.playBlob(blob('v'))
      player.stop()
      await playing
      expect(urls.live.size).toBe(0)
    })
  })

  describe('speakLive', () => {
    it('fetches speech and plays it', async () => {
      const { player, audio, urls, speak, said } = setup()
      const speaking = player.speakLive('Smooth batter, moving on.')
      expect(speak).toHaveBeenCalledWith('Smooth batter, moving on.')
      await tick()
      expect(audio.paused).toBe(false)
      expect(await urls.blobs.get(audio.src)?.text()).toBe('Smooth batter, moving on.')
      audio.finish()
      await speaking
      expect(said()).toEqual([])
    })

    it('falls back to browser speech when the request fails', async () => {
      const { player, audio, engine, said } = setup(() => Promise.reject(new Error('upstream')))
      const speaking = player.speakLive('A few lumps left, whisk 20 more seconds.')
      await tick()
      expect(audio.plays).toEqual([])
      expect(said()).toEqual(['A few lumps left, whisk 20 more seconds.'])
      engine.finish()
      await speaking
    })

    it('falls back to browser speech when the audio cannot play', async () => {
      const { player, audio, engine, said } = setup()
      audio.failNextPlay('NotSupportedError')
      const speaking = player.speakLive('Not sure, try again.')
      await tick()
      expect(said()).toEqual(['Not sure, try again.'])
      engine.finish()
      await speaking
    })

    it('stops what was playing before it fetches', () => {
      const { player, audio } = setup()
      player.preload('looking', blob('l'))
      void player.play('looking')
      void player.speakLive('verdict')
      expect(audio.paused).toBe(true)
    })

    it('does not play a verdict that arrives after stop', async () => {
      let resolve!: (b: Blob) => void
      const { player, audio, said } = setup(() => new Promise<Blob>((r) => (resolve = r)))
      const speaking = player.speakLive('late verdict')
      player.stop() // the cook moved on
      resolve(blob('late verdict'))
      await speaking
      expect(audio.plays).toEqual([])
      expect(said()).toEqual([])
    })

    it('does not fall back to speech for a request that fails after stop', async () => {
      let reject!: (e: Error) => void
      const { player, said } = setup(() => new Promise<Blob>((_, r) => (reject = r)))
      const speaking = player.speakLive('late verdict')
      player.stop()
      reject(new Error('timeout'))
      await speaking
      expect(said()).toEqual([])
    })

    it('a step clip played meanwhile wins over a pending verdict', async () => {
      let resolve!: (b: Blob) => void
      const { player, audio, cache } = setup(() => new Promise<Blob>((r) => (resolve = r)))
      player.preload('step-4', blob('4'))
      const speaking = player.speakLive('verdict')
      void player.play('step-4')
      resolve(blob('verdict'))
      await speaking
      expect(audio.src).toBe(cache.get('step-4'))
      expect(audio.plays).toHaveLength(1)
    })
  })
})

describe('one voice across pages', () => {
  /** Two pages of the app, wired so each hears the other's "I started talking" message. */
  function twoPages() {
    const listeners: Array<{ owner: number; fn: (e: { data: unknown }) => void }> = []
    const channelFor = (owner: number) => ({
      postMessage: (data: unknown) => listeners.filter((l) => l.owner !== owner).forEach((l) => l.fn({ data })),
      addEventListener: (_: 'message', fn: (e: { data: unknown }) => void) => void listeners.push({ owner, fn }),
    })
    const make = (owner: number, id: string, clock: { t: number }) => {
      const audio = new FakeAudio()
      const urls = new FakeObjectUrls()
      const cache = createClipCache(urls)
      const speech = createBrowserSpeech({ engine: new FakeSpeechSynthesis([voice('Samantha', 'en-US')]) as unknown as SpeechEngine, makeUtterance: (t) => new FakeUtterance(t) as unknown as SpeechSynthesisUtterance })
      const player = createAudioPlayer({ speak: async (t) => blob(t), cache, speech, urls, createAudio: () => audio, channel: channelFor(owner), pageId: id, now: () => clock.t })
      return { player, audio, cache }
    }
    return { make }
  }

  it('stops this page when another page starts talking after it', async () => {
    const clock = { t: 100 }
    const { make } = twoPages()
    const a = make(1, 'a', clock)
    const b = make(2, 'b', clock)
    a.player.preload('x', blob('x'))
    b.player.preload('y', blob('y'))

    void a.player.play('x')
    await tick()
    expect(a.audio.paused).toBe(false)

    clock.t = 150
    void b.player.play('y')
    await tick()
    expect(a.audio.paused).toBe(true) // the earlier voice is cut
    expect(b.audio.paused).toBe(false) // the newer one plays
  })

  it('leaves the newer page alone when an older page speaks first', async () => {
    const { make } = twoPages()
    const a = make(1, 'a', { t: 100 })
    const b = make(2, 'b', { t: 200 })
    a.player.preload('x', blob('x'))
    b.player.preload('y', blob('y'))

    void b.player.play('y')
    await tick()
    void a.player.play('x') // a started earlier than b, by the clocks, so b keeps talking
    await tick()
    expect(b.audio.paused).toBe(false)
  })
})

describe('one <audio> per page', () => {
  it('shares one element between players, so a second player cuts the first instead of playing over it', async () => {
    // jsdom has no playback, so the test setup stubs play(); note which element each call is on.
    const seen: unknown[] = []
    const stub = HTMLMediaElement.prototype.play as unknown as Mock
    for (let i = 0; i < 2; i++) {
      stub.mockImplementationOnce(function (this: HTMLMediaElement) {
        seen.push(this)
        return Promise.resolve()
      })
    }
    const make = () => createAudioPlayer({ speak: async (t) => blob(t), cache: createClipCache(new FakeObjectUrls()), channel: null })
    await make().unlock()
    await make().unlock()
    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(seen[1])
  })
})
