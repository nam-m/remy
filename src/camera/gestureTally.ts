// Counts gesture attempts on the debug page, for the hour-1 test: try each
// gesture 20 times and see how many register.

import { DEFAULT_FILTER_CONFIG } from './gestureFilter.ts'
import type { Detection } from './recognizer.ts'

/** Same threshold the gesture filter uses. */
export const MIN_SCORE = DEFAULT_FILTER_CONFIG.minScore

export interface Tally {
  /** Times each gesture was started: a held gesture counts once. */
  hits: Record<string, number>
  /** Frames each gesture was seen in. */
  frames: Record<string, number>
  /** The gesture being held right now. */
  current: string | null
}

export const emptyTally = (): Tally => ({ hits: {}, frames: {}, current: null })

/** Whether a reading is a real gesture: a hand, a named gesture, and a confident score. */
export function countsAsGesture(d: Detection): boolean {
  return d.handPresent && d.label !== 'None' && d.score >= MIN_SCORE
}

export function stepTally(tally: Tally, d: Detection): Tally {
  if (!countsAsGesture(d)) return tally.current === null ? tally : { ...tally, current: null }

  const started = tally.current !== d.label
  return {
    hits: started ? { ...tally.hits, [d.label]: (tally.hits[d.label] ?? 0) + 1 } : tally.hits,
    frames: { ...tally.frames, [d.label]: (tally.frames[d.label] ?? 0) + 1 },
    current: d.label,
  }
}
