import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors.ts'
import { DEMO_RECIPE_TEXT } from '../cooking/demoRecipe.ts'
import { pancakes } from '../cooking/fixtures.ts'
import type { ApiClient } from '../cooking/ports.ts'
import type { GrabResult } from '../camera/grabSharpestFrame.ts'
import type { Verdict } from '../types.ts'
import type { Detection, Recognizer } from '../camera/recognizer.ts'
import type { DetectionDeps } from '../camera/useDetection.ts'
import { C270, IPHONE, MACBOOK, installFakeMediaDevices } from '../test/fakes/media.ts'
import ApiDebug from './ApiDebug.tsx'

const verdict: Verdict = { status: 'ready', feedback: 'Looks smooth. Next step.' }

function fakeApi() {
  return {
    parseRecipe: vi.fn(async (_text: string) => pancakes),
    checkStep: vi.fn(async (_frame: Blob, _step: { text: string; cue: string }, _opts?: { signal?: AbortSignal }) => verdict),
  } satisfies ApiClient
}

const grabbed = (): GrabResult => ({
  blob: new Blob([new Uint8Array(120 * 1024)], { type: 'image/jpeg' }),
  width: 768,
  height: 432,
  scores: [1],
  chosen: 0,
})

const hand: Detection = { label: 'None', score: 0, handPresent: false, landmarks: null }
const openPalm: Detection = { label: 'Open_Palm', score: 0.95, handPresent: true, landmarks: [] }
const thumbsUp: Detection = { label: 'Thumb_Up', score: 0.9, handPresent: true, landmarks: [] }
const weakPalm: Detection = { label: 'Open_Palm', score: 0.55, handPresent: true, landmarks: [] }

/** Fake MediaPipe: tests push readings one frame at a time. */
function fakeDetection() {
  let current = hand
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
    holdFor(reading: Detection, t0: number, t1: number) {
      current = reading
      for (let t = t0; t <= t1; t += 67) act(() => frame(t))
    },
  }
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:photo')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
})

async function open(api = fakeApi(), cameras = [C270]) {
  installFakeMediaDevices(cameras)
  const detection = fakeDetection()
  render(<ApiDebug api={api} detectionDeps={detection.deps} grab={async () => grabbed()} />)
  return { api, detection }
}
const live = () => screen.findByText('live')

describe('recipe parsing', () => {
  it('starts with the demo recipe in the box and parses it on request', async () => {
    const { api } = await open()
    expect(screen.getByRole('textbox', { name: 'Recipe text' })).toHaveValue(DEMO_RECIPE_TEXT)

    fireEvent.click(screen.getByRole('button', { name: 'Parse recipe' }))
    expect(await screen.findByText('Pancakes')).toBeInTheDocument()
    expect(api.parseRecipe).toHaveBeenCalledWith(DEMO_RECIPE_TEXT)
  })

  it('sends whatever is in the box', async () => {
    const { api } = await open()
    fireEvent.change(screen.getByRole('textbox', { name: 'Recipe text' }), { target: { value: 'Toast: toast bread.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Parse recipe' }))
    await screen.findByText('Pancakes')
    expect(api.parseRecipe).toHaveBeenCalledWith('Toast: toast bread.')
  })

  it('shows the servings, the ingredients and every step, marking the ones that can be checked', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Parse recipe' }))
    await screen.findByText('Pancakes')

    expect(screen.getByText(/4 servings/)).toBeInTheDocument()
    expect(screen.getByText('1 cup flour')).toBeInTheDocument()
    expect(screen.getByText('2 eggs')).toBeInTheDocument()
    expect(screen.getAllByTestId('parsed-step')).toHaveLength(5)
    expect(screen.getByText(/Batter is smooth with no dry flour streaks/)).toBeInTheDocument()
    expect(screen.getAllByText('checkable')).toHaveLength(3)
  })

  it('shows how long it took', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Parse recipe' }))
    expect(await screen.findByText(/answered in/)).toBeInTheDocument()
  })

  it('says it is parsing and cannot be clicked again while it waits', async () => {
    const api = fakeApi()
    let finish: (r: typeof pancakes) => void = () => {}
    api.parseRecipe.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    await open(api)

    fireEvent.click(screen.getByRole('button', { name: 'Parse recipe' }))
    expect(await screen.findByRole('button', { name: 'Parsing...' })).toBeDisabled()
    await act(async () => finish(pancakes))
    expect(screen.getByRole('button', { name: 'Parse recipe' })).toBeEnabled()
  })

  it('shows the error kind, the HTTP status and the server message when parsing fails', async () => {
    const api = fakeApi()
    api.parseRecipe.mockRejectedValueOnce(new ApiError('upstream', { message: 'GEMINI_API_KEY is not set.', status: 502 }))
    await open(api)
    fireEvent.click(screen.getByRole('button', { name: 'Parse recipe' }))
    expect(await screen.findByText(/upstream/)).toBeInTheDocument()
    expect(screen.getByText(/HTTP 502/)).toBeInTheDocument()
    expect(screen.getByText(/GEMINI_API_KEY is not set\./)).toBeInTheDocument()
  })

  it('copes with an error that is not an API error', async () => {
    const api = fakeApi()
    api.parseRecipe.mockRejectedValueOnce(new TypeError('boom'))
    await open(api)
    fireEvent.click(screen.getByRole('button', { name: 'Parse recipe' }))
    expect(await screen.findByText(/unknown/)).toBeInTheDocument()
  })
})

