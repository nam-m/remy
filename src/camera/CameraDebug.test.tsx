import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { C270, IPHONE, MACBOOK, installFakeMediaDevices } from '../test/fakes/media.ts'
import CameraDebug from './CameraDebug.tsx'
import { GrabError, type GrabResult } from './grabSharpestFrame.ts'
import type { Detection, Recognizer } from './recognizer.ts'
import type { DetectionDeps } from './useDetection.ts'

afterEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
})

const hand = Array.from({ length: 21 }, (_, i) => ({ x: 0.2 + i * 0.02, y: 0.3 + i * 0.01 }))
const thumbsUp: Detection = { label: 'Thumb_Up', score: 0.93, handPresent: true, landmarks: hand }
const thumbsDown: Detection = { label: 'Thumb_Down', score: 0.9, handPresent: true, landmarks: hand }
const none: Detection = { label: 'None', score: 0, handPresent: false, landmarks: null }

/** Fake MediaPipe + frame loop: tests push detections one frame at a time. */
function fakeDetection() {
  let current: Detection = none
  let frame: (t: number) => void = () => {}
  const recognizer: Recognizer = { recognize: () => current, close: vi.fn() }
  const deps: DetectionDeps = {
    createRecognizer: vi.fn(async () => recognizer),
    startLoop: (_video, onFrame) => {
      frame = onFrame
      return () => {}
    },
  }
  return {
    deps,
    show: (d: Detection, t = performance.now()) => {
      current = d
      act(() => frame(t))
    },
    /** One frame every 67 ms (about 15 per second) of the same reading, from t0 to t1. */
    holdFor: (d: Detection, t0: number, t1: number) => {
      current = d
      for (let t = t0; t <= t1; t += 67) act(() => frame(t))
    },
  }
}

