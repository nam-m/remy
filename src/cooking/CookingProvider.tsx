// Wires Nam's pieces into one provider (§6.9): his reducer and controller, his useCamera, and the API
// client. His controller has no audio, so Remy's voice (§8) is added here, around it: the voice flow
// that caches the clips, and the clips that play as the state changes.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createApi } from '../api/index.ts'
import { clipCache } from '../audio/clipCache.ts'
import { createAudioPlayer } from '../audio/player.ts'
import { DONE_CLIP, FIXED_LINES, LOOKING_CLIP } from '../audio/lines.ts'
import { speak } from '../audio/speak.ts'
import { useCamera } from '../camera/useCamera.ts'
import type { HatCam } from '../camera/useHatCam.ts'
import { USE_ANY_CAMERA, useAnyCam } from '../camera/useAnyCam.ts'
import type { GestureEvent } from '../types.ts'
import { createController, toAppError } from './controller.ts'
import type { CameraPort } from './ports.ts'
import { stepClipId } from './scaling.ts'
import { currentStep, gesturesEnabled } from './selectors.ts'
import { cookingReducer, initialState, type Action, type CookingState } from './state.ts'
import { filledSteps } from './uiSelectors.ts'
import { CookingContext, DetectionContext, HoldProgressContext, type DetectionReading } from './context.ts'
import type { Controller, CookingContextValue, GestureStatus } from './contract.ts'

/** Changing servings waits this long before voicing again, so holding + doesn't start a run per click (§6.8). */
const REVOICE_DEBOUNCE_MS = 600
/** How many clips are made at once (§6.8). */
const VOICE_CONCURRENCY = 2

/** Every clip the recipe needs at the chosen servings: the two fixed lines, then one per step. */
function wantedClips(s: CookingState): { id: string; text: string }[] {
  const steps = filledSteps(s).map((step, i) => ({ id: stepClipId(s.recipe!.steps[i], s.servings), text: step.spoken }))
  return [{ id: LOOKING_CLIP, text: FIXED_LINES[LOOKING_CLIP] }, { id: DONE_CLIP, text: FIXED_LINES[DONE_CLIP] }, ...steps]
}

