import { describe, expect, it } from 'vitest'
import { C270, C920, FakeMediaDevices, IPHONE, MACBOOK } from '../test/fakes/media.ts'
import { CameraError, openHatCam } from './openHatCam.ts'

const asMedia = (fake: FakeMediaDevices) => fake as unknown as MediaDevices

describe('openHatCam', () => {
  it('asks for permission once when labels are hidden, then opens the C270 by exact id', async () => {
    const media = new FakeMediaDevices([MACBOOK, C270, IPHONE])
    const { stream, label } = await openHatCam(asMedia(media))

    expect(label).toBe(C270.label)
    expect(stream.getVideoTracks()[0].label).toBe(C270.label)
    expect(media.calls).toHaveLength(2)
    expect(media.calls[1].video).toMatchObject({ deviceId: { exact: 'c270' } })
  })

  it('opens the C920 by exact id too', async () => {
    const media = new FakeMediaDevices([MACBOOK, C920, IPHONE])
    const { stream, label } = await openHatCam(asMedia(media))
    expect(label).toBe(C920.label)
    expect(stream.getVideoTracks()[0].label).toBe(C920.label)
    expect(media.calls.at(-1)?.video).toMatchObject({ deviceId: { exact: 'c920' } })
  })

  it('stops the permission stream so the default camera is not left open', async () => {
    const media = new FakeMediaDevices([MACBOOK, C270])
    const opened: MediaStreamTrack[] = []
    const getUserMedia = media.getUserMedia.bind(media)
    media.getUserMedia = async (c) => {
      const s = await getUserMedia(c)
      opened.push(s.getVideoTracks()[0])
      return s
    }
    await openHatCam(asMedia(media))
    expect(opened[0].readyState).toBe('ended')
    expect(opened[1].readyState).toBe('live')
  })

  it('gets permission from another camera when the default one cannot be opened', async () => {
    const media = new FakeMediaDevices([IPHONE, C270])
    media.failNext('NotReadableError')
    const { label } = await openHatCam(asMedia(media))
    expect(label).toBe(C270.label)
  })

  it('reports the default camera\'s error when no camera can give permission', async () => {
    const media = new FakeMediaDevices([MACBOOK])
    media.getUserMedia = async () => {
      throw new DOMException('NotReadableError', 'NotReadableError')
    }
    await expect(openHatCam(asMedia(media))).rejects.toMatchObject({ kind: 'busy' })
  })

  it('does not try other cameras once permission is refused', async () => {
    const media = new FakeMediaDevices([MACBOOK, C270])
    media.failNext('NotAllowedError')
    await expect(openHatCam(asMedia(media))).rejects.toMatchObject({ kind: 'denied' })
    expect(media.calls).toHaveLength(1)
  })

  it('skips the permission step when labels are already visible', async () => {
    const media = new FakeMediaDevices([MACBOOK, C270])
    media.permissionGranted = true
    await openHatCam(asMedia(media))
    expect(media.calls).toHaveLength(1)
  })

  it('asks for 1280x720 at 30 fps as ideal values, not exact ones', async () => {
    const media = new FakeMediaDevices([C270])
    media.permissionGranted = true
    await openHatCam(asMedia(media))
    expect(media.calls[0]).toMatchObject({
      audio: false,
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    })
  })

  it('fails with not_found when only the MacBook and iPhone cameras exist', async () => {
    const media = new FakeMediaDevices([MACBOOK, IPHONE])
    await expect(openHatCam(asMedia(media))).rejects.toMatchObject({ kind: 'not_found' })
  })

  it('fails with not_found when there is no camera at all', async () => {
    const media = new FakeMediaDevices([])
    await expect(openHatCam(asMedia(media))).rejects.toMatchObject({ kind: 'not_found' })
  })

  it.each([
    ['NotAllowedError', 'denied'],
    ['NotReadableError', 'busy'],
    ['NotFoundError', 'not_found'],
    ['OverconstrainedError', 'unknown'],
  ] as const)('maps %s to %s', async (name, kind) => {
    const media = new FakeMediaDevices([C270])
    media.permissionGranted = true
    media.failNext(name)
    const error = await openHatCam(asMedia(media)).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CameraError)
    expect(error).toMatchObject({ kind })
  })

  it('maps a denied permission prompt to denied', async () => {
    const media = new FakeMediaDevices([C270])
    media.failNext('NotAllowedError')
    await expect(openHatCam(asMedia(media))).rejects.toMatchObject({ kind: 'denied' })
  })
})
