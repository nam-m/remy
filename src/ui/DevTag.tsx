// Dev only: says which backend and which camera the running app is using. Both can be swapped by a
// URL flag (?mock, ?cam=any) or an env flag (VITE_MOCK_API) and neither shows anywhere else, so a
// stand-in backend or the wrong camera looks like "the real thing is broken".
import { isMockApi } from '../api/index.ts'
import { USE_ANY_CAMERA } from '../camera/useAnyCam.ts'
import type { CameraErrorKind } from '../camera/openHatCam.ts'
import { useCooking, type GestureStatus, type HatCam } from '../cooking/contract.ts'

type Part = { text: string; ok: boolean }

/** What each part of the tag says, and whether it is what the cook (or the demo) expects. */
export function describeSetup(setup: {
  mock: boolean
  anyCam: boolean
  status: HatCam['status']
  error: CameraErrorKind | null
  cooking: boolean
  gestures: GestureStatus
}): { backend: Part; camera: Part; gestures: Part } {
  const name = setup.anyCam ? 'Laptop camera' : 'Hat cam'
  let state: string = setup.status
  if (setup.status === 'live') state = 'live'
  else if (setup.error === 'not_found') {
    state = setup.anyCam ? 'not found' : "Logitech not found, add ?cam=any to use this laptop's camera"
  } else if (setup.error === 'denied') state = 'blocked in browser settings'

  const { gestures } = setup
  let gesture: Part
  if (!setup.cooking) gesture = { text: 'Gestures: start on the cooking screen', ok: true }
  else if (gestures.status === 'error') gesture = { text: `Gestures: failed${gestures.error ? ` (${gestures.error})` : ''}`, ok: false }
  else if (gestures.status === 'loading') gesture = { text: 'Gestures: loading the hand model', ok: false }
  else gesture = { text: gestures.handVisible ? 'Gestures: hand seen' : 'Gestures: ready, no hand in view', ok: true }

  return {
    backend: { text: setup.mock ? 'Stand-in backend' : 'Real backend', ok: !setup.mock },
    camera: { text: `${name}: ${state}`, ok: setup.status === 'live' },
    gestures: gesture,
  }
}

export function DevTag() {
  const { camera, gestures, state } = useCooking()
  const tag = describeSetup({
    mock: isMockApi(),
    anyCam: USE_ANY_CAMERA,
    status: camera.status,
    error: camera.error,
    cooking: state.phase === 'cooking',
    gestures,
  })
  return (
    <div className="ui-devtag" role="note" aria-label="Development setup">
      {[tag.backend, tag.camera, tag.gestures].map(part => (
        <span key={part.text} className={part.ok ? 'is-ok' : 'is-off'}>
          {part.text}
        </span>
      ))}
    </div>
  )
}