export function CookingProvider({ children }: { children: React.ReactNode }) {
  const [state, rawDispatch] = useReducer(cookingReducer, undefined, () => initialState())

  // The controller reads state straight after it dispatches, so the ref is updated in the same call
  // (the reducer is pure, so applying it here as well as in React gives the same state).
  const stateRef = useRef(state)
  const dispatch = useCallback((action: Action) => {
    stateRef.current = cookingReducer(stateRef.current, action)
    rawDispatch(action)
  }, [])

  const api = useMemo(() => createApi(), [])
  const audio = useMemo(() => createAudioPlayer({ speak }), [])

  // The latest gesture handler, so the camera is handed one stable callback.
  const gestureRef = useRef<(e: GestureEvent) => void>(() => {})
  const camera = useCamera({
    enabled: state.phase === 'cooking',
    paused: state.mode === 'checking',
    onGesture: useCallback((e: GestureEvent) => gestureRef.current(e), []),
    source: USE_ANY_CAMERA ? useAnyCam : undefined,
  })

  // The controller sees the camera through two functions that always read the newest one.
  const cameraRef = useRef(camera)
  useEffect(() => {
    cameraRef.current = camera
  })
  const flow = useMemo(() => {
    const port: CameraPort = {
      grabForCheck: () => cameraRef.current.grabForCheck(),
      isHolding: () => cameraRef.current.holdProgress.intent !== null,
    }
    return createController({ getState: () => stateRef.current, dispatch, api, camera: port, now: () => performance.now() })
  }, [api, dispatch])
  useEffect(() => () => flow.dispose(), [flow])

  // ---------- Voice (§6.8 voiceFlow) ----------

  /** Bumped by every voice run and by restart; a run that is no longer the latest drops its results. */
  const voiceRun = useRef(0)
  const revoiceTimer = useRef<number | null>(null)

  const [voiceFailed, setVoiceFailed] = useState(false)

  const voiceFlow = useCallback(async () => {
    const { recipe, servings } = stateRef.current
    if (!recipe) return
    const run = ++voiceRun.current
    const current = () => run === voiceRun.current
    const clips = wantedClips(stateRef.current)
    setVoiceFailed(false)
    dispatch({ type: 'voicingStarted', servings, total: clips.length })

    const queue = [...clips]
    let failed = false
    const worker = async () => {
      // A run that has been superseded stops at once, so it makes no more speech requests.
      for (let clip = queue.shift(); clip && !failed && current(); clip = queue.shift()) {
        try {
          // A clip already made for these servings is reused: 4 → 2 → 4 costs nothing.
          if (!clipCache.has(clip.id)) {
            const blob = await speak(clip.text)
            if (!current()) return // after a restart or a servings change the clip is not wanted
            audio.preload(clip.id, blob)
          }
          dispatch({ type: 'clipReady', id: clip.id, servings })
        } catch (error) {
          if (!current()) return
          failed = true
          setVoiceFailed(true)
          dispatch({ type: 'voicingFailed', error: toAppError(error) })
        }
      }
    }
    await Promise.all(Array.from({ length: VOICE_CONCURRENCY }, worker))
  }, [audio, dispatch])

  // ---------- Controller: Nam's flows plus the voice ----------

  const playStep = useCallback(() => {
    const s = stateRef.current
    const step = s.recipe?.steps[s.stepIndex]
    const shown = currentStep(s)
    if (step && shown) void audio.play(stepClipId(step, s.servings), shown.spoken)
  }, [audio])

  const controller = useMemo<Controller>(
    () => ({
      ...flow,

      async submitRecipe(text) {
        await flow.submitRecipe(text)
        if (stateRef.current.phase === 'prep') void voiceFlow()
      },

      setServings(n) {
        flow.setServings(n)
        if (revoiceTimer.current !== null) clearTimeout(revoiceTimer.current)
        revoiceTimer.current = window.setTimeout(() => void voiceFlow(), REVOICE_DEBOUNCE_MS)
      },

      retryVoicing() {
        if (revoiceTimer.current !== null) clearTimeout(revoiceTimer.current)
        dispatch({ type: 'errorDismissed' })
        void voiceFlow()
      },

      start() {
        void audio.unlock() // must happen inside the click that started cooking
        flow.start()
      },

      async onGesture(e) {
        const before = stateRef.current
        // Leaving a verdict by 👎 (or cancelling its countdown) cuts its speech off (§6.8 navigateFlow).
        if (e.intent === 'back' && before.mode === 'verdict') audio.stop()
        await flow.onGesture(e)
        // 👎 on the first step does not change the step, but the cook still wants it read again,
        // unless the 👎 only cancelled a ready countdown (§6.5).
        const after = stateRef.current
        if (e.intent === 'back' && before.phase === 'cooking' && after.stepIndex === 0 && before.stepIndex === 0 && before.autoAdvanceAt === null) {
          playStep()
        }
      },

      restart() {
        if (revoiceTimer.current !== null) clearTimeout(revoiceTimer.current)
        voiceRun.current++ // drops a voice run still in flight
        audio.stop()
        clipCache.clear()
        setVoiceFailed(false)
        flow.restart()
      },
    }),
    [flow, voiceFlow, audio, playStep],
  )
  // On unmount: no pending re-voice, no run left dispatching, no voice left playing.
  useEffect(
    () => () => {
      if (revoiceTimer.current !== null) clearTimeout(revoiceTimer.current)
      voiceRun.current++
      audio.stop()
    },
    [audio],
  )

  // ---------- Voice: what plays as the state changes ----------

  // A new step (or the first one) is read aloud, from the cache, never the network (§1).
  const { phase, stepIndex, mode, verdict } = state
  useEffect(() => {
    if (phase === 'cooking') {
      audio.stop()
      playStep()
    } else if (phase === 'done') {
      audio.stop()
      void audio.play(DONE_CLIP, FIXED_LINES[DONE_CLIP])
    }
  }, [phase, stepIndex, audio, playStep])

  // A check: "hold still" while it looks, then the verdict in Remy's voice. A check that fails or is
  // dropped cuts the "hold still" off rather than letting it finish.
  const previousMode = useRef(mode)
  useEffect(() => {
    const was = previousMode.current
    previousMode.current = mode
    if (mode === 'checking') void audio.play(LOOKING_CLIP, FIXED_LINES[LOOKING_CLIP])
    else if (mode === 'verdict' && verdict) void audio.speakLive(verdict.feedback)
    else if (was === 'checking' && mode === 'idle') audio.stop()
  }, [mode, verdict, audio])

  // ---------- Gestures: the camera's, plus the keyboard as a stand-in (N next, B back, Space check) ----------

  useEffect(() => {
    gestureRef.current = e => void controller.onGesture(e)
  })
  const keysOn = gesturesEnabled(state)
  useEffect(() => {
    if (!keysOn) return
    const keys: Record<string, GestureEvent['intent']> = { n: 'next', b: 'back', ' ': 'check' }
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (e.repeat || target?.closest?.('input, textarea, select, [contenteditable]')) return
      const intent = keys[e.key.toLowerCase()]
      if (!intent) return
      // Space on a focused button is that button's own press, not a check.
      if (e.key === ' ' && target?.closest?.('button, a, [role="button"]')) return
      e.preventDefault()
      gestureRef.current({ intent, at: performance.now() })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keysOn])

  // Only the fields CameraView reads, so the context holds still while the hold ring ticks.
  const { attachVideo, video, status, error, label, stream, reconnects, stalls } = camera
  const cameraSlice = useMemo<HatCam>(
    () => ({ attachVideo, video, status, error, label, stream, reconnects, stalls }),
    [attachVideo, video, status, error, label, stream, reconnects, stalls],
  )

  const { detectionStatus, detectionError, detection } = camera
  const gestures = useMemo<GestureStatus>(() => ({ status: detectionStatus, error: detectionError }), [detectionStatus, detectionError])
  const reading = useMemo<DetectionReading | null>(
    () => (detection ? { label: detection.label, score: detection.score, handPresent: detection.handPresent } : null),
    [detection],
  )

  const value = useMemo<CookingContextValue>(
    () => ({ state, controller, dispatch, camera: cameraSlice, gestures, voiceFailed }),
    [state, controller, dispatch, cameraSlice, gestures, voiceFailed],
  )

  return (
    <CookingContext.Provider value={value}>
      <HoldProgressContext.Provider value={camera.holdProgress}>
        <DetectionContext.Provider value={reading}>{children}</DetectionContext.Provider>
      </HoldProgressContext.Provider>
      {/* The one video the hand model and the check photo read. It stays mounted for the whole session,
          so moving between steps never restarts gesture detection; every visible camera window just
          shows the same stream. Clipped, not display:none, so the browser keeps delivering frames. */}
      <video ref={camera.attachVideo} className="ui-detect-video" muted playsInline autoPlay aria-hidden tabIndex={-1} />
    </CookingContext.Provider>
  )
}