describe('photo check', () => {
  it('cannot run until the hat cam is live', async () => {
    await open(fakeApi(), [MACBOOK, IPHONE])
    await screen.findByText(/Hat cam not found/)
    expect(screen.getByRole('button', { name: 'Check with a photo' })).toBeDisabled()
  })

  it('sends a real photo with a sample step before any recipe is parsed', async () => {
    const { api } = await open()
    await live()
    fireEvent.click(screen.getByRole('button', { name: 'Check with a photo' }))

    expect(await screen.findByTestId('verdict-status')).toHaveTextContent('Ready')
    expect(api.checkStep).toHaveBeenCalledTimes(1)
    const [photo, step] = api.checkStep.mock.calls[0]
    expect(photo).toBeInstanceOf(Blob)
    expect(step.text).toContain('batter')
    expect(step.cue.length).toBeGreaterThan(0)
  })

  it('shows the verdict, its words, the photo that was sent and its size, and the time', async () => {
    await open()
    await live()
    fireEvent.click(screen.getByRole('button', { name: 'Check with a photo' }))

    expect(await screen.findByText('Looks smooth. Next step.')).toBeInTheDocument()
    expect(screen.getByAltText('Photo sent to the check')).toHaveAttribute('src', 'blob:photo')
    expect(screen.getByTestId('photo-size')).toHaveTextContent('120 KB')
    expect(screen.getByTestId('check-time')).toHaveTextContent(/answered in/)
  })

  it.each([
    ['ready', 'Ready'],
    ['not_ready', 'Not ready'],
    ['unsure', 'Unsure'],
  ] as const)('labels a %s verdict as %s', async (status, label) => {
    const api = fakeApi()
    api.checkStep.mockResolvedValueOnce({ status, feedback: 'x' })
    await open(api)
    await live()
    fireEvent.click(screen.getByRole('button', { name: 'Check with a photo' }))
    expect(await screen.findByTestId('verdict-status')).toHaveTextContent(label)
  })

  it('uses the first step that can be checked once a recipe is parsed, filled in with its amounts', async () => {
    const { api } = await open()
    await live()
    fireEvent.click(screen.getByRole('button', { name: 'Parse recipe' }))
    await screen.findByText('Pancakes')

    fireEvent.click(screen.getByRole('button', { name: 'Check with a photo' }))
    await screen.findByTestId('verdict-status')
    expect(api.checkStep.mock.calls[0][1]).toEqual({
      text: 'Whisk 1 cup flour, 1 cup milk and 2 eggs into a batter.',
      cue: 'Batter is smooth with no dry flour streaks',
    })
  })

  it('checks a different step when one is picked', async () => {
    const { api } = await open()
    await live()
    fireEvent.click(screen.getByRole('button', { name: 'Parse recipe' }))
    await screen.findByText('Pancakes')

    fireEvent.change(screen.getByRole('combobox', { name: 'Step to check' }), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check with a photo' }))
    await screen.findByTestId('verdict-status')
    expect(api.checkStep.mock.calls[0][1].cue).toBe('Bubbles on top and the edges look set')
  })

  it('offers only the steps that can be checked', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Parse recipe' }))
    await screen.findByText('Pancakes')
    const options = screen.getByRole('combobox', { name: 'Step to check' }).querySelectorAll('option')
    expect(options).toHaveLength(3)
  })

  it('shows the error when the check fails', async () => {
    const api = fakeApi()
    api.checkStep.mockRejectedValueOnce(new ApiError('timeout'))
    await open(api)
    await live()
    fireEvent.click(screen.getByRole('button', { name: 'Check with a photo' }))
    expect(await screen.findByText(/timeout/)).toBeInTheDocument()
    expect(screen.getByText(/That took too long/)).toBeInTheDocument()
    expect(screen.queryByTestId('verdict-status')).not.toBeInTheDocument()
  })

  it('says it is checking and cannot be clicked again while it waits', async () => {
    const api = fakeApi()
    let finish: (v: typeof verdict) => void = () => {}
    api.checkStep.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    await open(api)
    await live()

    fireEvent.click(screen.getByRole('button', { name: 'Check with a photo' }))
    expect(await screen.findByRole('button', { name: 'Checking...' })).toBeDisabled()
    await act(async () => finish(verdict))
    expect(screen.getByRole('button', { name: 'Check with a photo' })).toBeEnabled()
  })

  it('lets go of the previous photo when a new one is taken', async () => {
    await open()
    await live()
    fireEvent.click(screen.getByRole('button', { name: 'Check with a photo' }))
    await screen.findByTestId('verdict-status')
    fireEvent.click(screen.getByRole('button', { name: 'Check with a photo' }))
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo'))
  })
})

