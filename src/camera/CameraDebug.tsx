// Developer page for the camera track, at /?debug=camera.
// Each camera branch adds a panel here so it can be checked on the real hat cam.

import { useEffect, useState } from 'react'
import type { GestureEvent } from '../types.ts'
import { CAMERA_ERROR_MESSAGES } from './cameraMessages.ts'
import { emptyTally, stepTally } from './gestureTally.ts'
import { GrabError, grabSharpestFrame, type GrabResult } from './grabSharpestFrame.ts'
import { GrabPanel } from './GrabPanel.tsx'
import { HandOverlay } from './HandOverlay.tsx'
import type { DetectionDeps } from './useDetection.ts'
import { useCamera } from './useCamera.ts'
import { useWakeLock } from './useWakeLock.ts'
import './CameraDebug.css'

/** How many fired gestures the log keeps. */
const MAX_EVENTS = 5

/** The gestures that control cooking mode; always listed, even at zero. */
const CONTROL_GESTURES = ['Thumb_Up', 'Thumb_Down', 'Open_Palm']

/** Frames per second actually delivered to the video element. */
function useFrameRate(video: HTMLVideoElement | null, live: boolean): number | null {
  const [fps, setFps] = useState<number | null>(null)

  useEffect(() => {
    if (!video || !live || !('requestVideoFrameCallback' in video)) return
    let frames = 0
    let handle = 0
    const onFrame = () => {
      frames++
      handle = video.requestVideoFrameCallback(onFrame)
    }
    handle = video.requestVideoFrameCallback(onFrame)
    const timer = setInterval(() => {
      setFps(frames)
      frames = 0
    }, 1000)
    return () => {
      video.cancelVideoFrameCallback(handle)
      clearInterval(timer)
    }
  }, [video, live])

  return fps
}

export default function CameraDebug({
  detectionDeps,
  grab,
}: {
  detectionDeps?: DetectionDeps
  grab?: (video: HTMLVideoElement) => Promise<GrabResult>
}) {
  const [tally, setTally] = useState(emptyTally)
  const [events, setEvents] = useState<GestureEvent[]>([])

  // The same hook the controller will use, so this page shows exactly what the app gets.
  const camera = useCamera({
    deps: { detection: detectionDeps, grab },
    onGesture: (e) => setEvents((list) => [e, ...list].slice(0, MAX_EVENTS)),
    onDetection: (d) => setTally((t) => stepTally(t, d)),
  })
  const {
    attachVideo,
    video,
    status,
    error,
    label,
    stream,
    reconnects,
    stalls,
    detection,
    holdProgress,
    handVisible,
    detectionStatus,
    detectionError,
  } = camera
  const live = status === 'live'
  const fps = useFrameRate(video, live)
  const wake = useWakeLock(live)
  const settings = stream?.getVideoTracks()[0]?.getSettings()

  const grabNow = async () => {
    if (!video) throw new GrabError('camera_unavailable')
    return (grab ?? grabSharpestFrame)(video)
  }

  const tallied = [...new Set([...CONTROL_GESTURES, ...Object.keys(tally.hits)])]
  const gestureText =
    !detection || !detection.handPresent
      ? 'No hand'
      : detection.label === 'None'
        ? 'No gesture'
        : detection.label

  return (
    <main className="camera-debug">
      <h1>Hat cam</h1>

      <div className="camera-debug__layout">
        <div className="camera-debug__stage">
          <video
            data-testid="preview"
            className="camera-debug__preview"
            ref={attachVideo}
            autoPlay
            muted
            playsInline
          />
          <HandOverlay landmarks={detection?.landmarks ?? null} />
        </div>

        <div className="camera-debug__side">
          <section className="camera-debug__panel">
            <h2>Stream</h2>
            <dl>
              <dt>Status</dt>
              <dd className={`camera-debug__status camera-debug__status--${status}`}>{status}</dd>
              <dt>Camera</dt>
              <dd>{label ?? '—'}</dd>
              <dt>Resolution</dt>
              <dd>{settings?.width ? `${settings.width} × ${settings.height}` : '—'}</dd>
              <dt>Frame rate</dt>
              <dd>{fps === null ? '—' : `${fps} fps`}</dd>
              <dt>Reconnects</dt>
              <dd data-testid="reconnects">{reconnects}</dd>
              <dt>Freezes fixed</dt>
              <dd data-testid="stalls">{stalls}</dd>
              <dt>Screen kept awake</dt>
              <dd data-testid="awake">{!wake.supported ? 'not supported' : wake.held ? 'yes' : 'no'}</dd>
            </dl>
            {error && <p className="camera-debug__error">{CAMERA_ERROR_MESSAGES[error]}</p>}
          </section>

          <section className="camera-debug__panel">
            <h2>{`Detection: ${live ? detectionStatus : 'waiting for camera'}`}</h2>
            <dl>
              <dt>Gesture</dt>
              <dd data-testid="gesture" className="camera-debug__gesture">
                {gestureText}
              </dd>
              <dt>Score</dt>
              <dd data-testid="score">{detection?.handPresent ? detection.score.toFixed(2) : '—'}</dd>
              <dt>Hand</dt>
              <dd data-testid="hand">{detection?.handPresent ? 'yes' : 'no'}</dd>
            </dl>
            {detectionError && <p className="camera-debug__error">{detectionError}</p>}
          </section>

          <section className="camera-debug__panel">
            <h2>Gestures</h2>
            <p className="camera-debug__hint">Hold a gesture for 1 s to fire it. After a fire, let go before the next one.</p>
            <dl>
              <dt>Hand visible</dt>
              <dd data-testid="hand-visible">{handVisible ? 'yes' : 'no'}</dd>
              <dt>Hold</dt>
              <dd data-testid="hold-text">
                {holdProgress.intent ? `${holdProgress.intent} ${Math.round(holdProgress.progress * 100)}%` : 'nothing held'}
              </dd>
            </dl>
            <progress data-testid="hold" className="camera-debug__hold" max={1} value={holdProgress.progress} />
            {events.length === 0 ? (
              <p className="camera-debug__hint">No gestures fired yet</p>
            ) : (
              <ol className="camera-debug__scores">
                {events.map((e) => (
                  <li key={e.at} data-testid="gesture-event">{`${e.intent} at ${(e.at / 1000).toFixed(1)} s`}</li>
                ))}
              </ol>
            )}
          </section>

          <section className="camera-debug__panel">
            <h2>Attempts (0.7+ score)</h2>
            <p className="camera-debug__hint">Try each gesture 20 times. A held gesture counts once.</p>
            <dl>
              {tallied.map((name) => (
                <div key={name} data-testid={`tally-${name}`} className="camera-debug__row">
                  <dt>{name}</dt>
                  <dd>{tally.hits[name] ?? 0}</dd>
                </div>
              ))}
            </dl>
            <button type="button" onClick={() => setTally(emptyTally())}>
              Reset counts
            </button>
          </section>

          <GrabPanel live={live} grabNow={grabNow} grabForCheck={camera.grabForCheck} />
        </div>
      </div>
    </main>
  )
}
