// React contexts behind useCooking() / useHoldProgress(). Any provider (the fake today, Nam's later) fills these.
import { createContext, useContext } from 'react'
import type { HoldProgress } from '../types.ts'
import type { CookingContextValue } from './contract.ts'

/** Hold progress when nothing is being held. */
export const NO_HOLD: HoldProgress = { intent: null, progress: 0 }

/** What the hand model sees right now: a gesture name, how sure it is, and whether any hand is in view. */
export interface DetectionReading {
  label: string
  score: number
  handPresent: boolean
}

export const DetectionContext = createContext<DetectionReading | null>(null)

export const CookingContext = createContext<CookingContextValue | null>(null)
export const HoldProgressContext = createContext<HoldProgress>(NO_HOLD)

/** State, controller, UI dispatch and camera. Throws outside a CookingProvider. */
export function useCooking(): CookingContextValue {
  const value = useContext(CookingContext)
  if (!value) throw new Error('useCooking() must be used inside <CookingProvider>')
  return value
}

/** Which gesture is being held and how far along (0..1). Kept apart so the hold ring doesn't re-render whole screens. */
export function useHoldProgress(): HoldProgress {
  return useContext(HoldProgressContext)
}

/** The live reading from the hand model (null before the first frame). Updates every frame, so only the dev tag reads it. */
export function useDetectionReading(): DetectionReading | null {
  return useContext(DetectionContext)
}
