// The presentational pieces of §9, rendered with props rather than through the whole session. These
// carry the cook-facing copy and the accessible names, so they are worth pinning down.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { GestureLegend, HoldPill, VerdictOverlay } from './cooking.tsx'
import { ErrorBanner, HeadsUpBanner, ServingsStepper, VoicingProgress } from './prep.tsx'
import { SAY } from './say.ts'
import { CookingContext, HoldProgressContext } from '../cooking/context.ts'
import type { CookingContextValue } from '../cooking/contract.ts'
import type { HoldProgress } from '../types.ts'

// The verdict screens that wait for the cook show a live camera view, which reads the camera from context.
const cooking = {
  camera: { attachVideo() {}, video: null, status: 'live', error: null, label: null, stream: null, reconnects: 0, stalls: 0 },
} as unknown as CookingContextValue
const renderVerdict = (status: 'ready' | 'not_ready' | 'unsure', autoAdvanceAt: number | null = null, feedback = '') =>
  render(
    <CookingContext.Provider value={cooking}>
      <VerdictOverlay verdict={{ status, feedback }} autoAdvanceAt={autoAdvanceAt} now={0} />
    </CookingContext.Provider>,
  )

const renderPill = (hold: HoldProgress) =>
  render(
    <HoldProgressContext.Provider value={hold}>
      <HoldPill />
    </HoldProgressContext.Provider>,
  )

afterEach(cleanup)

describe('GestureLegend', () => {
  it('always teaches all three gestures', () => {
    render(<GestureLegend canCheck={false} />)
    for (const label of ['back', 'is it ready?', 'next']) {
      expect(screen.getByText(new RegExp(label, 'i'))).toBeTruthy()
    }
  })

  it('dims ✋ on a step that cannot be checked, so the cook does not try it', () => {
    const { container } = render(<GestureLegend canCheck={false} />)
    expect(container.querySelector('.ui-legend__check--off')).toBeTruthy()
    expect(container.querySelector('.ui-legend__check--on')).toBeNull()
  })

  it('lights ✋ on a checkable step', () => {
    const { container } = render(<GestureLegend canCheck />)
    expect(container.querySelector('.ui-legend__check--on')).toBeTruthy()
  })
})

describe('VerdictOverlay', () => {
  it('says something different for each of the three answers', () => {
    for (const status of ['ready', 'not_ready', 'unsure'] as const) {
      const { unmount } = renderVerdict(status, null, 'because')
      expect(screen.getByText(SAY.verdict[status])).toBeTruthy()
      expect(screen.getByText('because')).toBeTruthy()
      unmount()
    }
  })

  it('counts down to the next step only when it is ready', () => {
    const { container: ready } = renderVerdict('ready', 2000)
    expect(ready.querySelector('.ui-countdown')).toBeTruthy()

    const { container: notReady } = renderVerdict('not_ready')
    expect(notReady.querySelector('.ui-countdown')).toBeNull()
  })

  it('gives each verdict its own colour field', () => {
    const { container } = renderVerdict('unsure')
    expect(container.querySelector('.ui-verdict--unsure')).toBeTruthy()
  })

  it('never leaves the cook without a way on: both ✋ and 👍 are offered when it is not ready or unsure', () => {
    for (const status of ['not_ready', 'unsure'] as const) {
      const { unmount, container } = renderVerdict(status)
      const foot = container.querySelector('.ui-verdict__foot')?.textContent ?? ''
      expect(foot).toContain('✋')
      expect(foot).toContain('👍')
      unmount()
    }
  })

  it('shows the live camera while it waits for the cook, but not on a ready verdict that moves on by itself', () => {
    const { container: waiting } = renderVerdict('unsure')
    expect(waiting.querySelector('.ui-verdict__cam')).toBeTruthy()
    const { container: ready } = renderVerdict('ready', 2000)
    expect(ready.querySelector('.ui-verdict__cam')).toBeNull()
  })
})

describe('HoldPill', () => {
  it('stays hidden until a gesture is actually partway held', () => {
    const { container } = renderPill({ intent: null, progress: 0 })
    expect(container.querySelector('.ui-hold')).toBeNull()
  })

  it('tells the cook to keep holding, and which way it is going', () => {
    renderPill({ intent: 'check', progress: 0.5 })
    expect(screen.getByText(/keep holding/i)).toBeTruthy()
    expect(screen.getByText(/is it ready\?/i)).toBeTruthy()
  })

  it('shows ✋ while checking, not a next arrow', () => {
    renderPill({ intent: 'check', progress: 0.5 })
    expect(screen.getByText('✋')).toBeTruthy()
  })
})

describe('ServingsStepper', () => {
  it('counts the portions out loud, and says what it was', () => {
    render(<ServingsStepper servings={8} original={4} onChange={() => {}} />)
    expect(screen.getByText('8 servings (was 4)')).toBeTruthy()
  })

  it('says nothing about a change when the cook has not changed it', () => {
    render(<ServingsStepper servings={4} original={4} onChange={() => {}} />)
    expect(screen.getByText('4 servings')).toBeTruthy()
  })

  it('steps up and down', () => {
    const onChange = vi.fn()
    render(<ServingsStepper servings={4} original={4} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /more servings/i }))
    fireEvent.click(screen.getByRole('button', { name: /fewer servings/i }))
    expect(onChange.mock.calls).toEqual([[5], [3]])
  })

  it('stops at the ends rather than offering 0 or 100', () => {
    render(<ServingsStepper servings={1} original={1} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /fewer servings/i })).toHaveProperty('disabled', true)
  })
})

describe('VoicingProgress', () => {
  it('counts the clips as they arrive', () => {
    render(<VoicingProgress ready={3} total={8} failed={false} onRetry={() => {}} />)
    expect(screen.getByText(/3\/8/)).toBeTruthy()
  })

  it('offers a retry only when it failed', () => {
    const onRetry = vi.fn()
    const { unmount } = render(<VoicingProgress ready={0} total={8} failed onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalled()
    unmount()

    render(<VoicingProgress ready={8} total={8} failed={false} onRetry={onRetry} />)
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
  })
})

describe('ErrorBanner', () => {
  it('renders nothing when there is no error', () => {
    const { container } = render(<ErrorBanner error={null} onDismiss={() => {}} />)
    expect(container.querySelector('.ui-error')).toBeNull()
  })

  it('is announced, and can be cleared', () => {
    const onDismiss = vi.fn()
    render(<ErrorBanner error={{ kind: 'camera', message: 'The hat cam fell off' }} onDismiss={onDismiss} />)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText('The hat cam fell off')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(onDismiss).toHaveBeenCalled()
  })
})

describe('HeadsUpBanner', () => {
  it('warns about what the next step needs, and stays out of the way otherwise', () => {
    const { container, rerender } = render(<HeadsUpBanner text="The next step needs a hot pan." />)
    expect(screen.getByText(/hot pan/)).toBeTruthy()
    rerender(<HeadsUpBanner text={null} />)
    expect(container.querySelector('.ui-headsup')).toBeNull()
  })
})