import { describe, expect, it } from 'vitest'
import { describeSetup } from './DevTag.tsx'

const ready = { status: 'ready', error: null, handVisible: false } as const
const live = { mock: false, anyCam: false, status: 'live', error: null, cooking: true, gestures: ready } as const

describe('describeSetup', () => {
  it('names the real backend and a live hat cam as fine', () => {
    expect(describeSetup(live)).toEqual({
      backend: { text: 'Real backend', ok: true },
      camera: { text: 'Hat cam: live', ok: true },
      gestures: { text: 'Gestures: ready, no hand in view', ok: true },
    })
  })

  it('flags the stand-in backend, so it is never mistaken for the real one', () => {
    expect(describeSetup({ ...live, mock: true }).backend).toEqual({ text: 'Stand-in backend', ok: false })
  })

  it('says how to use the laptop camera when the Logitech is not found', () => {
    const { camera } = describeSetup({ ...live, status: 'error', error: 'not_found' })
    expect(camera.ok).toBe(false)
    expect(camera.text).toContain('?cam=any')
  })

  it('names the laptop camera when ?cam=any is on', () => {
    expect(describeSetup({ ...live, anyCam: true }).camera.text).toBe('Laptop camera: live')
  })

  it('says whether a hand is seen, so a palm that does not register can be told from a camera that is blank', () => {
    expect(describeSetup({ ...live, gestures: { ...ready, handVisible: true } }).gestures.text).toBe('Gestures: hand seen')
  })

  it('flags a hand model that failed to load, with the reason', () => {
    const { gestures } = describeSetup({ ...live, gestures: { status: 'error', error: 'model missing', handVisible: false } })
    expect(gestures).toEqual({ text: 'Gestures: failed (model missing)', ok: false })
  })

  it('does not call gestures broken before the cooking screen, where they are not running', () => {
    const { gestures } = describeSetup({ ...live, cooking: false, gestures: { status: 'loading', error: null, handVisible: false } })
    expect(gestures.ok).toBe(true)
  })
})
