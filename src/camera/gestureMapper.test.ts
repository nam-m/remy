import { describe, expect, it } from 'vitest'
import { FALLBACK_MAPPING, MAPPING, mapDetection, mapGesture } from './gestureMapper.ts'
import type { Detection } from './recognizer.ts'

const detection = (label: string, handPresent = true): Detection => ({
  label,
  score: 0.9,
  handPresent,
  landmarks: handPresent ? [] : null,
})

describe('mapGesture with the default mapping', () => {
  it.each([
    ['Thumb_Up', 'next'],
    ['Thumb_Down', 'back'],
    ['Open_Palm', 'check'],
  ] as const)('maps %s to %s', (label, intent) => {
    expect(mapGesture(label)).toBe(intent)
  })

  it.each(['None', 'Closed_Fist', 'Victory', 'Pointing_Up', 'ILoveYou', '', 'nonsense'])(
    'ignores %s',
    (label) => {
      expect(mapGesture(label)).toBeNull()
    },
  )

  it('does not match inherited object keys', () => {
    expect(mapGesture('toString')).toBeNull()
    expect(mapGesture('constructor')).toBeNull()
  })
})

describe('the fallback mapping, for when thumbs read badly from the hat', () => {
  it.each([
    ['Closed_Fist', 'next'],
    ['Victory', 'back'],
    ['Open_Palm', 'check'],
  ] as const)('maps %s to %s', (label, intent) => {
    expect(mapGesture(label, FALLBACK_MAPPING)).toBe(intent)
  })

  it('no longer reacts to the thumbs', () => {
    expect(mapGesture('Thumb_Up', FALLBACK_MAPPING)).toBeNull()
    expect(mapGesture('Thumb_Down', FALLBACK_MAPPING)).toBeNull()
  })

  it('keeps open palm as check in both mappings', () => {
    expect(MAPPING.Open_Palm).toBe('check')
    expect(FALLBACK_MAPPING.Open_Palm).toBe('check')
  })
})

describe('mapDetection', () => {
  it('maps a detection with a hand', () => {
    expect(mapDetection(detection('Thumb_Up'))).toBe('next')
  })

  it('returns null with no hand, whatever the label says', () => {
    expect(mapDetection(detection('Thumb_Up', false))).toBeNull()
  })

  it('uses the mapping it is given', () => {
    expect(mapDetection(detection('Closed_Fist'), FALLBACK_MAPPING)).toBe('next')
  })
})
