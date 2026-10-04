import { pickHatCam } from './selectHatCam.ts'

export type CameraErrorKind =
  | 'denied'     // camera permission refused
  | 'not_found'  // hat cam not plugged in
  | 'busy'       // another app (Zoom, Photo Booth, FaceTime) holds the camera
  | 'lost'       // the stream ended, e.g. the cable was pulled
  | 'unknown'

export class CameraError extends Error {
  readonly kind: CameraErrorKind
  constructor(kind: CameraErrorKind, message: string = kind) {
    super(message)
    this.name = 'CameraError'
    this.kind = kind
  }
}

const ERROR_KINDS: Record<string, CameraErrorKind> = {
  NotAllowedError: 'denied',
  SecurityError: 'denied',
  NotFoundError: 'not_found',
  NotReadableError: 'busy',
  AbortError: 'busy',
}

function toCameraError(error: unknown): CameraError {
  if (error instanceof CameraError) return error
  const name = error instanceof Error || error instanceof DOMException ? error.name : ''
  return new CameraError(ERROR_KINDS[name] ?? 'unknown', String(error))
}

const stopAll = (stream: MediaStream) => stream.getTracks().forEach((t) => t.stop())

/**
 * Gets camera permission, which is what makes the device labels visible. Opens the default camera
 * once for it; if that one can't be opened (busy, or an iPhone that is out of reach), any other
 * camera will do, because the permission is for all of them. A refusal is final.
 */
async function grantPermission(media: MediaDevices, devices: MediaDeviceInfo[]): Promise<void> {
  const refused = (e: unknown) => toCameraError(e).kind === 'denied'
  try {
    stopAll(await media.getUserMedia({ video: true, audio: false }))
    return
  } catch (first) {
    if (refused(first)) throw first
    for (const device of devices.filter((d) => d.kind === 'videoinput')) {
      try {
        stopAll(await media.getUserMedia({ video: { deviceId: { exact: device.deviceId } }, audio: false }))
        return
      } catch (e) {
        if (refused(e)) throw e
      }
    }
    throw first
  }
}

/**
 * Opens the hat cam and only the hat cam. Device labels are hidden until the
 * page has camera permission, so the first run opens any camera once to get
 * permission, closes it, and looks again.
 */
export async function openHatCam(
  media: MediaDevices = navigator.mediaDevices,
): Promise<{ stream: MediaStream; label: string }> {
  try {
    let devices = await media.enumerateDevices()
    if (devices.every((d) => d.label === '')) {
      await grantPermission(media, devices)
      devices = await media.enumerateDevices()
    }

    const hatCam = pickHatCam(devices)
    if (!hatCam) throw new CameraError('not_found', 'Hat cam (Logitech C270 or C920) not found')

    const stream = await media.getUserMedia({
      audio: false,
      video: {
        deviceId: { exact: hatCam.deviceId },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
    })
    return { stream, label: hatCam.label }
  } catch (error) {
    throw toCameraError(error)
  }
}