describe('open palm', () => {
  it('starts a check by itself once held for a second and let go, as the app will', async () => {
    const { api, detection } = await open()
    await live()
    await screen.findByText('Detection: ready')

    detection.holdFor(openPalm, 0, 1070) // held 1 s: the check starts and waits for the hand to leave
    expect(api.checkStep).not.toHaveBeenCalled()
    detection.holdFor(hand, 1137, 1600) // the hand leaves
    expect(await screen.findByTestId('verdict-status')).toHaveTextContent('Ready')
    expect(api.checkStep).toHaveBeenCalledTimes(1)
  })

  it('does nothing for a palm that is not held long enough', async () => {
    const { api, detection } = await open()
    await live()
    await screen.findByText('Detection: ready')
    detection.holdFor(openPalm, 0, 500)
    detection.holdFor(hand, 567, 1100)
    expect(api.checkStep).not.toHaveBeenCalled()
  })
})

describe('what the camera sees', () => {
  async function ready() {
    const opened = await open()
    await live()
    await screen.findByText('Detection: ready')
    return opened
  }

  it('says there is no hand before anything is shown', async () => {
    await ready()
    expect(screen.getByTestId('seeing')).toHaveTextContent('no hand')
  })

  it('shows the gesture and its score as it is seen', async () => {
    const { detection } = await ready()
    detection.holdFor(openPalm, 0, 200)
    expect(screen.getByTestId('seeing')).toHaveTextContent('Open_Palm 0.95')
  })

  it('says when a reading is too weak to count, so a palm that never fires can be explained', async () => {
    const { detection } = await ready()
    detection.holdFor(weakPalm, 0, 200)
    expect(screen.getByTestId('seeing')).toHaveTextContent('Open_Palm 0.55')
    expect(screen.getByTestId('seeing')).toHaveTextContent('below 0.7, does not count')
  })

  it('shows the hold filling up while a gesture is held', async () => {
    const { detection } = await ready()
    detection.holdFor(openPalm, 0, 536)
    expect(screen.getByTestId('hold')).toHaveTextContent(/check 5\d%/)
  })

  it('logs each gesture that fires, so it is clear whether the hold completed', async () => {
    const { detection } = await ready()
    expect(screen.getByTestId('fired')).toHaveTextContent('none yet')
    detection.holdFor(openPalm, 0, 1070)
    expect(await screen.findByTestId('fired-event')).toHaveTextContent('check')
  })

  it('logs gestures this page does not act on, such as a thumbs-up, without starting a check', async () => {
    const { api, detection } = await ready()
    detection.holdFor(thumbsUp, 0, 1070)
    expect(await screen.findByTestId('fired-event')).toHaveTextContent('next')
    expect(api.checkStep).not.toHaveBeenCalled()
  })
})

describe('check gesture option', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/')
  })

  const victory: Detection = { label: 'Victory', score: 0.93, handPresent: true, landmarks: [] }

  async function openAt(search: string) {
    window.history.pushState({}, '', `/${search}`)
    const opened = await open()
    await live()
    await screen.findByText('Detection: ready')
    return opened
  }

  it('tells the cook to hold an open palm by default', async () => {
    await openAt('')
    expect(screen.getByTestId('check-hint')).toHaveTextContent('open palm')
  })

  it('tells the cook which gesture to hold when ?check= chose another', async () => {
    await openAt('?check=Pointing_Up')
    expect(screen.getByTestId('check-hint')).toHaveTextContent('pointing finger')
  })

  it('starts the check with the chosen gesture, and not with an open palm', async () => {
    const { api, detection } = await openAt('?check=Victory')
    detection.holdFor(openPalm, 0, 1070)
    detection.holdFor(hand, 1137, 1700)
    expect(api.checkStep).not.toHaveBeenCalled()

    detection.holdFor(victory, 2500, 3570)
    detection.holdFor(hand, 3637, 4200)
    expect(await screen.findByTestId('verdict-status')).toHaveTextContent('Ready')
    expect(api.checkStep).toHaveBeenCalledTimes(1)
  })
})
