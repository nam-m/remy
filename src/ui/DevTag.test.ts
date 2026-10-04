import { describe, expect, it } from 'vitest'
import { describeSetup } from './DevTag.tsx'

const live = { mock: false, anyCam: false, status: 'live', error: null } as const

describe('describeSetup', () => {
  it('names the real backend and a live hat cam as fine', () => {
    expect(describeSetup(live)).toEqual({
      backend: { text: 'Real backend', ok: true },
      camera: { text: 'Hat cam: live', ok: true },
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
})
