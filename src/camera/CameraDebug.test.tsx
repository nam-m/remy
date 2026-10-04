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
const thumbsUp: Detection = { label: 'Thumb_Up', score: 0.93, handPresent: true, landmarks: hand, handedness: 'Right' }
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
    show: (d: Detection) => {
      current = d
      act(() => frame(performance.now()))
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
    expect(screen.getByText('error')).toBeInTheDocument()
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

    it('shows which hand MediaPipe thinks it is, and nothing when there is no hand', async () => {
      const fake = await liveWithDetection()
      expect(screen.getByTestId('handedness')).toHaveTextContent('-')

      fake.show({ ...thumbsUp, handedness: 'Left' })
      expect(screen.getByTestId('handedness')).toHaveTextContent('Left')

      fake.show(none)
      expect(screen.getByTestId('handedness')).toHaveTextContent('-')
    })

    it('says whether the current reading counts, so a rejected reading is visible', async () => {
      const fake = await liveWithDetection()
      fake.show(thumbsUp)
      expect(screen.getByTestId('counts')).toHaveTextContent('yes')

      fake.show({ ...thumbsUp, score: 0.55 })
      expect(screen.getByTestId('score')).toHaveTextContent('0.55')
      expect(screen.getByTestId('counts')).toHaveTextContent('no, score under 0.7')

      fake.show({ ...thumbsUp, label: 'None', score: 0.9 })
      expect(screen.getByTestId('counts')).toHaveTextContent('no, no gesture recognized')

      fake.show(none)
      expect(screen.getByTestId('counts')).toHaveTextContent('no, no hand')
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

  it('flags a JPEG outside the 80 to 150 KB target', async () => {
    await liveWith(async () => grabResult(300 * 1024))
    fireEvent.click(screen.getByRole('button', { name: 'Grab frame' }))
    await screen.findByAltText('Grabbed frame')
    expect(screen.getByTestId('grab-size')).toHaveTextContent('300 KB')
    expect(screen.getByTestId('grab-size')).toHaveTextContent('outside 80-150 KB')
  })
})
