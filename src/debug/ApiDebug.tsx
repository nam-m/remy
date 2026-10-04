// Developer page for trying the real backend end to end, at /?debug=api:
// a recipe parsed by the model, and a photo from the hat cam checked by it.
// With the dev server running and GEMINI_API_KEY in .env.local, nothing here is faked.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createApi } from '../api/index.ts'
import { CAMERA_ERROR_MESSAGES } from '../camera/cameraMessages.ts'
import { gestureName, mappingFromSearch } from '../camera/gestureMapper.ts'
import { MIN_SCORE } from '../camera/gestureTally.ts'
import type { GrabResult } from '../camera/grabSharpestFrame.ts'
import type { DetectionDeps } from '../camera/useDetection.ts'
import { useCamera } from '../camera/useCamera.ts'
import { DEMO_RECIPE_TEXT } from '../cooking/demoRecipe.ts'
import type { ApiClient } from '../cooking/ports.ts'
import { describeIngredient, fillPlaceholders } from '../cooking/scaling.ts'
import type { GestureEvent, ParsedRecipe, Verdict } from '../types.ts'
import '../camera/CameraDebug.css'
import './ApiDebug.css'

/** Used for the photo check until a recipe has been parsed. */
const SAMPLE_STEP = {
  text: 'Whisk the flour, milk and eggs into a batter.',
  cue: 'Batter is smooth with no dry flour streaks',
}

interface Failure {
  kind: string
  status?: number
  message: string
}

const asFailure = (error: unknown): Failure => {
  if (typeof error === 'object' && error !== null && 'kind' in error) {
    const { kind, status, message } = error as { kind: unknown; status?: unknown; message?: unknown }
    return {
      kind: String(kind),
      status: typeof status === 'number' ? status : undefined,
      message: typeof message === 'string' ? message : '',
    }
  }
  return { kind: 'unknown', message: error instanceof Error ? error.message : String(error) }
}

/** Wall-clock milliseconds, for timing a call. */
const now = () => performance.now()

