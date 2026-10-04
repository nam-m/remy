// The verdict screen must never be a dead end: after a check that is not ready, the cook can check
// again (✋) or move on (👍), and the keys do the same when the camera cannot read gestures.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../App.tsx'
import { C270, installFakeMediaDevices } from '../test/fakes/media.ts'

// jsdom has no canvas, so the frame grab is stood in for; everything else is the real flow.
vi.mock('../camera/grabSharpestFrame.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../camera/grabSharpestFrame.ts')>()),
  grabSharpestFrame: async () => ({ blob: new Blob(['frame']), width: 1, height: 1, scores: [1], chosen: 0 }),
}))

/** The text of the step card the cook is on (Remy's bubble repeats it, so a plain text query finds two). */
const currentStep = () => document.querySelector('.ui-card--now h2')?.textContent ?? ''

const press = (key: string) => act(() => void fireEvent.keyDown(window, { key }))

beforeEach(() => {
  installFakeMediaDevices([C270])
  window.history.replaceState(null, '', '/?mock')
})

afterEach(cleanup)

async function startCooking() {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: /let'?s cook/i }))
  const start = await screen.findByRole('button', { name: /remy, let'?s cook/i }, { timeout: 10_000 })
  await waitFor(() => expect(start).toHaveProperty('disabled', false), { timeout: 10_000 })
  fireEvent.click(start)
  await waitFor(() => expect(currentStep()).toMatch(/whisk/i))
}

describe('after a verdict that is not ready', () => {
  it('stays a popup over the card, offers both ways on, and 👍 moves to the next step', async () => {
    await startCooking()

    press(' ')
    await screen.findByText(SAY_NOT_READY, undefined, { timeout: 10_000 })
    // A popup: the step card and its camera are still there, not covered by a full-screen field.
    expect(document.querySelector('.ui-full')).toBeNull()
    expect(document.querySelector('.ui-card--now video')).toBeTruthy()
    expect(document.querySelector('.ui-verdict__foot')?.textContent).toMatch(/✋.*👍/)

    press('n')
    await waitFor(() => expect(document.querySelector('.ui-verdict')).toBeNull())
    expect(currentStep()).toMatch(/heat the pan/i)
  }, 30_000)

  it('✋ checks again', async () => {
    await startCooking()

    press(' ')
    await screen.findByText(SAY_NOT_READY, undefined, { timeout: 10_000 })
    press(' ')
    // The mock answers not ready, then unsure.
    await screen.findByText(/can't see that/i, undefined, { timeout: 10_000 })
  }, 30_000)
})

const SAY_NOT_READY = 'Almost, chef!'
