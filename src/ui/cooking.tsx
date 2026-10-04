// The cooking screen's components (§9.3): the step-card carousel, the hold pill, the gesture legend
// and the verdict overlay. Remy is present here, so these are the pieces read at 2 m.
import type { CSSProperties } from 'react'
import { AUTO_ADVANCE_MS, useCooking, useHoldProgress, type FilledStep } from '../cooking/contract.ts'
import { CameraView } from './CameraView.tsx'
import { fieldFor, VERDICT_FIELDS } from './fields.ts'
import { HEAD_SRC, RemyFlipbook } from './Remy.tsx'
import { SAY, GESTURE_HINTS } from './say.ts'
import { shape, STEP_SHAPES, VERDICT_SHAPE } from './shapes.ts'
import { CueChip, HeadsUpBanner } from './prep.tsx'

/** One dot per step: done, the current one a wide pill in the step accent, upcoming faint. */
export function StepProgress({ steps, index, accent }: { steps: FilledStep[]; index: number; accent: string }) {
  return (
    <div className="ui-steps" aria-label={`Step ${index + 1} of ${steps.length}`}>
      {steps.map((step, i) => (
        <i
          key={step.id}
          className={i < index ? 'ui-steps__done' : i === index ? 'ui-steps__now' : ''}
          style={i === index ? { background: accent } : undefined}
        />
      ))}
    </div>
  )
}

/**
 * One step on a card: the text on the left, the live camera on the right in an accent bezel, and
 * the whole uncropped picture — exactly the frame Remy judges. While checking, the text dims and a
 * scan sweeps the picture instead of a separate overlay.
 */
export function StepCard({
  step,
  index,
  current,
  checking,
}: {
  step: FilledStep
  index: number
  current: boolean
  checking: boolean
}) {
  const { camera } = useCooking()
  const field = fieldFor(index)
  const cardVars = { '--card': field.card, '--back': field.back, '--fg': field.fg, '--accent': field.accent } as CSSProperties
  const n = index % STEP_SHAPES.length

  return (
    <article className={`ui-card ${current ? 'ui-card--now' : ''}`} style={cardVars} aria-current={current}>
      <div className="ui-card__text">
        <div className="ui-card__num" style={{ clipPath: shape(STEP_SHAPES[n], index * 20) }}>
          {index + 1}
        </div>
        <h2>{step.text}</h2>
        <HeadsUpBanner text={step.headsUp} />
        <CueChip step={step} />
      </div>
      <div className="ui-card__media" style={{ background: field.back }}>
        <div className="ui-card__frame">
          {current ? (
            <CameraView cam={camera} caption="Remy's view" style={{ '--cam-bg': field.back, '--cam-fg': '#fff7ea' } as CSSProperties} />
          ) : (
            <div className="ui-card__ghost" aria-hidden />
          )}
          {current && checking && <i className="ui-scan" aria-hidden />}
        </div>
        <p className="ui-card__hint" style={{ visibility: current && step.checkable && !checking ? 'visible' : 'hidden' }}>
          Keep the bowl inside the picture, then show ✋.
        </p>
      </div>
      {current && checking && (
        <div className="ui-card__peek">
          <RemyFlipbook pose="stir" />
        </div>
      )}
    </article>
  )
}

/** The ring that fills while a gesture is held, so the cook can see the hold is counting. */
export function HoldPill({ canCheck = true }: { canCheck?: boolean }) {
  const hold = useHoldProgress() // read here, so only the pill re-renders as the hold ticks
  if (!hold.intent || hold.progress <= 0) return null
  const icon = hold.intent === 'next' ? '👍' : hold.intent === 'back' ? '👎' : '✋'
  const label =
    hold.intent === 'check'
      ? canCheck
        ? 'Keep holding… is it ready?'
        : 'Nothing to check on this step. 👍 when you are done'
      : `Keep holding… ${hold.intent} step`
  return (
    <div className="ui-hold" style={{ '--p': hold.progress } as CSSProperties}>
      <span className="ui-hold__ring">
        <span>{icon}</span>
      </span>
      {label}
    </div>
  )
}

/** What each gesture does. ✋ is only lit on a checkable step. */
export function GestureLegend({ canCheck }: { canCheck: boolean }) {
  return (
    <div className="ui-legend">
      <div className="ui-legend__group">
        {GESTURE_HINTS.map(hint => (
          <span
            key={hint.intent}
            className={
              hint.intent === 'next'
                ? 'ui-legend__next'
                : hint.intent === 'check'
                  ? canCheck
                    ? 'ui-legend__check--on'
                    : 'ui-legend__check--off'
                  : undefined
            }
          >
            {hint.icon} {hint.intent === 'check' && !canCheck ? 'no check on this step' : hint.label}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Shown when the hand model failed to load: the keys do what the gestures would. */
export function GestureFallbackNote() {
  const { gestures } = useCooking()
  if (gestures.status !== 'error') return null
  return (
    <div className="ui-error" role="alert">
      <span>Hand gestures aren't working. Press N for next, B for back and Space to check.</span>
    </div>
  )
}

/**
 * The verdict, as a popup over the foot of the cooking screen. The step card and its camera stay in
 * view above it. `ready` celebrates and counts down to the next step; the other two wait for the
 * cook, who can always check again (✋) or move on (👍) (§9.3).
 */
export function VerdictPopup({ verdict, autoAdvanceAt, now }: { verdict: { status: 'ready' | 'not_ready' | 'unsure'; feedback: string }; autoAdvanceAt: number | null; now: number }) {
  const ready = verdict.status === 'ready'
  const left = autoAdvanceAt === null ? 0 : Math.max(0, Math.min(1, (autoAdvanceAt - now) / AUTO_ADVANCE_MS))

  return (
    <div className={`ui-verdict ui-verdict--${verdict.status}`} role="status" style={{ background: VERDICT_FIELDS[verdict.status] }}>
      <div className="ui-verdict__hero">
        <div className="ui-verdict__shape" style={{ clipPath: shape(VERDICT_SHAPE[verdict.status]) }} />
        {ready && (
          <>
            <i className="ui-verdict__spark ui-verdict__spark--1">✦</i>
            <i className="ui-verdict__spark ui-verdict__spark--2">✦</i>
            <i className="ui-verdict__spark ui-verdict__spark--3">✦</i>
          </>
        )}
        {ready ? <RemyFlipbook pose="cheer" className="ui-verdict__mascot" /> : <img src={HEAD_SRC} alt="" className="ui-verdict__head" />}
      </div>
      <div className="ui-verdict__body">
        <div className="ui-verdict__catchline">{SAY.verdict[verdict.status]}</div>
        <p className="ui-verdict__text">{verdict.feedback}</p>
        {ready ? (
          <>
            <p className="ui-verdict__foot">Moving on in {Math.ceil(left * (AUTO_ADVANCE_MS / 1000))} seconds · 👎 to stay</p>
            <div className="ui-countdown" aria-hidden>
              <i style={{ transform: `scaleX(${left})` }} />
            </div>
          </>
        ) : (
          <p className="ui-verdict__foot">
            {verdict.status === 'not_ready' ? '✋ check again whenever you like · 👍 move on anyway' : '✋ try again · 👍 move on anyway'}
          </p>
        )}
      </div>
    </div>
  )
}
