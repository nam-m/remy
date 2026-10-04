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

// ---------- Trying another gesture for check ----------
// An open palm is read less reliably from a hat cam, which sees the back of the hand.
// The debug pages take ?check=<gesture> so the options can be compared on the real camera.

/** Every gesture MediaPipe's recognizer can name. */
export const KNOWN_GESTURES = ['Closed_Fist', 'Open_Palm', 'Pointing_Up', 'Thumb_Down', 'Thumb_Up', 'Victory', 'ILoveYou'] as const

const NAMES: Record<string, string> = {
  Open_Palm: 'an open palm',
  Closed_Fist: 'a closed fist',
  Victory: 'a victory sign',
  Pointing_Up: 'a pointing finger',
  ILoveYou: 'the I-love-you sign',
}

/** A gesture said in words, for hints on screen. */
export const gestureName = (label: string): string => (Object.hasOwn(NAMES, label) ? NAMES[label] : label)

/**
 * The mapping with check moved to another gesture; next and back stay on the thumbs.
 * Null for a name that is not a gesture, or for a thumb, which already means next or back.
 */
export function withCheckGesture(label: string, base: Mapping = MAPPING): Mapping | null {
  const known = KNOWN_GESTURES.find((g) => g.toLowerCase() === label.toLowerCase())
  if (!known || known === 'Thumb_Up' || known === 'Thumb_Down') return null
  const mapping: Mapping = {}
  for (const [gesture, intent] of Object.entries(base)) if (intent !== 'check') mapping[gesture] = intent
  mapping[known] = 'check'
  return mapping
}

/** The mapping a debug page uses, from its address: ?check=Victory moves check to a victory sign. */
export function mappingFromSearch(search: string): { mapping: Mapping; checkLabel: string } {
  const asked = new URLSearchParams(search).get('check')
  const mapping = asked ? withCheckGesture(asked) : null
  if (!asked || !mapping) return { mapping: MAPPING, checkLabel: 'Open_Palm' }
  return { mapping, checkLabel: Object.keys(mapping).find((g) => mapping[g] === 'check') ?? 'Open_Palm' }
}
