import type { GestureIntent } from '../types.ts'
import type { Detection } from './recognizer.ts'

/** MediaPipe gesture name to what it asks for. */
export type Mapping = Record<string, GestureIntent>

export const MAPPING: Mapping = {
  Thumb_Up: 'next',
  Thumb_Down: 'back',
  Open_Palm: 'check',
}

/** Hour-1 fallback, if thumbs read badly from the hat cam (below about 70% of tries). */
export const FALLBACK_MAPPING: Mapping = {
  Closed_Fist: 'next',
  Victory: 'back',
  Open_Palm: 'check',
}

/** The intent for a MediaPipe gesture name, or null if it asks for nothing. */
export function mapGesture(label: string, mapping: Mapping = MAPPING): GestureIntent | null {
  return Object.hasOwn(mapping, label) ? mapping[label] : null
}

/** The intent for a detection; null with no hand in view. */
export function mapDetection(detection: Detection, mapping: Mapping = MAPPING): GestureIntent | null {
  return detection.handPresent ? mapGesture(detection.label, mapping) : null
}
