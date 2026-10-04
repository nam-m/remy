// Dev only: says which backend and which camera the running app is using. Both can be swapped by a
// URL flag (?mock, ?cam=any) or an env flag (VITE_MOCK_API) and neither shows anywhere else, so a
// stand-in backend or the wrong camera looks like "the real thing is broken".
import { isMockApi } from '../api/index.ts'
import { USE_ANY_CAMERA } from '../camera/useAnyCam.ts'
import type { CameraErrorKind } from '../camera/openHatCam.ts'
import { useCooking, type HatCam } from '../cooking/contract.ts'

/** What each half of the tag says, and whether it is what the cook (or the demo) expects. */
export function describeSetup(setup: {
  mock: boolean
  anyCam: boolean
  status: HatCam['status']
  error: CameraErrorKind | null
}): { backend: { text: string; ok: boolean }; camera: { text: string; ok: boolean } } {
  const name = setup.anyCam ? 'Laptop camera' : 'Hat cam'
  let state: string = setup.status
  if (setup.status === 'live') state = 'live'
  else if (setup.error === 'not_found') {
    state = setup.anyCam ? 'not found' : "Logitech not found, add ?cam=any to use this laptop's camera"
  } else if (setup.error === 'denied') state = 'blocked in browser settings'
  return {
    backend: { text: setup.mock ? 'Stand-in backend' : 'Real backend', ok: !setup.mock },
    camera: { text: `${name}: ${state}`, ok: setup.status === 'live' },
  }
}

export function DevTag() {
  const { camera } = useCooking()
  const { backend, camera: cam } = describeSetup({ mock: isMockApi(), anyCam: USE_ANY_CAMERA, status: camera.status, error: camera.error })
  return (
    <div className="ui-devtag" role="note" aria-label="Development setup">
      <span className={backend.ok ? 'is-ok' : 'is-off'}>{backend.text}</span>
      <span className={cam.ok ? 'is-ok' : 'is-off'}>{cam.text}</span>
    </div>
  )
}