const seconds = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`)

const VERDICT_LABELS: Record<Verdict['status'], string> = { ready: 'Ready', not_ready: 'Not ready', unsure: 'Unsure' }

function ErrorLine({ failure }: { failure: Failure }) {
  return (
    <p className="camera-debug__error" role="alert">
      {`${failure.kind}${failure.status ? ` (HTTP ${failure.status})` : ''}: ${failure.message}`}
    </p>
  )
}

export default function ApiDebug({
  api: apiOverride,
  detectionDeps,
  grab,
}: {
  api?: ApiClient
  detectionDeps?: DetectionDeps
  grab?: (video: HTMLVideoElement) => Promise<GrabResult>
}) {
  const [defaultApi] = useState(() => createApi())
  const api = apiOverride ?? defaultApi

  // ----- recipe -----
  const [text, setText] = useState(DEMO_RECIPE_TEXT)
  const [parsing, setParsing] = useState(false)
  const [recipe, setRecipe] = useState<ParsedRecipe | null>(null)
  const [parseMs, setParseMs] = useState<number | null>(null)
  const [parseError, setParseError] = useState<Failure | null>(null)

  async function parse() {
    setParsing(true)
    setParseError(null)
    const started = now()
    try {
      const parsed = await api.parseRecipe(text)
      setParseMs(now() - started)
      setRecipe(parsed)
      setPicked(null)
    } catch (error) {
      setParseMs(null)
      setParseError(asFailure(error))
    } finally {
      setParsing(false)
    }
  }

  // ----- the step to check -----
  const checkable = recipe ? recipe.steps.map((step, index) => ({ step, index })).filter((s) => s.step.checkable) : []
  const [picked, setPicked] = useState<number | null>(null)
  const chosen = checkable.find((s) => s.index === picked) ?? checkable[0]
  const stepToCheck =
    recipe && chosen
      ? {
          text: fillPlaceholders(chosen.step.text, recipe.ingredients, 1, 'screen'),
          cue: chosen.step.cue ?? SAMPLE_STEP.cue,
        }
      : SAMPLE_STEP

  // ----- photo check -----
  const [checking, setChecking] = useState(false)
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [checkMs, setCheckMs] = useState<number | null>(null)
  const [photo, setPhoto] = useState<{ url: string; kb: number } | null>(null)
  const [checkError, setCheckError] = useState<Failure | null>(null)
  const photoUrl = useRef<string | null>(null)
  useEffect(
    () => () => {
      if (photoUrl.current) URL.revokeObjectURL(photoUrl.current)
    },
    [],
  )

  // Every gesture that fires is logged, whether or not this page acts on it.
  const [fired, setFired] = useState<GestureEvent[]>([])
  // ?check=Victory (or Closed_Fist, Pointing_Up...) tries another gesture for check.
  const { mapping, checkLabel } = useMemo(() => mappingFromSearch(window.location.search), [])
  const camera = useCamera({
    mapping,
    paused: checking,
    deps: { detection: detectionDeps, grab },
    onGesture: (event) => {
      setFired((list) => [event, ...list].slice(0, 3))
      if (event.intent === 'check') void check()
    },
  })
  const { attachVideo } = camera
  const live = camera.status === 'live'

  async function check() {
    if (checking || camera.status !== 'live') return
    setChecking(true)
    setCheckError(null)
    try {
      const frame = await camera.grabForCheck()
      if (photoUrl.current) URL.revokeObjectURL(photoUrl.current)
      photoUrl.current = URL.createObjectURL(frame.blob)
      setPhoto({ url: photoUrl.current, kb: Math.round(frame.blob.size / 1024) })

      const started = now()
      const result = await api.checkStep(frame.blob, stepToCheck)
      setCheckMs(now() - started)
      setVerdict(result)
    } catch (error) {
      setVerdict(null)
      setCheckMs(null)
      setCheckError(asFailure(error))
    } finally {
      setChecking(false)
    }
  }

  // What the camera sees right now, and whether it is strong enough to count.
  const seen = camera.detection
  const seeing =
    !seen || !seen.handPresent
      ? 'no hand'
      : seen.label === 'None'
        ? 'hand seen, no gesture recognized'
        : `${seen.label} ${seen.score.toFixed(2)}${seen.score < MIN_SCORE ? ` (below ${MIN_SCORE}, does not count)` : ''}`

  const holding = camera.holdProgress.intent
    ? `${camera.holdProgress.intent} ${Math.round(camera.holdProgress.progress * 100)}%`
    : 'nothing held'

  return (
    <main className="camera-debug api-debug">
      <h1>Backend end to end</h1>
      <p className="camera-debug__hint">
        Real recipe parsing and a real photo check, through the dev server. Needs GEMINI_API_KEY in .env.local. Add{' '}
        <code>?mock</code> to the address to use the stand-in backend instead.
      </p>

      <div className="camera-debug__layout">
        <div className="api-debug__column">
          <section className="camera-debug__panel">
            <h2>1. Recipe parsing</h2>
            <label htmlFor="recipe-text" className="camera-debug__hint">
              Recipe text
            </label>
            <textarea id="recipe-text" aria-label="Recipe text" value={text} onChange={(e) => setText(e.target.value)} rows={9} />
            <button type="button" onClick={parse} disabled={parsing}>
              {parsing ? 'Parsing...' : 'Parse recipe'}
            </button>
            {parseError && <ErrorLine failure={parseError} />}
            {recipe && (
              <div className="api-debug__result">
                <h3>{recipe.title}</h3>
                <p>
                  {`${recipe.servings} servings, ${recipe.ingredients.length} ingredients, ${recipe.steps.length} steps`}
                  {parseMs !== null && <span data-testid="parse-time">{`, answered in ${seconds(parseMs)}`}</span>}
                </p>
                <ul className="api-debug__list">
                  {recipe.ingredients.map((i) => (
                    <li key={i.id}>{describeIngredient(i, 1).screen}</li>
                  ))}
                </ul>
                <ol className="api-debug__list">
                  {recipe.steps.map((s) => (
                    <li key={s.id} data-testid="parsed-step">
                      {fillPlaceholders(s.text, recipe.ingredients, 1, 'screen')}
                      {s.checkable && <span className="api-debug__badge">checkable</span>}
                      {s.cue && <div className="camera-debug__hint">{`Look for: ${s.cue}`}</div>}
                      {s.headsUp && <div className="camera-debug__hint">{`Heads-up: ${s.headsUp}`}</div>}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </section>
        </div>

        <div className="api-debug__column">
          <div className="camera-debug__stage">
            <video className="camera-debug__preview" ref={attachVideo} autoPlay muted playsInline />
          </div>

          <section className="camera-debug__panel">
            <h2>2. Photo check</h2>
            <dl>
              <dt>Camera</dt>
              <dd className={`camera-debug__status camera-debug__status--${camera.status}`}>{camera.status}</dd>
              <dt>Gestures</dt>
              <dd>{`Detection: ${live ? camera.detectionStatus : 'waiting for camera'}`}</dd>
              <dt>Seeing</dt>
              <dd data-testid="seeing">{seeing}</dd>
              <dt>Hold</dt>
              <dd data-testid="hold">{holding}</dd>
              <dt>Fired</dt>
              <dd data-testid="fired">
                {fired.length === 0
                  ? 'none yet'
                  : fired.map((e) => (
                      <span key={e.at} data-testid="fired-event" className="api-debug__fired">{`${e.intent} at ${(e.at / 1000).toFixed(1)} s`}</span>
                    ))}
              </dd>
            </dl>
            {camera.error && <p className="camera-debug__error">{CAMERA_ERROR_MESSAGES[camera.error]}</p>}

            {checkable.length > 0 && (
              <>
                <label htmlFor="step-to-check" className="camera-debug__hint">
                  Step to check
                </label>
                <select
                  id="step-to-check"
                  aria-label="Step to check"
                  value={chosen?.index ?? ''}
                  onChange={(e) => setPicked(Number(e.target.value))}
                >
                  {checkable.map(({ step, index }) => (
                    <option key={step.id} value={index}>
                      {`Step ${index + 1}: ${step.text.slice(0, 40)}`}
                    </option>
                  ))}
                </select>
              </>
            )}
            {checkable.length === 0 && <p className="camera-debug__hint">Parse a recipe to pick a step. Until then a sample step is used.</p>}

            <button type="button" onClick={check} disabled={!live || checking}>
              {checking ? 'Checking...' : 'Check with a photo'}
            </button>
            <p className="camera-debug__hint" data-testid="check-hint">
              {`Or hold ${gestureName(checkLabel)} for 1 s, then take your hand away: it checks by itself. To try another gesture, add ?check=Victory (or Closed_Fist, Pointing_Up) to the address.`}
            </p>

            {checkError && <ErrorLine failure={checkError} />}
            {verdict && (
              <div className="api-debug__result">
                <p data-testid="verdict-status" className={`api-debug__verdict api-debug__verdict--${verdict.status}`}>
                  {VERDICT_LABELS[verdict.status]}
                </p>
                <p>{verdict.feedback}</p>
                {checkMs !== null && <p data-testid="check-time">{`answered in ${seconds(checkMs)}`}</p>}
              </div>
            )}
            {photo && (
              <>
                <img className="camera-debug__grab" src={photo.url} alt="Photo sent to the check" />
                <p className="camera-debug__hint" data-testid="photo-size">{`${photo.kb} KB sent`}</p>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}
