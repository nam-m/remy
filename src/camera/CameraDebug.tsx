// Developer page for the camera track, at /?debug=camera.
// Each camera branch adds a panel here so it can be checked on the real hat cam.

import { useEffect, useState } from 'react'
import { CAMERA_ERROR_MESSAGES } from './cameraMessages.ts'
import { countsAsGesture, emptyTally, MIN_SCORE, stepTally } from './gestureTally.ts'
import type { GrabResult } from './grabSharpestFrame.ts'
import { GrabPanel } from './GrabPanel.tsx'
import { HandOverlay } from './HandOverlay.tsx'
import type { Detection } from './recognizer.ts'
import { useDetection, type DetectionDeps } from './useDetection.ts'
import { useHatCam } from './useHatCam.ts'
import './CameraDebug.css'

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

/** Why a reading does or does not count toward the attempts below. */
function countsText(detection: Detection | null): string {
  if (!detection || !detection.handPresent) return 'no, no hand'
  if (detection.label === 'None') return 'no, no gesture recognized'
  if (!countsAsGesture(detection)) return `no, score under ${MIN_SCORE}`
  return 'yes'
}

export default function CameraDebug({
  detectionDeps,
  grab,
}: {
  detectionDeps?: DetectionDeps
  grab?: (video: HTMLVideoElement) => Promise<GrabResult>
}) {
  const { attachVideo, video, status, error, label, stream } = useHatCam()
  const live = status === 'live'
  const [tally, setTally] = useState(emptyTally)
  const fps = useFrameRate(video, live)
  const settings = stream?.getVideoTracks()[0]?.getSettings()

  const {
    detection,
    status: detectionStatus,
    error: detectionError,
  } = useDetection(video, {
    enabled: live,
    deps: detectionDeps,
    onDetection: (d) => setTally((t) => stepTally(t, d)),
  })

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
              <dt>Handedness</dt>
              <dd data-testid="handedness">{detection?.handedness ?? '-'}</dd>
              <dt>Counts?</dt>
              <dd data-testid="counts">{countsText(detection)}</dd>
            </dl>
            {detectionError && <p className="camera-debug__error">{detectionError}</p>}
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

          <GrabPanel video={video} live={live} grab={grab} />
        </div>
      </div>
    </main>
  )
}