describe('CameraDebug', () => {
  it('shows the live hat cam with its label and resolution', async () => {
    installFakeMediaDevices([MACBOOK, C270, IPHONE])
    render(<CameraDebug detectionDeps={fakeDetection().deps} />)

    expect(await screen.findByText('live')).toBeInTheDocument()
    expect(screen.getByText(C270.label)).toBeInTheDocument()
    expect(screen.getByText('1280 × 720')).toBeInTheDocument()
    expect(screen.getByTestId('preview')).toBeInTheDocument()
  })

  it('explains what to do when the hat cam is missing', async () => {
    installFakeMediaDevices([MACBOOK, IPHONE])
    render(<CameraDebug detectionDeps={fakeDetection().deps} />)

    expect(await screen.findByText(/Hat cam not found/)).toBeInTheDocument()
    expect(screen.getByText('reconnecting')).toBeInTheDocument()
  })

  it('connects by itself when the hat cam is plugged in later', async () => {
    const media = installFakeMediaDevices([MACBOOK, IPHONE])
    render(<CameraDebug detectionDeps={fakeDetection().deps} />)
    await screen.findByText(/Hat cam not found/)

    act(() => media.plug(C270))
    expect(await screen.findByText('live')).toBeInTheDocument()
    expect(screen.queryByText(/Hat cam not found/)).not.toBeInTheDocument()
  })

  it('shows whether the screen is being kept awake', async () => {
    const lock = Object.assign(new EventTarget(), { release: async () => {} })
    Object.defineProperty(navigator, 'wakeLock', { value: { request: async () => lock }, configurable: true })
    installFakeMediaDevices([C270])
    render(<CameraDebug detectionDeps={fakeDetection().deps} />)
    await screen.findByText('live')
    await waitFor(() => expect(screen.getByTestId('awake')).toHaveTextContent('yes'))
    delete (navigator as { wakeLock?: unknown }).wakeLock
  })

  it('says so when the browser cannot keep the screen awake', async () => {
    installFakeMediaDevices([C270])
    render(<CameraDebug detectionDeps={fakeDetection().deps} />)
    await screen.findByText('live')
    expect(screen.getByTestId('awake')).toHaveTextContent('not supported')
  })

  it('counts reconnects when the cable is pulled and put back', async () => {
    const media = installFakeMediaDevices([C270])
    render(<CameraDebug detectionDeps={fakeDetection().deps} />)
    await screen.findByText('live')
    expect(screen.getByTestId('reconnects')).toHaveTextContent('0')

    act(() => media.unplug('c270'))
    expect(await screen.findByText('reconnecting')).toBeInTheDocument()
    expect(screen.getByText(/Hat cam disconnected/)).toBeInTheDocument()

    act(() => media.plug(C270))
    expect(await screen.findByText('live')).toBeInTheDocument()
    expect(screen.getByTestId('reconnects')).toHaveTextContent('1')
  })

  it('does not start detection until the camera is live', async () => {
    installFakeMediaDevices([MACBOOK, IPHONE])
    const fake = fakeDetection()
    render(<CameraDebug detectionDeps={fake.deps} />)
    await screen.findByText(/Hat cam not found/)
    expect(fake.deps.createRecognizer).not.toHaveBeenCalled()
  })

  describe('detection panel', () => {
    async function liveWithDetection() {
      installFakeMediaDevices([C270])
      const fake = fakeDetection()
      render(<CameraDebug detectionDeps={fake.deps} />)
      await screen.findByText('Detection: ready')
      return fake
    }

    it('shows the gesture, its score and whether a hand is visible', async () => {
      const fake = await liveWithDetection()
      expect(screen.getByTestId('gesture')).toHaveTextContent('No hand')

      fake.show(thumbsUp)
      expect(screen.getByTestId('gesture')).toHaveTextContent('Thumb_Up')
      expect(screen.getByTestId('score')).toHaveTextContent('0.93')
      expect(screen.getByTestId('hand')).toHaveTextContent('yes')
    })

    it('draws the 21 hand landmarks over the preview, and none without a hand', async () => {
      const fake = await liveWithDetection()
      expect(screen.queryAllByTestId('landmark')).toHaveLength(0)

      fake.show(thumbsUp)
      expect(screen.getAllByTestId('landmark')).toHaveLength(21)

      fake.show(none)
      expect(screen.queryAllByTestId('landmark')).toHaveLength(0)
    })

    it('counts gesture attempts and can reset them', async () => {
      const fake = await liveWithDetection()
      fake.show(thumbsUp)
      fake.show(thumbsUp)
      fake.show(none)
      fake.show(thumbsUp)

      const row = screen.getByTestId('tally-Thumb_Up')
      expect(within(row).getByText('2')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Reset counts' }))
      expect(screen.getByTestId('tally-Thumb_Up')).toHaveTextContent('0')
    })

    it('always lists the three control gestures, even before any hit', async () => {
      await liveWithDetection()
      for (const label of ['Thumb_Up', 'Thumb_Down', 'Open_Palm']) {
        expect(screen.getByTestId(`tally-${label}`)).toHaveTextContent('0')
      }
    })

    it('shows an error when the recognizer fails to load', async () => {
      installFakeMediaDevices([C270])
      const fake = fakeDetection()
      fake.deps.createRecognizer = vi.fn(async () => {
        throw new Error('model missing')
      })
      render(<CameraDebug detectionDeps={fake.deps} />)
      expect(await screen.findByText(/model missing/)).toBeInTheDocument()
      expect(screen.getByText('Detection: error')).toBeInTheDocument()
    })
  })
})

describe('CameraDebug grab panel', () => {
  const grabResult = (bytes = 112 * 1024): GrabResult => ({
    blob: new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }),
    width: 768,
    height: 432,
    scores: [10.5, 40.25, 22, 120.75, 30, 5],
    chosen: 3,
  })

  async function liveWith(grab: () => Promise<GrabResult>) {
    installFakeMediaDevices([C270])
    URL.createObjectURL = vi.fn(() => 'blob:grabbed')
    URL.revokeObjectURL = vi.fn()
    render(<CameraDebug detectionDeps={fakeDetection().deps} grab={grab} />)
    await screen.findByText('live')
  }

  it('has a Grab button that is disabled until the camera is live', async () => {
    installFakeMediaDevices([MACBOOK, IPHONE])
    render(<CameraDebug detectionDeps={fakeDetection().deps} grab={async () => grabResult()} />)
    await screen.findByText(/Hat cam not found/)
    expect(screen.getByRole('button', { name: 'Grab frame' })).toBeDisabled()
  })

  it('shows the grabbed image with its size, dimensions and sharpness scores', async () => {
    await liveWith(async () => grabResult())
    fireEvent.click(screen.getByRole('button', { name: 'Grab frame' }))

    const image = await screen.findByAltText('Grabbed frame')
    expect(image).toHaveAttribute('src', 'blob:grabbed')
    expect(screen.getByTestId('grab-size')).toHaveTextContent('112 KB')
    expect(screen.getByTestId('grab-dimensions')).toHaveTextContent('768 × 432')
    expect(screen.getAllByTestId(/^grab-score-\d+$/)).toHaveLength(6)
    expect(screen.getByTestId('grab-score-3')).toHaveTextContent('120.8')
    expect(screen.getByTestId('grab-score-3')).toHaveTextContent('chosen')
    expect(screen.getByTestId('grab-score-0')).not.toHaveTextContent('chosen')
  })

  it('shows Grabbing and disables the button while the capture runs', async () => {
    let finish: (r: GrabResult) => void = () => {}
    await liveWith(() => new Promise<GrabResult>((resolve) => (finish = resolve)))
    fireEvent.click(screen.getByRole('button', { name: 'Grab frame' }))

    expect(await screen.findByRole('button', { name: 'Grabbing...' })).toBeDisabled()
    await act(async () => finish(grabResult()))
    expect(screen.getByRole('button', { name: 'Grab frame' })).toBeEnabled()
  })

  it('shows a message when the camera is not available, and lets you try again', async () => {
    await liveWith(async () => {
      throw new GrabError('camera_unavailable')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Grab frame' }))

    expect(await screen.findByText(/Camera not ready/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Grab frame' })).toBeEnabled()
    expect(screen.queryByAltText('Grabbed frame')).not.toBeInTheDocument()
  })

  it('releases the previous image when you grab again', async () => {
    await liveWith(async () => grabResult())
    fireEvent.click(screen.getByRole('button', { name: 'Grab frame' }))
    await screen.findByAltText('Grabbed frame')

    fireEvent.click(screen.getByRole('button', { name: 'Grab frame' }))
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:grabbed'))
  })

  it('has a second button that waits for the hand to leave before grabbing, as a check does', async () => {
    const grab = vi.fn(async () => grabResult())
    installFakeMediaDevices([C270])
    URL.createObjectURL = vi.fn(() => 'blob:grabbed')
    URL.revokeObjectURL = vi.fn()
    const fake = fakeDetection()
    render(<CameraDebug detectionDeps={fake.deps} grab={grab} />)
    await screen.findByText('Detection: ready')

    fake.show(thumbsUp, 0) // a hand is in view
    fireEvent.click(screen.getByRole('button', { name: 'Grab after hand leaves' }))
    expect(await screen.findByRole('button', { name: 'Waiting for hand to leave...' })).toBeDisabled()
    expect(grab).not.toHaveBeenCalled()

    fake.holdFor(none, 67, 500) // the hand leaves
    expect(await screen.findByAltText('Grabbed frame')).toBeInTheDocument()
    expect(grab).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Grab after hand leaves' })).toBeEnabled()
  })

  it('disables the wait-for-hand button until the camera is live', async () => {
    installFakeMediaDevices([MACBOOK, IPHONE])
    render(<CameraDebug detectionDeps={fakeDetection().deps} grab={async () => grabResult()} />)
    await screen.findByText(/Hat cam not found/)
    expect(screen.getByRole('button', { name: 'Grab after hand leaves' })).toBeDisabled()
  })

  it('offers the grabbed photo as a download with a dated file name', async () => {
    await liveWith(async () => grabResult())
    expect(screen.queryByRole('link', { name: 'Download JPEG' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Grab frame' }))
    const link = await screen.findByRole('link', { name: 'Download JPEG' })
    expect(link).toHaveAttribute('href', 'blob:grabbed')
    expect(link.getAttribute('download')).toMatch(/^hatcam-\d{8}-\d{6}\.jpg$/)
  })

  it('flags a JPEG outside the 80 to 150 KB target', async () => {
    await liveWith(async () => grabResult(300 * 1024))
    fireEvent.click(screen.getByRole('button', { name: 'Grab frame' }))
    await screen.findByAltText('Grabbed frame')
    expect(screen.getByTestId('grab-size')).toHaveTextContent('300 KB')
    expect(screen.getByTestId('grab-size')).toHaveTextContent('outside 80-150 KB')
  })
})

describe('CameraDebug gestures panel', () => {
  async function live() {
    installFakeMediaDevices([C270])
    const fake = fakeDetection()
    render(<CameraDebug detectionDeps={fake.deps} />)
    await screen.findByText('Detection: ready')
    return fake
  }

  it('shows no events and no hold before anything happens', async () => {
    await live()
    expect(screen.getByTestId('hold-text')).toHaveTextContent('nothing held')
    expect(screen.getByTestId('hand-visible')).toHaveTextContent('no')
    expect(screen.getByText('No gestures fired yet')).toBeInTheDocument()
  })

  it('shows the gesture being held and how far along it is', async () => {
    const fake = await live()
    fake.show(thumbsUp, 0)
    fake.show(thumbsUp, 500)
    expect(screen.getByTestId('hold-text')).toHaveTextContent('next 50%')
    expect(screen.getByTestId('hold')).toHaveAttribute('value', '0.5')
    expect(screen.getByTestId('hand-visible')).toHaveTextContent('yes')
  })

  it('lists a gesture once it has been held long enough', async () => {
    const fake = await live()
    fake.holdFor(thumbsUp, 0, 1005)

    const events = screen.getAllByTestId('gesture-event')
    expect(events).toHaveLength(1)
    expect(events[0]).toHaveTextContent('next')
    expect(screen.queryByText('No gestures fired yet')).not.toBeInTheDocument()
    expect(screen.getByTestId('hold-text')).toHaveTextContent('nothing held')
  })

  it('shows the newest events first and keeps only the last five', async () => {
    const fake = await live()
    let t = 0
    // Alternate thumbs-down and thumbs-up with a break between, so each one fires.
    for (let i = 0; i < 7; i++) {
      fake.holdFor(i % 2 === 0 ? thumbsDown : thumbsUp, t, t + 1070)
      t += 1070 + 67
      fake.holdFor(none, t, t + 2200) // let go and wait out the cooldown
      t += 2200 + 67
    }
    const events = screen.getAllByTestId('gesture-event')
    expect(events).toHaveLength(5)
    expect(events[0]).toHaveTextContent('back') // the 7th event was a thumbs-down
    expect(events[1]).toHaveTextContent('next')
  })
})
