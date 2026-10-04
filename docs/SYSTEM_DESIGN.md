# Remy system design

Sources, newest first: `src/types.ts` (data shapes), `src/ui/` (the production UI, ported from `src/prototype/remy-ui/VariantD.tsx`), `docs/design/remy-screens.html` (mockups), `docs/PLAN.md` (scope, owners, checkpoints), `docs/adr/0001-single-hat-cam.md`, `CONTEXT.md` (glossary), then `message.txt` and `LETUSCOOK.md`. Where they disagree, the newer source wins; open questions are listed in [Decisions to confirm](#decisions-to-confirm). Terms follow `CONTEXT.md`.

## Contents

1. [Overview and principles](#1-overview-and-principles)
2. [System diagram](#2-system-diagram)
3. [Module map and ownership](#3-module-map-and-ownership)
4. [Shared contract](#4-shared-contract)
5. [Camera track](#5-camera-track-nam)
6. [Cooking state and controller](#6-cooking-state-and-controller-nam)
7. [API client](#7-api-client-nam)
8. [Audio](#8-audio-grace)
9. [UI](#9-ui-grace)
10. [Backend](#10-backend-havier)
11. [End-to-end flows](#11-end-to-end-flows)
12. [Errors](#12-errors)
13. [Testing](#13-testing)
14. [Checkpoints](#14-checkpoints)
15. [Stretch goals](#15-stretch-goals)
16. [File layout](#16-file-layout)
17. [Decisions to confirm](#decisions-to-confirm)

---

## 1. Overview and principles

Everything runs in one Chrome tab on the laptop, deployed on Vercel at heyremy.tech. The hat cam is a single USB stream that sees both the cook's gestures and the food (ADR 0001). Gesture recognition runs locally on every frame, so moving between steps never waits on the network. The network is used for exactly three things: parsing the recipe, checking one snapshot, and generating speech. API keys live only in Vercel functions.

Design principles:

- **As simple as possible.** One input (hand gestures on the hat cam), one AI provider (Gemini), one voice (ElevenLabs). The only in-app fallback is speech: if ElevenLabs fails, the browser's built-in voice reads the text (PLAN must-have 4). Every other failure shows an error and the cook tries again.
- **Pure logic is separate from browsers and the network.** The gesture filter, the cooking reducer and servings scaling are plain functions with no camera, DOM or fetch in them, so they can be unit-tested with fake input.
- **One writer for state.** Only the reducer changes cooking state. Camera, UI and the network send actions; they never edit state.
- **Navigation never touches the network.** Step clips are cached before cooking starts.
- **Amounts are code, not AI.** Gemini returns amounts as numbers at the recipe's original servings and refers to them from steps with `{ingredientId}` placeholders. Scaling and formatting happen in the browser.
- **The cook stays in control.** A `ready` verdict moves on after 2 seconds, but a thumbs-down cancels it. `not_ready` and `unsure` never move the step.

## 2. System diagram

```
                       Logitech hat cam (USB) ── one video stream
                                     │
╔════════════════════════════════════▼═══════ BROWSER (Vite + React + TS) ═════════════╗
║                                                                                      ║
║  CAMERA TRACK (Nam)                                                                  ║
║                    MediaStream  ┌─────────────┐  frame   ┌──────────────────┐       ║
║                   useHatCam────►│ <video> el. ├─────────►│ frameLoop (rAF,  │       ║
║                                 └──────┬──────┘          │ ~15 fps throttle)│       ║
║                                        │                 └────────┬─────────┘       ║
║                                        │                          ▼                 ║
║                                        │                 ┌──────────────────┐       ║
║                                        │                 │ recognizer       │       ║
║                                        │                 │ (MediaPipe wrap) │       ║
║                                        │                 └────────┬─────────┘       ║
║                                        │            raw label+score│                 ║
║                                        │                          ▼                 ║
║                                        │                 ┌──────────────────┐       ║
║                                        │                 │ gestureMapper    │       ║
║                                        │                 │ label → intent   │       ║
║                                        │                 └────────┬─────────┘       ║
║                                        │                  intent?  ▼                 ║
║                                        │                 ┌──────────────────┐       ║
║                                        │                 │ gestureFilter    │       ║
║                                        │                 │ hold 1s, cooldown│       ║
║                                        │                 │ conf ≥ 0.7       │       ║
║  ┌──────────────────┐   hand gone?     │                 └───┬──────────┬───┘       ║
║  │ handPresence     │◄─────────────────┤       GestureEvent  │          │ HoldProgress║
║  └────────┬─────────┘                  ▼                     │          │           ║
║           │                   ┌──────────────────┐           │          │           ║
║           └──────────────────►│ grabSharpestFrame│           │          │           ║
║                               │ burst→score→JPEG │           │          │           ║
║                               └────────┬─────────┘           │          │           ║
║  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│─ ─ ─ ─ ─ │─ ─ ─ ─ ─ ─ ║
║  STATE + CONTROL (Nam)                 │ Blob                ▼          │           ║
║                               ┌────────▼─────────────────────────┐      │           ║
║                               │ cookingController                │      │           ║
║                               │  parseFlow · voiceFlow ·         │      │           ║
║                               │  navigateFlow · checkFlow        │      │           ║
║                               └──┬───────────┬────────────────┬──┘      │           ║
║                          actions │           │ calls          │ plays   │           ║
║                                  ▼           ▼                ▼         │           ║
║                       ┌────────────────┐ ┌─────────────┐ ┌──────────────┐           ║
║                       │ cookingReducer │ │ API client  │ │ audio player │           ║
║                       │ + selectors    │ │ (below)     │ │ (below)      │           ║
║                       │ + scaling      │ └──────┬──────┘ └──────▲───────┘           ║
║                       └───────┬────────┘        │               │                   ║
║  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│─ ─ ─ ─ ─ ─ ─ ─ ─│─ ─ ─ ─ ─ ─ ─ ─│─ ─ ─ ─ ─ ─ ─ ─ ─ ║
║  API CLIENT (Nam)              │                 ▼               │                   ║
║                               │  ┌─────────────────────────────┐ │                   ║
║                               │  │ parseRecipe · checkStep ·   │ │                   ║
║                               │  │ speak  (typed functions)    │ │                   ║
║                               │  ├─────────────────────────────┤ │                   ║
║                               │  │ speakQueue (2 at a time)    │ │                   ║
║                               │  │ http: timeout · abort       │ │                   ║
║                               │  │ errors: ApiError kinds      │ │                   ║
║                               │  └──────────────┬──────────────┘ │                   ║
║  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│─ ─ ─ ─ ─ ─ ─ ─ ┼ ─ ─ ─ ─ ─ ─ ─ ─│─ ─ ─ ─ ─ ─ ─ ─ ─ ║
║  AUDIO + UI (Grace)            ▼                 │               │                   ║
║  ┌───────────────────────────────────────────┐   │  ┌────────────┴─────────────┐     ║
║  │ UI: RecipeInput · PrepReview ·            │   │  │ audio/player             │     ║
║  │ CookingScreen · StepCard · VerdictPopup  │   │  │ clipCache (blob URLs)   │     ║
║  │ DoneScreen ·                            │   │  │  browserSpeech fallback  │     ║
║  │ ServingsStepper · HoldPill · ErrorBanner  │   │  │  unlock (autoplay rule)  │     ║
║  └───────────────────────────────────────────┘   │  └──────────────────────────┘     ║
╚═══════════════════════════════════════════════════│══════════════════════════════════╝
                                                    │ HTTPS: JSON (JPEG as base64) · mp3
╔═══════════════════════════════════════════════════▼══════════ VERCEL FUNCTIONS ═══════╗
║ BACKEND (Havier)  keys: GEMINI_API_KEY · ELEVENLABS_API_KEY                            ║
║                                                                                        ║
║  ┌───────────────┐   ┌───────────────┐   ┌───────────────┐                            ║
║  │ POST /parse   │   │ POST /check   │   │ POST /speak   │   handlers                 ║
║  └───────┬───────┘   └───────┬───────┘   └───────┬───────┘                            ║
║          ▼                   ▼                   ▼                                     ║
║  ┌─────────────────────────────────────┐  ┌───────────────┐                           ║
║  │ prompts/parse · prompts/check       │  │ _lib/eleven-  │                           ║
║  │ _lib/schemas (JSON schema + guards) │  │  labs.ts      │                           ║
║  │ _lib/gemini.ts (call, parse JSON)   │  └───────┬───────┘                           ║
║  └──────────────────┬──────────────────┘          │                                   ║
║  _lib/http (method guard, errors) · _lib/limits (size, length) · _lib/log             ║
╚═════════════════════│═══════════════════════════════│═════════════════════════════════╝
                      ▼                               ▼
               Gemini API (text + vision)      ElevenLabs TTS API
```

Read the diagram in four bands from top to bottom: **camera → control and state → API client and audio/UI → backend**. Dashed lines separate the tracks. The only arrows that cross a track boundary are the ones listed in [Shared contract](#4-shared-contract).

## 3. Module map and ownership

Owners follow `docs/PLAN.md`: Grace has frontend and voice, Havier has AI and backend, and Nam has camera, gestures and wiring gestures to steps (state, controller and API client).

| Module | Track | Owner | Pure? | One-line job |
| --- | --- | --- | --- | --- |
| `camera/useHatCam` | Camera | Nam | no | Open the Logitech stream, expose the `<video>` ref and status |
| `camera/frameLoop` | Camera | Nam | no | rAF loop throttled to about 15 fps |
| `camera/recognizer` | Camera | Nam | no | Wrap MediaPipe; frame in, `{label, score}` out |
| `camera/gestureMapper` | Camera | Nam | **yes** | Map a MediaPipe label to `next` / `back` / `check` |
| `camera/gestureFilter` | Camera | Nam | **yes** | Hold, confidence and cooldown state machine |
| `camera/handPresence` | Camera | Nam | **yes** | Whether a hand has left the frame, debounced |
| `camera/grabSharpestFrame` | Camera | Nam | no | Burst capture, sharpness score, JPEG encode |
| `camera/useGestures` | Camera | Nam | no | Glue hook combining the camera modules |
| `cooking/state` | State | Nam | **yes** | State type, actions, reducer |
| `cooking/selectors` | State | Nam | **yes** | Derived values (current step with amounts filled in, can-check, progress) |
| `cooking/scaling` | State | Nam | **yes** | Scale amounts, format kitchen fractions, fill `{ingredientId}` placeholders |
| `cooking/controller` | State | Nam | no | Runs the flows; the only place with side effects |
| `cooking/CookingProvider` | State | Nam | no | React context wiring controller, state and dispatch |
| `api/http` | API client | Nam | no | `fetch` with timeout and abort |
| `api/errors` | API client | Nam | **yes** | `ApiError` kinds and user-facing messages |
| `api/client` | API client | Nam | no | `parseRecipe`, `checkStep`, `speak` |
| `api/speakQueue` | API client | Nam | no | Concurrency limiter for speech requests |
| `api/mock` + `api/fixtures/` | API client | Nam | no | Dev only: fixture responses so the UI can be built before the backend |
| `audio/player` | Audio | Grace | no | Play clips, stop, unlock |
| `audio/clipCache` | Audio | Grace | no | Blob → object URL store |
| `audio/browserSpeech` | Audio | Grace | no | `speechSynthesis` fallback when a clip is missing |
| `screens/*`, `components/*` | UI | Grace | no | Everything on screen |
| `api/parse`, `check`, `speak` (server) | Backend | Havier | no | HTTP handlers |
| `_lib/gemini`, `_lib/elevenlabs` | Backend | Havier | no | Provider calls |
| `_lib/schemas` | Backend | Havier | **yes** | JSON schemas and runtime validation |
| `prompts/*` | Backend | Havier | **yes** | Prompt text builders |
| `_lib/http`, `_lib/limits`, `_lib/log` | Backend | Havier | partly | Request guards, errors, logging |

"Pure" modules take values and return values, with no browser, no network and no timers, so they get the first unit tests.

## 4. Shared contract

`src/types.ts` is the only file all three tracks import. The server imports the same file (path alias `@shared/types`) so request and response types cannot drift.

The recipe and verdict shapes are already committed:

```ts
export interface Ingredient {
  id: string              // slug used in step placeholders, e.g. "flour" for {flour}
  amount: number | null   // at the recipe's original servings; null for "a pinch", "to taste"
  unit: string | null     // "cup", "tbsp", "g"; null for whole items like eggs
  name: string
}

export interface Step {
  id: number
  text: string            // shown on screen; may contain {ingredientId} placeholders
  spoken: string          // read aloud, "Step 3. Whisk {flour} with {milk} and {egg}."
  cue: string | null      // "Batter is smooth with no dry flour streaks"
  checkable: boolean      // true only when the cue can be judged from a photo
  headsUp: string | null  // "Next step needs a hot pan. Turn it on now."
}

export interface ParsedRecipe {   // POST /api/parse { recipe: string }
  title: string
  servings: number                // what the pasted recipe makes
  ingredients: Ingredient[]
  prep: string[]
  steps: Step[]
}

export interface Verdict {        // POST /api/check { image, cue, step }
  status: 'ready' | 'not_ready' | 'unsure'
  feedback: string                // spoken, under 15 words; includes a fix when not_ready
}
```

To add to `src/types.ts` (not committed yet):

```ts
// ---------- Requests ----------
export type ParseRequest = { recipe: string };
export type CheckRequest = { image: string; cue: string; step: string };  // image: base64 JPEG, no data: prefix
export type SpeakRequest = { text: string };                              // response: audio/mpeg

// ---------- Camera → state ----------
export type GestureIntent = 'next' | 'back' | 'check';
export type GestureEvent = { intent: GestureIntent; at: number };

export type HoldProgress = {
  intent: GestureIntent | null;  // what is being held, null when nothing
  progress: number;              // 0..1, drives the ring
};

// ---------- API errors (client and server agree) ----------
export type ApiErrorKind =
  | 'bad_request'      // 400: input too large or malformed
  | 'unprocessable'    // 422: model output could not be validated
  | 'upstream'         // 502: Gemini or ElevenLabs failed
  | 'rate_limited'     // 429
  | 'timeout'          // client-side only
  | 'aborted'          // client-side only
  | 'unknown';

export type ApiErrorBody = { error: { kind: ApiErrorKind; message: string } };
```

Placeholders are why amounts can scale without AI: a step's `text` and `spoken` hold `{flour}` instead of "1 cup flour", and the browser fills them in at the chosen servings (section 6.7). `api/parse` returns `servings` and `ingredients` from day one, so the servings control (stretch 2) needs no prompt or shape change.

The seams:

| Seam | From → to | What crosses |
| --- | --- | --- |
| A | Camera → controller | `GestureEvent` stream, `HoldProgress` stream, `grabFrame(): Promise<Blob>`, `handVisible` flag |
| B | Controller → API client | Three typed functions (section 7) |
| C | Controller → audio | `play(id)`, `playBlob(blob)`, `say(text)`, `stop()`, `preload(id, blob)` |
| D | State → UI | `CookingState` and selectors, read-only |
| E | API client → backend | The three HTTP endpoints (section 10) |

## 5. Camera track (Nam)

The pipeline is a chain of small stages. Each stage has one input and one output, so any can be tested alone:

```
useHatCam → frameLoop → recognizer → gestureMapper → gestureFilter → GestureEvent
    │                                                      └──► HoldProgress
    └──► grabSharpestFrame ◄── handPresence
```

### 5.1 `useHatCam.ts`

```ts
function useHatCam(): {
  attachVideo: (el: HTMLVideoElement | null) => void;   // callback ref for the <video>
  status: 'connecting' | 'live' | 'reconnecting' | 'busy' | 'error';
  error: 'denied' | 'not_found' | 'busy' | 'lost' | 'unknown' | null;
  reconnects: number;
  stalls: number;
}
```

- Lists cameras with `enumerateDevices()` and opens the Logitech C270 or C920 by USB id (`046d:0825`, `046d:0892`), never any other camera.
- Requests `{ width: 1280, height: 720, frameRate: 30 }` as ideal values.
- **It keeps the camera alive.** If the cable is pulled, `status` becomes `'reconnecting'` and the same camera is reopened as soon as it is listed again (a device change event, backed up by a check every 2 s). If the stream freezes without ending (no frame for 2 s), it is restarted. If another app holds the camera, `status` is `'busy'` and it retries every 2 s. Only a refused camera permission is final (`'error'`).
- A hidden tab is not treated as a freeze, since browsers send it no frames.
- Stops all tracks on unmount. Needs a secure context (`localhost` or heyremy.tech).
- The decisions are in the pure `watchdog.ts`; `keepHatCam.ts` runs them against the camera APIs.

### 5.2 `frameLoop.ts`

```ts
function startFrameLoop(video: HTMLVideoElement, onFrame: (t: number) => void, fps = 15): () => void
```

Runs on `requestAnimationFrame` and calls `onFrame` only when at least `1000 / fps` ms have passed and `video.readyState >= 2`. Returns a stop function.

### 5.3 `recognizer.ts`

```ts
type RawGesture = { label: string; score: number; handPresent: boolean };

function createRecognizer(): Promise<{
  recognize(video: HTMLVideoElement, t: number): RawGesture;
  close(): void;
}>
```

- Loads MediaPipe `GestureRecognizer` in `VIDEO` mode, one hand, from self-hosted files at `/models/gesture_recognizer.task` and `/wasm/`. Self-hosted because venue Wi-Fi is slow.
- Returns `{ label: 'None', score: 0, handPresent: false }` when no hand is found, never `null`, so the stages after it have one input shape.

### 5.4 `gestureMapper.ts` (pure)

```ts
const MAPPING: Record<string, GestureIntent> = {
  Thumb_Up: 'next',
  Thumb_Down: 'back',
  Open_Palm: 'check',
};

// Hour-1 fallback from PLAN.md, if thumbs-up registers below ~70% from the hat cam
const FALLBACK_MAPPING: Record<string, GestureIntent> = {
  Closed_Fist: 'next',
  Victory: 'back',
  Open_Palm: 'check',
};

function mapGesture(raw: RawGesture): GestureIntent | null
```

A label not in the mapping returns `null`. Switching to the fallback changes this file and the gesture icons in the UI (`GestureLegend`, `HoldPill`, the how-to panel). Nothing else changes.

### 5.5 `gestureFilter.ts` (pure)

A state machine that turns noisy per-frame intents into deliberate events. No timers: it gets the timestamp with each sample, so tests feed it fake time.

```ts
type FilterConfig = {
  holdMs: 1000;
  minScore: 0.7;
  cooldownMs: 2000;
  dropToleranceFrames: 3;   // a hand flicker doesn't reset the hold
};

type FilterState =
  | { kind: 'idle' }
  | { kind: 'holding'; intent: GestureIntent; since: number; misses: number }
  | { kind: 'cooldown'; until: number };

function stepFilter(
  state: FilterState,
  sample: { intent: GestureIntent | null; score: number; t: number },
  cfg: FilterConfig,
): { state: FilterState; fire: GestureIntent | null; progress: HoldProgress };
```

Transitions:

| From | Sample | To | Output |
| --- | --- | --- | --- |
| `idle` | intent with score ≥ 0.7 | `holding` since `t` | progress 0 |
| `holding` | same intent, score ≥ 0.7 | `holding` (misses reset to 0) | progress `(t - since) / holdMs` |
| `holding` | same intent, `t - since ≥ holdMs` | `cooldown` until `t + 2000` | **fire** intent, progress 0 |
| `holding` | low score or no hand | `holding` with `misses + 1` | progress held |
| `holding` | misses > 3 | `idle` | progress 0 |
| `holding` | a different valid intent | `holding` on the new intent, `since = t` | progress 0 |
| `cooldown` | any | `cooldown` | progress 0, no fire |
| `cooldown` | `t ≥ until` | `idle` | |

While the controller has gestures disabled (during a check), the filter stays `idle` and drops samples.

**One fire per hold.** Without a further rule, a thumb kept up for 4 seconds would fire twice (hold, 2 s cooldown, hold again) and skip a step. So after a fire, the same gesture must be let go before it can fire again: more than 3 frames in a row without it, at any point after the fire, count as letting go. If it is still held when the cooldown ends, the filter waits (`rearm`) until it is released. A different gesture can start as soon as the cooldown ends. The code is `src/camera/gestureFilter.ts`.

### 5.6 `handPresence.ts` (pure)

```ts
function stepPresence(state: { visible: boolean; lastSeen: number }, present: boolean, t: number)
  : { visible: boolean; lastSeen: number }
```

- A hand counts as gone after 300 ms of no detections, so one dropped frame doesn't look like "hand left".
- The check flow waits on this: after the open palm fires, it waits until `visible` is false, up to 1.5 s, before grabbing the frame. That keeps the palm out of the photo. If the hand is still there, the photo is taken anyway and Gemini can answer `unsure`.

### 5.7 `grabSharpestFrame.ts`

```ts
function grabSharpestFrame(video: HTMLVideoElement, opts?: { frames?: 6; spanMs?: 500; maxSide?: 768 }): Promise<Blob>
```

1. Draw about 6 frames spaced over 0.5 s onto an offscreen canvas at a small size.
2. For each, convert to grayscale and compute the variance of a Laplacian (a standard sharpness score). Higher is sharper.
3. Redraw the sharpest at the output size (long side 768 px) and encode as JPEG at quality 0.8, roughly 80–150 KB.

### 5.8 `useCamera.ts` (the one hook the controller uses)

`useCamera` is seam A. It combines the camera connection (5.1), detection and gestures (5.2 to 5.6, through `useGestures`) and the photo for a check (5.7):

```ts
function useCamera(opts: {
  enabled?: boolean;                    // turn gesture reading off; the camera stays connected
  paused?: boolean;                     // set during a check: gestures cannot fire, the hand is still watched
  onGesture?(e: GestureEvent): void;    // once per completed hold
}): {
  attachVideo: (el: HTMLVideoElement | null) => void;   // put on the <video> that shows the hat cam
  status: 'connecting' | 'live' | 'reconnecting' | 'busy' | 'error';
  holdProgress: HoldProgress;           // for the hold ring
  handVisible: boolean;
  ready: boolean;                       // camera live and gestures being read
  grabForCheck(): Promise<GrabResult>;  // wait for the palm to leave, then the sharpest frame as a JPEG
  // plus label, error, reconnects, stalls, detection, isHandVisible()
}
```

Rules the controller can rely on:

- **Gestures only run while the camera is live.** If the cable drops, any half-held gesture is forgotten and a fresh hold is needed after reconnecting, so nothing fires by surprise.
- **Pausing is not disabling.** While `paused`, no gesture fires, but the hand is still watched. A gesture still held when the pause ends has to be let go before it can fire again, so a palm held through a check does not start a second one.
- **`grabForCheck`** waits up to 1.5 s for the hand to leave the frame, then captures. If the hand is still there it captures anyway (the check can answer "unsure"). It rejects with `camera_unavailable` if the camera is not live, or drops while waiting.
- A gap of more than 500 ms between frames (hidden tab, stalled video) also starts a hold over.

How the controller's check flow uses it: on a `check` gesture it sets `paused`, plays the "Hold still" clip, awaits `grabForCheck()`, sends the JPEG to `/api/check`, and clears `paused` when the verdict is shown.

### Hour-1 test

Film each gesture from the hat cam for 20 s and run it through the MediaPipe demo. If thumbs-up registers below about 70%, switch to `FALLBACK_MAPPING`.

## 6. Cooking state and controller (Nam)

State is split into four files so each has one job:

- `state.ts`: the shape, the actions, and the reducer. **Pure.**
- `selectors.ts`: values computed from state. **Pure.**
- `scaling.ts`: amounts and placeholders. **Pure.**
- `controller.ts`: the flows. The only place that calls the API client or audio player.

### 6.1 State shape

```ts
export type Phase =
  | 'input'       // recipe text box
  | 'parsing'     // waiting on /api/parse
  | 'prep'        // prep screen: ingredients, servings, before-you-start; clips generate in the background
  | 'cooking'     // step-by-step mode
  | 'done';       // after the last step

export type CookMode =
  | 'idle'        // showing a step
  | 'checking'    // palm held; waiting for photo and verdict
  | 'verdict';    // verdict on screen

export type CookingState = {
  phase: Phase;
  recipeText: string;                 // what the user pasted, kept across errors
  recipe: ParsedRecipe | null;
  servings: number;                   // chosen; starts at recipe.servings
  stepIndex: number;                  // 0-based into recipe.steps
  mode: CookMode;                     // only meaningful while phase === 'cooking'
  verdict: Verdict | null;            // set in 'verdict' mode, cleared on any step change
  autoAdvanceAt: number | null;       // set when a 'ready' verdict lands; cleared by 👎 or any step change
  requestId: number;                  // increments per step change or check; stale responses are dropped
  voicing: { ready: string[]; total: number; servings: number };  // clip ids cached for this servings value
  stats: { checks: number; taps: number };   // for the done screen
  error: { kind: ApiErrorKind | 'camera'; message: string } | null;
};
```

Initial state: `phase: 'input'`, `recipeText` set to the preloaded pancake recipe, everything else empty or zero.

`prep` replaces the old `voicing` and `ready` phases. The prep screen shows as soon as parse succeeds, and **Start cooking** turns on once every clip for the current servings is cached.

### 6.2 Actions

| Action | Payload | Effect |
| --- | --- | --- |
| `recipeTextChanged` | text | Update `recipeText` |
| `parseStarted` | | `phase: 'parsing'`, clear error |
| `parseSucceeded` | recipe | `recipe` set, `servings: recipe.servings`, `phase: 'prep'` |
| `parseFailed` | error | `phase: 'input'`, set error (text is kept) |
| `servingsChanged` | n (1..24) | `servings: n`; drops cached ids of step clips that contain a placeholder |
| `voicingStarted` | `{ servings, total }` | `voicing` reset for that servings value |
| `clipReady` | `{ id, servings }` | Adds `id` to `voicing.ready` if `servings` still matches; otherwise ignored |
| `voicingFailed` | error | Stays on `prep`, set error; **Start** stays off until a retry succeeds |
| `startCooking` | | `phase: 'cooking'`, `stepIndex: 0`, `mode: 'idle'` |
| `gestureNext` | | If last step, `phase: 'done'`; else `stepIndex + 1`, `mode: 'idle'`, `verdict: null`, `autoAdvanceAt: null`, `requestId + 1` |
| `gestureBack` | | In `verdict` mode with `autoAdvanceAt` set: only clears `autoAdvanceAt` (stay). Otherwise `stepIndex - 1` (not below 0), `mode: 'idle'`, `verdict: null`, `requestId + 1` |
| `checkStarted` | | `mode: 'checking'`, `verdict: null`, `requestId + 1`, `stats.checks + 1` |
| `checkSucceeded` | `{ requestId, verdict, now }` | If `requestId` matches, `mode: 'verdict'`, `verdict` set, `autoAdvanceAt: now + 2000` when `status === 'ready'`; otherwise ignored |
| `checkFailed` | `{ requestId, error }` | If `requestId` matches, `mode: 'idle'`, set error; otherwise ignored |
| `screenTapped` | | `stats.taps + 1` while cooking |
| `errorDismissed` | | `error: null` |
| `restart` | | Back to `phase: 'input'`, keep `recipeText` |

**The `requestId` rule** keeps slow responses from landing on the wrong step. Every `next`, `back` and new check increments it. A verdict that comes back for an old check carries the old id and is dropped, so a late verdict for step 3 can never appear on step 4.

**The `servings` rule** does the same for clips: a clip generated for 4 servings that finishes after the cook switched to 2 is dropped.

### 6.3 Reducer rules

- `gestureNext`, `gestureBack` and `checkStarted` only apply when `phase === 'cooking'` and `mode !== 'checking'`.
- `checkStarted` only applies when the current step has `checkable: true`.
- `gestureBack` at step 0 is a no-op on the index; the controller still replays the step clip ("Or hear it again" on the how-to panel).
- `servingsChanged` only applies in `prep`. Servings are fixed once cooking starts.
- An action that changes nothing returns the same state object, so React doesn't re-render.

### 6.4 Phase and mode machine

```
        parseStarted           parseSucceeded                       startCooking
 input ───────────► parsing ───────────────► prep ─────────────────────────────► cooking
   ▲                    │ parseFailed          │ ⟲ servingsChanged,                  │
   └────────────────────┘                      │   clipReady, voicingFailed          │
   ▲                                                                                 │
   │ restart                                         ┌── cooking: mode ───────────────┤
   │                                                 │                                │
   │                                  ┌──────────────▼───────────┐                    │
   │                                  │ idle ──checkStarted──► checking ──checkSucceeded──► verdict
   │                                  │  ▲                       │ checkFailed        │    │
   │                                  │  └───────────────────────┘                    │    │
   │                                  │  ▲   gestureNext / gestureBack / auto-advance │    │
   │                                  │  └────────────────────────────────────────────┘    │
   │                                  └──────────────────────────────────────────────────────┘
   │                                                                                 │
   └────────────────────────────────────── done ◄──────── gestureNext on last step ──┘
```

### 6.5 Gesture handling table

| Gesture | `idle` | `checking` | `verdict` |
| --- | --- | --- | --- |
| `next` | Next step, play clip | Ignored | Next step, play clip, verdict cleared ("move on anyway") |
| `back` | Previous step (or repeat on step 1), play clip | Ignored | If a `ready` countdown is running: cancel it and stay. Otherwise previous step, play clip, verdict cleared |
| `check` | If `checkable`, start check flow; otherwise ignored | Ignored | If `checkable`, run another check ("check again" / "try again") |

A verdict never blocks `next`. If the verdict said `not_ready`, the cook can still move on.

### 6.6 `selectors.ts`

```ts
currentStep(s): { text: string; spoken: string; cue; checkable; headsUp } | null   // placeholders filled at s.servings
isLastStep(s): boolean
canCheck(s): boolean              // cooking, idle or verdict, and step.checkable
stepLabel(s): string              // "Step 3 of 8"
scaledIngredients(s): { id; label: string; changed: boolean }[]   // for the prep list
canStart(s): boolean              // phase 'prep' and every clip for s.servings is ready
gesturesEnabled(s): boolean       // cooking and mode !== 'checking'
currentClipId(s): string | null   // the audio clip for the step being cooked, at s.servings
isAutoAdvanceDue(s, now): boolean // a "ready" verdict's 2 s countdown has run out
```

### 6.7 `scaling.ts` (pure)

```ts
function scaleAmount(amount: number | null, factor: number): number | null
function formatAmount(i: Ingredient, factor: number, as: 'screen' | 'spoken'): string
function fillPlaceholders(text: string, ingredients: Ingredient[], factor: number, as: 'screen' | 'spoken'): string
function stepClipId(step: Step, servings: number): string   // "step-3" or "step-3@2" when it has placeholders
```

- `factor = chosen servings / recipe.servings`.
- Screen form rounds to kitchen fractions (⅛ ¼ ⅓ ½ ⅔ ¾). Volumes are worked out in teaspoons and written as the fewest measurable pieces: a clean fraction of a cup (¼ cup or more) stays in cups, otherwise tablespoons and teaspoons, and more than a cup that is not a clean fraction becomes whole cups plus tablespoons. So ¾ cup at half is exactly "6 tbsp", and 1 cup at 1.375 is "1 cup + 6 tbsp". Spoken form says it in words: "six tablespoons of flour", "half a cup of flour". (An earlier example here, "⅓ cup + 1 tbsp", was about 6% too much.)
- Metric amounts round to whole numbers from 10 up and one decimal below. Any other unit (oz, lb) uses kitchen fractions.
- `describeIngredient(i, factor)` returns the screen text, the spoken text, the rounding note and whether the amount changed, in one go; `formatAmount` picks one form.
- Whole items with no unit (eggs) round to whole numbers, never below 1, with a note when the rounding is big ("½ egg rounds to 1 small egg").
- `amount: null` ("a pinch", "to taste") is never scaled.
- Whole items take the singular or plural to match the count ("2 eggs" halved is "1 egg"), so the parse prompt can give a name in either form.
- `{id}` fills in as amount + unit + name ("½ cup flour"). An unknown id is left as the bare name; the server rejects unknown ids, so this shouldn't happen.

### 6.8 `controller.ts`

**Built so far (demo MVP): gestures, steps and checks, with no audio.** The controller is in `src/cooking/controller.ts` with its ports in `ports.ts`. It does the parse, servings, start, navigate, check and auto-advance flows below, and shows everything on screen. Differences from the spec that follows:

- **No audio yet.** There is no `voiceFlow`, no clip cache and no spoken verdict. `canStart` is true as soon as nothing is left to voice, so Start is on straight away. The spec below describes where audio goes back in.
- **The camera port is `{ grabForCheck(): Promise<{ blob }>, isHolding(): boolean }`**, not `grabFrame` plus `handVisible`. `grabForCheck` (from `useCamera`) already waits for the palm to leave the frame, so the controller does not.
- **The ready countdown's pause is kept inside the controller.** While a gesture is being held, it tracks the time held and slides the deadline back by that much; the reducer has no action for it.
- **Pausing gestures during a check is the provider's job**: pass `paused` to `useCamera` while `mode === 'checking'`.

The spec:

The controller subscribes to gesture events and dispatches actions. It owns an `AbortController` for the in-flight check, the auto-advance timer, and references to `grabFrame` and `handVisible`.

```ts
type Controller = {
  submitRecipe(text: string): Promise<void>;   // parseFlow
  setServings(n: number): void;                 // servingsChanged, then voiceFlow (debounced 600 ms)
  start(): void;                                // unlock audio, startCooking, play step 1
  onGesture(e: GestureEvent): void;             // navigateFlow / checkFlow
  restart(): void;
};

function createController(deps: {
  getState(): CookingState;
  dispatch(a: Action): void;
  api: ApiClient;
  audio: AudioPlayer;
  camera: { grabFrame(): Promise<Blob>; handVisible(): boolean; isHolding(): boolean };
  now(): number;
}): Controller
```

Dependencies are passed in, so tests use fakes for `api`, `audio`, `camera` and the clock.

#### `parseFlow(text)`

```
dispatch parseStarted
recipe = await api.parseRecipe(text)            // on error: parseFailed, return
dispatch parseSucceeded(recipe)                  // prep screen shows now
voiceFlow()
```

#### `voiceFlow()`

```
servings = state.servings
clips = fixed clips not cached yet ("looking", "done")
      + for each step: { id: stepClipId(step, servings), text: fillPlaceholders(step.spoken, …, 'spoken') }
        skipping ids already in the cache
dispatch voicingStarted({ servings, total })
await api.speakMany(clips)                       // 2 at a time (speakQueue)
  each success → audio.preload(id, blob); dispatch clipReady({ id, servings })
  any failure  → dispatch voicingFailed           // a "Try again" button calls voiceFlow again
```

Steps without placeholders are voiced once. Steps with placeholders are voiced again only when servings change, and the old run's results are dropped by the servings rule. Changing servings 4 → 2 → 4 reuses the cached clips for 4.

#### `navigateFlow(intent)`

```
abort in-flight check (if any); cancel auto-advance timer; audio.stop()
dispatch gestureNext | gestureBack
audio.play(stepClipId(newStep, servings))        // from cache, no network
```

On the last step, `gestureNext` goes to `done` and the controller plays the "done" clip.

#### `checkFlow()`

```
if !currentStep.checkable: return
dispatch checkStarted ; id = state.requestId    // gestures now disabled
audio.play('looking')                            // "Hold still, let me look…"
await waitUntil(!camera.handVisible(), maxMs=1500)
blob = await camera.grabFrame()                  // 0.5 s burst
verdict = await api.checkStep(blob, step)        // on error: checkFailed, return
if state.requestId !== id: return                // user moved on, drop it
dispatch checkSucceeded({ requestId: id, verdict, now })
audio.speakLive(verdict.feedback)                // ElevenLabs, or browser speech if that fails
if verdict.status === 'ready': startAutoAdvance(id)
```

Gestures are re-enabled when the mode leaves `checking`.

#### Auto-advance

```
startAutoAdvance(id):
  every 100 ms:
    if state.requestId !== id or state.autoAdvanceAt === null: stop     // 👎 or a step change
    if camera.isHolding(): push autoAdvanceAt back by 100 ms            // a hold in progress pauses it
    if now ≥ autoAdvanceAt: navigateFlow('next'); stop
```

The pause matters because a 👎 hold takes 1 s of the 2 s window. Without it, the cook would have to start holding within the first second.

### 6.9 `CookingProvider.tsx`

**Built:** `src/cooking/CookingProvider.tsx` wires `cookingReducer`, `createController`, `useCamera` and `createApi()`. Nam's controller has no audio, so the provider adds Remy's voice around it: the voice flow (2 clips at a time, reusing cached ids), step clips that play when the step changes, "looking" and the spoken verdict when the mode changes, and a keyboard stand-in for gestures (N, B, Space). The context value is `{ state, controller, dispatch, camera, voiceFailed }`: `camera` is a stable slice for `<CameraView>`, `voiceFailed` drives the prep screen's "Try again" for any voicing error, and hold progress is its own context (`useHoldProgress()`, read only by `HoldPill`) so it doesn't re-render screens. Screens read through `src/cooking/contract.ts`, which adds `filledSteps` and `scaledIngredients` (amount and name split) in `uiSelectors.ts`. `useCamera` takes an optional `source`, used for `?cam=any`.

- Creates the reducer with `useReducer`, the controller once with `useMemo`, and wires `useGestures` to `controller.onGesture`.
- Exposes `{ state, controller, holdProgress, camera }` through context, and the hooks `useCooking()` and `useHoldProgress()`.

## 7. API client (Nam)

**Built so far (demo MVP):** `src/api/` has `errors.ts`, `http.ts`, `guards.ts`, `base64.ts`, `client.ts` (`parseRecipe` and `checkStep`), `mock.ts` and `index.ts`. There is no `speak`, `speakMany` or queue, because audio is deferred. `createApi()` returns the real client, or the mock when the URL has `?mock` (`?mock=slow` makes every call take 6 s, `?mock=fail` makes every call fail) or `VITE_MOCK_API=1`. The mock gives the pancake recipe for any text, then verdicts in turn: not ready, unsure, ready. The response guards go a little further than the shapes: a recipe is rejected if a checkable step has no cue, or a step names an ingredient id the recipe does not have.

The API client is the only code in the browser that talks to the backend. The controller sees typed functions, never `fetch`.

```
controller ──► client.ts ──► speakQueue.ts ──► http.ts ──► fetch
                  │                                 │
                  └── mock.ts (dev only)            └── errors.ts
```

### 7.1 `http.ts`

```ts
async function request<T>(path: string, init: RequestInit, opts: { timeoutMs: number; signal?: AbortSignal }, as: 'json' | 'blob'): Promise<T>
```

- Combines the caller's `AbortSignal` with a timeout, so either one aborts the fetch.
- On a non-OK response, reads `ApiErrorBody` and throws `ApiError`; if the body isn't JSON, maps the status code to a kind.
- No retries. A failure goes straight to the UI as an error.

### 7.2 `errors.ts` (pure)

```ts
class ApiError extends Error { kind: ApiErrorKind; status?: number }

function userMessage(e: ApiError): string
function fromStatus(status: number): ApiErrorKind
```

| `kind` | When | Message shown |
| --- | --- | --- |
| `bad_request` | 400 | "That recipe is too long or empty." |
| `unprocessable` | 422 | "I couldn't make sense of that recipe." |
| `upstream` | 502 | "Something went wrong on our side. Try again." |
| `rate_limited` | 429 | "Too many requests, wait a few seconds." |
| `timeout` | client timeout | "That took too long. Try again." |
| `aborted` | user moved on | no message |
| `unknown` | anything else | "Something went wrong." |

### 7.3 `client.ts`

```ts
export interface ApiClient {
  parseRecipe(recipe: string): Promise<ParsedRecipe>;
  checkStep(frame: Blob, step: { text: string; cue: string }, opts?: { signal?: AbortSignal }): Promise<Verdict>;
  speak(text: string): Promise<Blob>;
  speakMany(items: { id: string; text: string }[], onEach: (id: string, blob: Blob) => void): Promise<void>;
}
```

| Method | Endpoint | Timeout | Notes |
| --- | --- | --- | --- |
| `parseRecipe` | `POST /api/parse` `{ recipe }` | 20 s | Trims the text and refuses over 10,000 characters before sending |
| `checkStep` | `POST /api/check` `{ image, cue, step }` | 8 s | Encodes the JPEG as base64 (no `data:` prefix); `step` is the filled-in step text. Aborted if the cook changes step |
| `speak` | `POST /api/speak` `{ text }` | 6 s | Returns an `audio/mpeg` `Blob` |
| `speakMany` | many `/api/speak` | per item | Through the queue; rejects on the first failure |

The client checks response shapes with small guards (`isParsedRecipe`, `isVerdict`) and throws `unprocessable` if they don't match.

### 7.4 `speakQueue.ts`

```ts
function createQueue(concurrency = 2): <T>(task: () => Promise<T>) => Promise<T>
```

Runs at most 2 speech requests at a time, FIFO, so ElevenLabs free-tier concurrency limits don't throw 429 during the burst after parsing.

### 7.5 Dev mock (`mock.ts`, `fixtures/`)

For development only, so Grace and Nam can build before the backend exists. With `VITE_MOCK_API=1` the client returns `pancakes.recipe.json` (serves 4, with placeholders), `verdict.ready.json` / `verdict.notReady.json` / `verdict.unsure.json`, and a short `silence.mp3` after a fake delay. Never used in the demo build.

## 8. Audio (Grace)

```
controller ──► player.ts ──► clipCache.ts ──► <audio> element
                  ├──► browserSpeech.ts ──► speechSynthesis   (fallback)
                  └──► unlock()  (autoplay rule)
```

### 8.1 `clipCache.ts`

```ts
function put(id: string, blob: Blob): void       // creates an object URL
function get(id: string): string | null
function has(id: string): boolean
function clear(): void                           // revokes all URLs (on restart)
```

Ids: `step-<id>` for steps without placeholders, `step-<id>@<servings>` for steps with them, `looking`, `done`.

### 8.2 `player.ts`

```ts
interface AudioPlayer {
  unlock(): Promise<void>;                 // call from the Start button click
  preload(id: string, blob: Blob): void;
  play(id: string, fallbackText?: string): Promise<void>;   // cached clip, or browser speech if missing
  playBlob(blob: Blob): Promise<void>;
  speakLive(text: string): Promise<void>;  // api.speak → playBlob; on failure, browser speech
  stop(): void;                            // stops both <audio> and speechSynthesis
}
```

Rules:

- **One voice at a time.** Every `play`, `playBlob` and `speakLive` first calls `stop()`, so a quick next-next never layers two clips.
- **Autoplay unlock.** Browsers block audio until a click. `unlock()` plays a silent clip inside the Start click handler; after that, playback triggered by a gesture works.
- **Browser speech fallback** (PLAN must-have 4). If a clip is missing or a live verdict's speech request fails, `browserSpeech.say(text)` reads it with `speechSynthesis`, using an English voice picked once at startup. It sounds worse but keeps cooking mode hands-free.

## 9. UI (Grace)

The screens follow prototype D (`src/prototype/remy-ui/VariantD.tsx`, at `/prototype`), which replaces `docs/design/remy-screens.html` for look, copy and motion. Production code ports it into `src/ui/` and never imports from `src/prototype/`. Welcome and prep are light (cream, sand) for the laptop with clean hands. Cooking mode uses deep per-step colour fields, read from 2 m with no glare.

### 9.1 Visual tokens (from prototype D)

| Token | Value | Use |
| --- | --- | --- |
| `--ink` / `--cream` | `#1D1B20` / `#FFF7EA` | Text, borders, hard shadows / page and light text on dark fields |
| `--brand` | `#F4905F` | Primary buttons, welcome headline |
| `--umber` / `--cocoa` | `#541B05` / `#73462F` | Welcome left panel, bold amounts / muted text, ticked checklist items |
| `--sand` / `--blush` | `#EDCEBA` / `#E3BEB2` | Welcome right panel, chips, stepper, camera placeholder / cocoa step accent |
| `--apricot` / `--clay` / `--sage` / `--slate` | `#DE9762` / `#BE7463` / `#657167` / `#2F3341` | Step fields, checklist boxes, parsing field (slate), done field (sage) |
| `--pink` | `#F6B3BC` | v5 accent: catch tag, welcome badge, scan line, ✋ when checkable, loader blob |
| `--sparkle` | `#FFD84D` | `ready` burst, done badge, ✦ marks |
| `--ready` / `--notyet` / `--unsure` | `--sage` / `--clay` / `--stone` | The three verdict fields (`--stone` is `#9F9593`) |
| Font | M PLUS 2 (400–900, Google Fonts) | Everything; headings 800, verdict feedback 900 |
| `--spring` / `--bouncy` | M3 Expressive springs as CSS `linear()` | Movement (carousel, buttons) / hero pops (verdict, number badges, ticks) |

Step fields cycle every 6 steps; each has a card colour, a deeper page backdrop, text and accent:

| # | Card | Backdrop | Text | Accent |
| --- | --- | --- | --- | --- |
| 1 | `#541B05` | `#2A0D02` | cream | `#DE9762` |
| 2 | `#657167` | `#343B35` | cream | `#EDCEBA` |
| 3 | `#2F3341` | `#181A22` | cream | `#F4905F` |
| 4 | `#BE7463` | `#5E3127` | ink | cream |
| 5 | `#73462F` | `#3A2317` | cream | `#E3BEB2` |
| 6 | `#DE9762` | `#6E4325` | ink | `#541B05` |

Two fields fail WCAG AA for large text: sage (#2.13:1) and cocoa (2.87:1), both with cream text, against the 3:1 the 38 px step text needs. Prototype D was tuned at arm's length and §9.4 says the cook reads from 2 m. `src/ui/fields.test.ts` records the measured ratios so they cannot drift further; darkening those cards is a palette decision and is not made here.

Surfaces are flat with a 2 px ink border and a hard offset shadow (`4px 4px 0 var(--ink)`); buttons are pills that squash on press. Shapes (`shapes.ts`) are M3 Expressive clip-path polygons (cookie, clover, sunny, square, burst) that can morph into each other. A shield rule resets the Vite starter's global `h1`/`h2`/colour styles. `prefers-reduced-motion` turns off every animation and transition.

### 9.2 Screens

| Screen | Shown when | Contents |
| --- | --- | --- |
| `RecipeInput` | `phase` is `input` or `parsing` | **Input:** two even panels. Left (umber): REMY logo, pink catch tag “Hey Remy, let's cook!”, headline "Cook it. Don't touch it.", one-line pitch, gesture hint chips (👍 next · 👎 back · ✋ is it ready?). Right (sand): `RemyBadge` (pink, sunny) with a bubble (`SAY.hello`, `SAY.ask`), textarea, **Let's cook!** and **Try the pancake demo**. **Parsing:** full slate field with `RemyLoader` (`SAY.reading`) and a three-line ticker (Finding ingredients · Moving hidden prep up front · Writing what "done" looks like). `ErrorBanner` |
| `PrepReview` | `phase` is `prep` | Cream page, top bar with logo and a chip ("6 steps, about 25 minutes"). Left: white recipe card with `RemyBadge` (apricot, cookie), title, `ServingsStepper`, `IngredientList`. Right: "Before you start" `PrepChecklist`, then the camera setup check (`CameraView` "Remy's view" + "Can Remy see your bowl? Look down at it and check it's in the window."), Remy's head with a bubble (`SAY.prep`), full-width **Remy, let's cook!** (on when `canStart`), `VoicingProgress` |
| `CookingScreen` | `phase` is `cooking` | Page backdrop is the current step's field, cross-fading 0.6 s; the content rises in from below on entry. Top bar: logo and `StepProgress`. A step-card carousel: every `StepCard` sits on one horizontal track (70vw cards, 32 px gap, 9vw lead) that slides on `--spring`; the current card is full size, the others 40 % opacity at 0.9 scale. Bottom left: Remy's head with a bubble (`SAY.go` on step 1, `SAY.headsUp` before a heads-up, then the step text; `SAY.look` while checking). Bottom right: `GestureLegend`. `HoldPill`, and `VerdictPopup` over the foot of the screen (Remy's line and the legend step aside while it is up). The check happens inside the current card; there is no separate looking overlay or camera thumbnail, and the verdict never covers the camera |
| `DoneScreen` | `phase` is `done` | Sage field, `RemyBadge` (sparkle, burst) with a bubble (`SAY.done`, "Pancakes are done.", stats line from `state.stats`), cream **Let's cook something else!** |

### 9.3 Components

| Component | Props | Notes |
| --- | --- | --- |
| `ServingsStepper` | `servings`, `original` | − **4 servings** + pill on sand, round white buttons. Stretch 2: until then, show the number without buttons |
| `IngredientList` | `scaledIngredients` | Four-column grid of tiles: `IngredientArt` drawing on a tint of its colour, amount in bold umber, name below; tiles drop in staggered by 50 ms. Amounts that differ from the recipe get a `--brand` highlight; rounding note below ("½ egg rounds to 1 small egg") |
| `PrepChecklist` | `items` | Tickable rows, each with a box in the next of apricot, clay, sage, slate; a tick fills the box with a bouncy tilt and strikes the row through. Ticks are local UI state only |
| `CameraView` | `cam`, `primary`, `caption` | Live hat-cam window with a status dot and caption ("Remy's view", Connecting…, Reconnecting…, Hat cam offline) and the `cameraMessages` error text. One `useHatCam()` per tree (`useAnyCam` for `?cam=any`); only the `primary` view registers for freeze detection, others reuse the stream. 4:3 with an apricot ring in prep; 16:9 inside `StepCard` |
| `StepProgress` | `index`, `total` | One dot per step: done (cream 60 %), current (36 px pill in the step accent), upcoming (cream 25 %) |
| `StepCard` | `step`, `index`, `current`, `checking` | Card in its step field, 40 % text and 60 % camera. Text side: step number in a rotating M3 shape in the accent (it straightens when current), step text 38 px weight 800, `HeadsUpBanner`, `CueChip`. Camera side: the card colour fades into the current `CameraView`, whole and uncropped (exactly the frame Remy judges) inside a 7 px accent bezel, with "Keep the bowl inside the picture, then show ✋." on checkable steps. Other cards show a striped ghost window. **Checking:** text dims to 18 %, other cards to 15 %, a pink scan line sweeps inside the picture, and `RemyFlipbook pose="stir"` slides in beside the camera |
| `CueChip` | `cue` | "✋ Ready when: **smooth, no dry flour streaks**"; only on checkable steps |
| `HeadsUpBanner` | `text` | Block in the step accent with 🔥, inside the card; hidden when null |
| `HoldPill` | `HoldProgress` | Ring plus "Keep holding… next step"; icon by intent; fades out when idle |
| `GestureLegend` | `canCheck` | Segmented pill group "👎 back · ✋ is it ready? · 👍 next"; next is the solid cream segment; ✋ is pink when `canCheck`, 35 % opacity otherwise |
| `SpeechBubble` | `children`, `small` | White bubble, ink border, hard shadow, tail pointing at Remy on the left; bold lines in umber |
| `VerdictPopup` | `verdict`, `autoAdvanceAt` | A popup card in the verdict's field, centred over the foot of the screen (up to 1000 px wide), springing up on `--bouncy`. The step card and its camera stay in view above it, so the cook can see the picture Remy judged and re-frame it. A 140 px spinning shape with Remy, the catchline (`SAY.verdict`, with ✦) and the feedback at about 34 px weight 900. Three variants, below; stays until the next gesture |
| `ErrorBanner` | `error` | One line at the top with a dismiss button |
| `VoicingProgress` | `ready`, `total` | "Preparing voice… 4/10" near the Start button, with a **Try again** button after `voicingFailed` |

`VerdictPopup` variants:

| `status` | Field | Hero | Catchline | Footer |
| --- | --- | --- | --- | --- |
| `ready` | `--ready` | Sparkle burst, three twinkling ✦, `RemyFlipbook pose="cheer"` | "Oui, chef!" | "Moving on in 2 seconds · 👎 to stay", with a countdown bar |
| `not_ready` | `--notyet` | Translucent clover, Remy's head rocking | "Almost, chef!" | "✋ check again whenever you like · 👍 move on anyway" |
| `unsure` | `--unsure` | Translucent square, Remy's head rocking | "Hmm, my whiskers can't see that" | "✋ try again · 👍 move on anyway" |

Remy appears in three forms (assets in `public/remy/`):

| Form | What it is | Where |
| --- | --- | --- |
| `RemyBadge` | Head rocking (3.2 s) over a shape that breathes (2.4 s), so the two never sync | Wherever Remy is just present: welcome, prep card, done |
| `RemyFlipbook` | Two-frame flipbook of the full mascot; `pose` (`idle`, `wave`, `stir`, `cheer`) sets the flip speed, `cheer` also hops | Only when Remy is doing something: stirring while checking, cheering on `ready`, inside `RemyLoader` |
| Head image | Static head | Logo, bubble avatars, non-`ready` verdict heroes |

Catchphrases live in one `SAY` table so speech can reuse them: `hello` "Hey, I'm Remy! Let's cook!", `ask` "What are we making today, chef?", `reading` "Sniffing out the steps…", `prep` "Mise en place, chef! Ready when you are.", `go` "Remy ready! Aprons on.", `look` "Whiskers on it… hold still!", `verdict` (above), `headsUp` "Psst, chef!", `done` "Bon appétit, chef!".

### 9.4 Design rules

- One action per gesture, and the screen shows what the last gesture did within 100 ms.
- Never more than one line of extra text besides the step and Remy's bubble; the cook is 2 m away with messy hands.
- States use colour **and** an icon or word, so they work in poor kitchen lighting.
- The camera window is always the exact frame Remy judges: uncropped (`object-fit: contain`), and the scan stays inside it.
- `CookingScreen` sends `screenTapped` on any pointer down, for the done-screen count.

### 9.5 Reading state

Components read through `useCooking()` and `useHoldProgress()` only. `holdProgress` updates about 15 times per second and is kept in its own context so the rest of the screen doesn't re-render with it.

## 10. Backend (Havier)

```
request ─► handler ─► _lib/http (guard) ─► _lib/limits ─► prompt builder ─► provider call ─► _lib/schemas ─► response
                                                                                  │
                                                                                  └─► _lib/log
```

Environment variables, set in Vercel only (and `env/.env.local` for development): `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`. The ElevenLabs voice ID isn't secret and lives as a constant in `_lib/elevenlabs.ts`. Nothing with a key gets a `VITE_` prefix, since those are bundled into the browser.

### 10.1 `_lib/http.ts`

- `guard(req, { method, contentType })`: rejects wrong methods (405) and content types (415).
- `sendError(res, kind, message)`: writes an `ApiErrorBody` and the matching status.
- `sendJson(res, body)` and `sendAudio(res, buffer)`: set headers, including `Cache-Control: no-store`.

### 10.2 `_lib/limits.ts`

| Limit | Value |
| --- | --- |
| `/parse` recipe length | 10,000 characters |
| `/check` image | 1 MB decoded, JPEG only (checked by magic bytes); request body 1.5 MB |
| `/check` cue and step text | 300 characters each |
| `/speak` text length | 300 characters |

### 10.3 `_lib/schemas.ts` (pure)

- The JSON schema passed to Gemini as `responseSchema` for `ParsedRecipe` and for `Verdict`.
- `validateRecipe(x)` fixes small issues: re-numbers step ids from 1, trims strings, forces `checkable: false` when `cue` is null, makes ingredient ids unique slugs, defaults `servings` to 1 when missing.
- It rejects real problems with a 422: no steps, over 40 steps, empty text, `servings` not a positive number, a placeholder in `text` or `spoken` that names no ingredient, or different placeholders in `text` and `spoken`.
- `validateVerdict(x)` cuts `feedback` to 15 words and rejects a `status` outside the three values.

### 10.4 `_lib/gemini.ts`

```ts
function generateJson(opts: {
  system: string;
  parts: (string | { inlineData: { mimeType: string; data: string } })[];
  schema: object;
  temperature: number;
  timeoutMs: number;
}): Promise<unknown>
```

Calls a Gemini Flash model with `responseMimeType: 'application/json'` and the schema. Throws `upstream` on any failure. Logs latency, never the image or the full recipe. The check image goes straight into `inlineData.data`, since the client already sends base64.

### 10.5 `_lib/elevenlabs.ts`

```ts
function synthesize(text: string): Promise<Buffer>
```

One fixed voice, a low-latency model, `mp3_44100_64` output (small files, quick to download). Timeout 5 s. Throws `upstream` on failure and `rate_limited` on a 429.

### 10.6 `prompts/parse.ts` and `prompts/check.ts` (pure)

**Parse prompt rules:**

1. Move hidden prep (preheat, soften, thaw, bring to room temperature) into `prep`.
2. Add a `headsUp` on the step *before* something is needed, such as a hot pan.
3. **Never delete a step and never change an amount.**
4. Each step is one action, under about 20 words.
5. `servings` is what the recipe says it makes; if it doesn't say, give a best estimate.
6. Each ingredient gets a short slug `id`, a numeric `amount` at the original servings (½ → 0.5), a `unit`, and a `name`. Use `amount: null` for "a pinch" or "to taste", and `unit: null` for whole items.
7. Wherever a step uses an amount, write `{id}` instead of the amount, unit and name. Use the same placeholders in `text` and `spoken`.
8. `cue` states what "done" looks like. `checkable` is true only when a camera could judge it (colour, texture, bubbles, thickness), and false for taste, smell, time or temperature.
9. `spoken` starts with "Step N." and is written to be said aloud.
10. Return only JSON matching the schema.

**Check prompt rules:**

1. Judge only against `cue`. `step` is context.
2. If the food isn't clearly visible (blurred, blocked, a hand in the way, too dark, no bowl), return `unsure` with feedback that says what to fix ("Look down at the bowl and hold still."). **Never guess `ready`.**
3. `not_ready` feedback says what's missing and what to keep doing ("Still some dry flour streaks. Keep whisking.").
4. `ready` feedback confirms and moves on ("Smooth batter. On to the next step.").
5. Feedback is under 15 words and sounds natural spoken.
6. Temperature 0.2.

### 10.7 Endpoints

#### `POST /api/parse`

| | |
| --- | --- |
| Request | `application/json`: `{ "recipe": string }` |
| Success | `200` `ParsedRecipe` |
| Errors | `400` empty or too long · `422` model output failed validation · `502` Gemini failed · `429` |
| Typical latency | 3–8 s |

```json
// request
{ "recipe": "Fluffy pancakes (serves 4)\n1 cup flour, 2 tbsp sugar, … ¾ cup milk, 1 egg, 2 tbsp butter, melted\nWhisk the dry ingredients…" }

// response (shortened)
{
  "title": "Fluffy pancakes",
  "servings": 4,
  "ingredients": [
    { "id": "flour", "amount": 1, "unit": "cup", "name": "flour" },
    { "id": "milk", "amount": 0.75, "unit": "cup", "name": "milk" },
    { "id": "egg", "amount": 1, "unit": null, "name": "egg" }
  ],
  "prep": ["Take the egg and milk out of the fridge", "Melt the butter", "Get out a pan, whisk and ladle"],
  "steps": [
    { "id": 3, "text": "Whisk in {milk}, {egg} and {butter} until smooth.",
      "spoken": "Step 3. Whisk in {milk}, {egg} and {butter} until smooth.",
      "cue": "Smooth, no dry flour streaks", "checkable": true, "headsUp": null }
  ]
}
```

#### `POST /api/check`

| | |
| --- | --- |
| Request | `application/json`: `{ "image": base64 JPEG, "cue": string, "step": string }` |
| Success | `200` `Verdict` |
| Errors | `400` bad image or missing field · `415` not JSON · `422` · `502` · `429` |
| Typical latency | 1.5–4 s |

```json
{ "status": "not_ready", "feedback": "Still some dry flour streaks. Keep whisking." }
```

#### `POST /api/speak`

| | |
| --- | --- |
| Request | `application/json`: `{ "text": string }` |
| Success | `200` body `audio/mpeg` |
| Errors | `400` · `502` · `429` |
| Typical latency | 0.5–2 s |

All error responses share the `ApiErrorBody` shape from the contract.

### 10.8 `_lib/log.ts`

One line of JSON per request: route, status, latency, model latency, and for `/check` the verdict status. No recipe text, no images, no keys. Useful for the "what breaks first" Q&A answer and for tuning during polish.

## 11. End-to-end flows

| Flow | Path | Target |
| --- | --- | --- |
| **Parse** | Make it cookable → `parseFlow` → `/api/parse` → prep screen → `/api/speak` per step (2 at a time) → Start enabled | prep screen after about 5 s; Start within 15 s for an 8-step recipe |
| **Servings** | − / + → step text and list update at once → step clips with placeholders re-voiced (debounced 600 ms) → Start enabled again | list updates instantly; Start back within about 5 s |
| **Navigate** | Gesture held 1 s → filter fires → controller → reducer → cached clip plays | under 100 ms after the hold completes, no network |
| **Check** | Palm held 1 s → "Hold still" clip → hand leaves frame (max 1.5 s) → 0.5 s burst → `/api/check` → verdict overlay → `/api/speak` → verdict spoken → if `ready`, next step after 2 s | spoken verdict within about 5 s of the palm |

Check flow as a sequence:

```
User     filter     controller        camera        api client     backend     audio
 │ palm ───►│           │                │               │            │          │
 │ (1 s)    │─ fire ───►│                │               │            │          │
 │          │           │ checkStarted   │               │            │          │
 │          │           │─ play('looking') ──────────────────────────────────────►│
 │ hand away│           │◄─ handVisible=false            │            │          │
 │          │           │─ grabFrame() ─►│ burst+score   │            │          │
 │          │           │◄──── Blob ─────│               │            │          │
 │          │           │─ checkStep(base64, cue) ──────►│─ POST ────►│ Gemini   │
 │          │           │◄──────────────── Verdict ──────│◄───────────│          │
 │          │           │ checkSucceeded (if requestId matches)       │          │
 │          │           │─ speakLive(feedback) ──────────►│─ POST ────►│ 11Labs  │
 │          │           │─ playBlob(mp3) ────────────────────────────────────────►│
 │          │           │ ready? start 2 s countdown; 👎 cancels                  │
```

## 12. Errors

Speech has one fallback: the browser's voice. Every other failure ends in an error message, and the cook retries the action.

| Failure | Detected in | What the user sees | State change |
| --- | --- | --- | --- |
| Hat cam not found or unplugged | `useHatCam` | "Camera not found. Plug in the hat cam and reload." | `error` (camera) |
| MediaPipe fails to load | `recognizer` | "Gestures couldn't load. Reload the page." | `error` (camera) |
| Gesture false positives | `gestureFilter` | Ring fills and resets without firing | none |
| `/api/parse` fails | `client.parseRecipe` | Back on input, text kept, error banner; press the button again | `parseFailed` |
| A step clip fails | `speakMany` | Error on the prep screen, **Try again** next to Start | `voicingFailed` |
| A clip is missing during cooking | `player.play` | Step read by the browser voice | none |
| `/api/check` fails or times out | `controller.checkFlow` | "Couldn't check that. Try again." | `checkFailed`, mode `idle` |
| Food not visible in the photo | Gemini | `unsure` verdict: "Look down at the bowl and hold still." | `checkSucceeded` |
| Verdict speech fails | `player.speakLive` | Verdict read by the browser voice | none |
| User moves on during a check | `requestId` | Nothing; late response dropped | none |
| Servings change mid-voicing | `servings` rule | Nothing; old clips dropped, new ones generated | none |

Outside the app (ADR 0001 and PLAN): if the hat rig fails, the same camera goes on a tripod angled at the pan. A backup screen recording of the full flow is ready for the demo.

## 13. Testing

| What | How | Owner |
| --- | --- | --- |
| `gestureFilter` | Unit tests with scripted samples: hold, flicker, cooldown, switching intent | Nam |
| `gestureMapper`, `handPresence` | Unit tests | Nam |
| `scaling` | Unit tests: halving ¾ cup → "6 tbsp", cup, tablespoon and teaspoon splits, metric, eggs rounding, `null` amounts, spoken form, unknown ids, and a sweep that no amount ever prints NaN or undefined | Nam |
| `cookingReducer` | Unit tests for every action, including stale `requestId`, stale `servings` clips, 👎 cancelling auto-advance, ignored gestures in `checking` | Nam |
| `controller` | Tests with fake `api`, `audio`, `camera` and clock, including auto-advance pausing during a hold | Nam |
| `schemas` (server) | Unit tests with malformed model output, off-by-one ids, unknown placeholders, over-long feedback, bad `status` | Havier |
| `/api/check` quality | Script runs a folder of 10+ labelled batter photos (lumpy, smooth, blurred, hand in frame) and prints accuracy per status | Havier |
| `/api/parse` quality | Run 5+ real recipes; check that no step is dropped, amounts match the original, and every amount is a placeholder | Havier |
| UI states | Dev mock with fixtures, one per mockup screen | Grace |
| Whole flow | A scripted 90-second run at the table, repeated until it works 5 times in a row | everyone |

Test runner: Vitest (add it as a dev dependency; it works with the existing Vite config). Pure modules first; the rest only if time allows.

## 14. Checkpoints

From `docs/PLAN.md` (10-hour hackathon). All tracks start at once against the shared types and the dev mock.

| Hour | Done when | Camera (Nam) | State + API client (Nam) | UI + audio (Grace) | Backend (Havier) |
| --- | --- | --- | --- | --- | --- |
| 0–0.5 | App deployed to Vercel, heyremy.tech pointed at it, hat rig taped up | Hat rig; hour-1 gesture test | Contract additions in `types.ts`; fixtures | Vercel deploy, domain | Gemini check of a lumpy and a smooth photo |
| 0.5–3 | Each track works alone | `useHatCam`, `recognizer`, gestures logged | Reducer, `scaling`, controller with fakes | `RecipeInput`, `PrepReview`, `CookingScreen` with hardcoded steps | `/api/parse` returns JSON, `/api/check` judges a test photo, `/api/speak` |
| 3 | Integration | Gestures move through steps | `parseFlow`, `voiceFlow` on real endpoints | ElevenLabs speaks steps; browser fallback | |
| 5 | Full flow on the deployed URL: paste → steps → gesture → open palm → spoken verdict | `grabSharpestFrame`, `handPresence` | `checkFlow`, auto-advance | `StepCard`, `VerdictPopup`, `HoldPill` | |
| 5–7.5 | Prompts tuned, UI polish, stretch if hour 5 landed on time, backup video | Framing and lighting | Error messages | Type sizes from 2 m, `DoneScreen` | Prompt tuning on 10+ photos and 5+ recipes |
| 7.5 | Feature freeze, known-good build tagged | | | | |
| 7.5–10 | Demo-path fixes only, README with AI disclosure, cooking footage | | | | |

If hour 5 slips, cut the stretch goals and polish, never the check.

Git: `main` always deploys. One short branch per task (`grace/cooking-screen`), merged by PR within about an hour.

## 15. Stretch goals

None of these are needed for the demo, and each can be added without changing the core modules. Order from PLAN; if auto-check looks risky at hour 5, do servings first.

### 15.1 Auto-check

On a checkable step in `idle` mode, run `checkFlow` every 4 s without the "looking" clip or overlay, and speak only when `status === 'ready'`. A `ready` result then follows the normal auto-advance (2 s, 👎 to stay). Stopped by any gesture or step change. Costs one Gemini vision call every 4 s, so watch the quota.

### 15.2 Servings (about 1–1.5 h)

Most of the work is already in the core: `servings` and `ingredients` come from `/api/parse`, `scaling.ts` fills placeholders, and `voiceFlow` re-voices steps on a change. What's left:

- `ServingsStepper` buttons on `PrepReview` that call `controller.setServings`.
- Amber highlighting for changed amounts and the rounding note in `IngredientList`.

### Cut

From PLAN: timers, ingredient scan (the old prep check), accounts, saved recipes. Voice questions are not planned either.

## 16. File layout

Core files, with stretch files marked.

```
api/                                  # Vercel functions (Havier)
  parse.ts  check.ts  speak.ts
  prompts/
    parse.ts  check.ts
  _lib/
    gemini.ts  elevenlabs.ts
    schemas.ts  limits.ts  http.ts  log.ts
public/
  models/gesture_recognizer.task
  wasm/                               # MediaPipe wasm, self-hosted
  audio/silence.mp3
scripts/
  checkPhotos.ts                      # runs the /api/check photo test set
docs/
  PLAN.md  SYSTEM_DESIGN.md
  adr/0001-single-hat-cam.md
  design/remy-screens.html            # mockups, source for the Figma file
src/
  types.ts                            # the contract (shared with api/)
  App.tsx  main.tsx
  camera/
    useHatCam.ts  frameLoop.ts  recognizer.ts
    gestureMapper.ts  gestureFilter.ts  handPresence.ts
    grabSharpestFrame.ts  useGestures.ts
  cooking/
    state.ts  selectors.ts  scaling.ts  controller.ts  CookingProvider.tsx
  api/
    http.ts  errors.ts  client.ts  speakQueue.ts
    mock.ts  fixtures/                # dev only
  audio/
    player.ts  clipCache.ts  browserSpeech.ts
  ui/                                # §9 as built; see the open conflict below
    RecipeInput.tsx  PrepReview.tsx  CookingScreen.tsx  DoneScreen.tsx
    tokens.css  base.css  components.css  steps.css  screens.css
    shapes.ts  fields.ts  say.ts  ingredients.ts
    Remy.tsx  CameraView.tsx  useAnyCam.ts
    prep.tsx                         # ServingsStepper, IngredientList, PrepChecklist,
                                    # CameraSetup, VoicingProgress, ErrorBanner,
                                    # CueChip, HeadsUpBanner
    cooking.tsx                      # StepProgress, StepCard, HoldPill, GestureLegend,
                                    # VerdictPopup
  test/                               # Vitest specs next to the pure modules
```

> **Open: `src/ui/` vs this section.** §9.2/§9.3 name the four screens and their components but say nothing about folders, and §9.5 says components read state through the hook rather than through props. T1 built them under `src/ui/`, one file per screen plus two files grouping the smaller components, which keeps the cooking modules free of presentational code. If you would rather have `src/screens/` and `src/components/` as first sketched, that is a mechanical move; it has not been made unilaterally.
```

## Decisions to confirm

Settled by the committed docs and no longer open: one hat cam (ADR 0001), `cue` + `checkable` instead of `readyWhen` (`types.ts`), thumbs-down means back and repeats on step 1 (mockup: "Go back, or hear it again"), and owners (PLAN).

Still open:

1. **Auto-advance on `ready`.** The mockup says "Moving on in 2 seconds · 👎 to stay". The proposal listed auto-advancing under "Not building", and the old principle was that the cook always decides. This design follows the mockup but pauses the countdown while any gesture is being held, because a 1 s hold is half the window.
2. **Browser speech fallback.** PLAN must-have 4 keeps it, so the old "no fallbacks" rule now has one exception. Worth a check that `speechSynthesis` voices load on the demo laptop offline.
3. **Re-voicing on servings change.** Steps with placeholders need new clips when servings change, which costs ElevenLabs calls and delays Start by a few seconds. The alternative is clips without amounts ("Whisk in the milk…"), with amounts shown on screen only. That's cheaper, but the cook can't hear the amounts.
4. **Check request as base64 JSON.** `types.ts` says `{ image: base64, cue, step }` instead of multipart. It's simpler but about 35% larger, which is fine at about 150 KB.
5. **`RecipeCompare` dropped.** The old design had a side-by-side of pasted text and reordered steps for demo beat 1. The mockups' prep screen doesn't include it; put it back only if the demo needs it.
6. **`parallelWith`.** Still left out; add it as an optional field if the parse prompt handles it well.
7. **Contract additions.** The request, gesture and error types in section 4 aren't in `src/types.ts` yet. Whoever touches it first should add them.
