// CookingScreen (§9.2): the hands-free part. The page takes the step's colour field, the cards slide
// along one track, and the check happens inside the current card. Every pointer down counts as a tap.
import { useEffect, useState } from 'react'
import { canCheck, currentStep, filledSteps, useCooking, type ShownStep } from '../cooking/contract.ts'
import { GestureFallbackNote, GestureLegend, HoldPill, StepCard, StepProgress, VerdictOverlay } from './cooking.tsx'
import { fieldFor } from './fields.ts'
import { HEAD_SRC, SpeechBubble } from './Remy.tsx'
import { SAY } from './say.ts'
import { ErrorBanner } from './prep.tsx'

/** What Remy says on the cooking screen, in priority order (§9.2). */
function bubbleFor(step: ShownStep | null, index: number, checking: boolean) {
  if (checking) return <b>{SAY.look}</b>
  if (!step) return null
  return (
    <>
      {index === 0 && <b>{SAY.go} </b>}
      {step.headsUp && <b>{SAY.headsUp} </b>}
      {step.text}
    </>
  )
}

/** Re-renders on a timer while a verdict is counting down, so the bar and the seconds move. */
function useTicking(active: boolean, ms = 100): number {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(performance.now()), ms)
    return () => clearInterval(id)
  }, [active, ms])
  return now
}

export function CookingScreen() {
  const { state, dispatch } = useCooking()
  const steps = filledSteps(state)
  const field = fieldFor(state.stepIndex)
  const checking = state.mode === 'checking'
  const now = useTicking(state.mode === 'verdict')

  return (
    <div
      className={`ui-cook ${checking ? 'ui-cook--checking' : ''}`}
      style={{ background: field.back, color: field.fg }}
      onPointerDown={() => dispatch({ type: 'screenTapped' })}
    >
      <ErrorBanner error={state.error} onDismiss={() => dispatch({ type: 'errorDismissed' })} />
      <GestureFallbackNote />
      <header className="ui-top">
        <div className="ui-logo ui-logo--light">
          <img src={HEAD_SRC} alt="" />
          REMY
        </div>
        <StepProgress steps={steps} index={state.stepIndex} accent={field.accent} />
      </header>

      <div className="ui-rise">
        <div className="ui-track" style={{ transform: `translateX(calc(${-state.stepIndex} * (70vw + 32px)))` }}>
          {steps.map((s, i) => (
            <StepCard key={s.id} step={s} index={i} current={i === state.stepIndex} checking={checking} />
          ))}
        </div>
      </div>

      <div className="ui-cook__remy">
        <div className="ui-remy-line">
          <img src={HEAD_SRC} alt="" />
          <SpeechBubble small>{bubbleFor(currentStep(state), state.stepIndex, checking)}</SpeechBubble>
        </div>
      </div>

      <GestureLegend canCheck={canCheck(state)} />
      <HoldPill />

      {state.mode === 'verdict' && state.verdict && (
        <VerdictOverlay verdict={state.verdict} autoAdvanceAt={state.autoAdvanceAt} now={now} />
      )}
    </div>
  )
}