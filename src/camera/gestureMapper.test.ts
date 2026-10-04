import { describe, expect, it } from 'vitest'
import {
  FALLBACK_MAPPING,
  KNOWN_GESTURES,
  MAPPING,
  gestureName,
  mapDetection,
  mapGesture,
  mappingFromSearch,
  withCheckGesture,
} from './gestureMapper.ts'
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

describe('choosing the check gesture', () => {
  it('has the gestures MediaPipe can recognise', () => {
    expect([...KNOWN_GESTURES].sort()).toEqual(
      ['Closed_Fist', 'ILoveYou', 'Open_Palm', 'Pointing_Up', 'Thumb_Down', 'Thumb_Up', 'Victory'].sort(),
    )
  })

  it('moves check to another gesture, keeping next and back', () => {
    expect(withCheckGesture('Victory')).toEqual({ Thumb_Up: 'next', Thumb_Down: 'back', Victory: 'check' })
    expect(withCheckGesture('Closed_Fist')).toEqual({ Thumb_Up: 'next', Thumb_Down: 'back', Closed_Fist: 'check' })
  })

  it('leaves the default alone when asked for the gesture that is already check', () => {
    expect(withCheckGesture('Open_Palm')).toEqual(MAPPING)
  })

  it('accepts the name in any letter case', () => {
    expect(withCheckGesture('victory')).toEqual(withCheckGesture('Victory'))
    expect(withCheckGesture('POINTING_UP')).toEqual(withCheckGesture('Pointing_Up'))
  })

  it.each(['Thumb_Up', 'Thumb_Down', 'None', 'Wave', '', 'toString'])('refuses %j, which cannot be the check gesture', (label) => {
    expect(withCheckGesture(label)).toBeNull()
  })

  it('does not change the mapping it was given', () => {
    const before = structuredClone(MAPPING)
    withCheckGesture('Victory')
    expect(MAPPING).toEqual(before)
  })
})

describe('mappingFromSearch', () => {
  it('uses the default open palm with no option', () => {
    expect(mappingFromSearch('')).toEqual({ mapping: MAPPING, checkLabel: 'Open_Palm' })
    expect(mappingFromSearch('?debug=api')).toEqual({ mapping: MAPPING, checkLabel: 'Open_Palm' })
  })

  it('reads ?check= from the address', () => {
    const { mapping, checkLabel } = mappingFromSearch('?debug=api&check=Victory')
    expect(checkLabel).toBe('Victory')
    expect(mapping.Victory).toBe('check')
    expect(mapping.Open_Palm).toBeUndefined()
  })

  it('normalises the name it reads', () => {
    expect(mappingFromSearch('?check=pointing_up').checkLabel).toBe('Pointing_Up')
  })

  it('falls back to the default for a name it does not accept', () => {
    expect(mappingFromSearch('?check=Wave')).toEqual({ mapping: MAPPING, checkLabel: 'Open_Palm' })
    expect(mappingFromSearch('?check=Thumb_Up')).toEqual({ mapping: MAPPING, checkLabel: 'Open_Palm' })
  })
})

describe('gestureName', () => {
  it.each([
    ['Open_Palm', 'an open palm'],
    ['Closed_Fist', 'a closed fist'],
    ['Victory', 'a victory sign'],
    ['Pointing_Up', 'a pointing finger'],
    ['ILoveYou', 'the I-love-you sign'],
  ])('calls %s %s', (label, words) => {
    expect(gestureName(label)).toBe(words)
  })

  it('falls back to the label itself', () => {
    expect(gestureName('Something_Else')).toBe('Something_Else')
  })
})
