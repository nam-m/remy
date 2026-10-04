// The seam between the UI and the cooking state (SYSTEM_DESIGN §6). Screens import from here only.
//
// The state, actions, reducer and selectors are Nam's (state.ts, selectors.ts); the controller is his
// createController (controller.ts) plus the voice flow, wired in CookingProvider.tsx.
import type { HatCam } from '../camera/useHatCam.ts'
import type { DetectionStatus } from '../camera/useDetection.ts'
import type { GestureEvent } from '../types.ts'
import type { Controller as FlowController } from './controller.ts'
import type { Action, CookingState } from './state.ts'

export type { GestureEvent, GestureIntent, HoldProgress, Ingredient, ParsedRecipe, Step, Verdict } from '../types.ts'
export type { HatCam } from '../camera/useHatCam.ts'
export type { ShownStep } from './selectors.ts'
export type { Action, AppError as CookingError, CookMode, CookingState, Phase } from './state.ts'
export { AUTO_ADVANCE_MS, MAX_SERVINGS, MIN_SERVINGS } from './state.ts'
export type CookingStats = CookingState['stats']
export type Voicing = CookingState['voicing']

/** The actions screens may dispatch directly. Everything else goes through the controller. */
export type UiAction = Extract<Action, { type: 'recipeTextChanged' | 'screenTapped' | 'errorDismissed' }>

/** Nam's controller, plus the voice retry (the "Try again" button on the prep screen). */
export interface Controller extends FlowController {
  retryVoicing(): void
  onGesture(e: GestureEvent): Promise<void>
}

// ---------- Context (§6.9, §9.5) ----------

/** Whether hand gestures can be read: the hand model loaded, and whether a hand is in view. */
export interface GestureStatus {
  status: DetectionStatus
  error: string | null
  handVisible: boolean
}

/**
 * What useCooking() returns. Read-only state plus the ways to change it.
 * Hold progress updates ~15×/s, so it lives in its own context: read it with useHoldProgress().
 */
export interface CookingContextValue {
  state: CookingState
  controller: Controller
  dispatch: (action: UiAction) => void
  /** The single hat cam (or the default camera with ?cam=any), for <CameraView>. Stable between renders, so hold ticks don't re-render screens. */
  camera: HatCam
  /** Gesture reading, for the "gestures aren't working" note and the dev tag. Changes rarely, unlike hold progress. */
  gestures: GestureStatus
  /** The voice could not be prepared (any error kind), so the prep screen offers "Try again". */
  voiceFailed: boolean
}

export { CookingContext, HoldProgressContext, NO_HOLD, useCooking, useHoldProgress } from './context.ts'

export { DEMO_RECIPE_TEXT } from './demoRecipe.ts'
export { CookingProvider } from './CookingProvider.tsx'
export { canCheck, canStart, currentStep, gesturesEnabled, isLastStep, stepLabel } from './selectors.ts'
export { filledSteps, scaledIngredients } from './uiSelectors.ts'
export type { FilledStep, ScaledIngredient } from './uiSelectors.ts'
