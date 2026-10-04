// The prep screen's components (§9.3): the servings stepper, the ingredient grid, the before-you-start
// checklist, the camera setup check, the voice progress and the error banner.
import { useState } from 'react'
import { MAX_SERVINGS, MIN_SERVINGS, useCooking, type CookingError, type FilledStep, type ScaledIngredient } from '../cooking/contract.ts'
import { CameraView } from './CameraView.tsx'
import { CHECKLIST_COLOURS } from './fields.ts'
import { ingredientLook, ingredientTint, type IngredientShape } from './ingredients.ts'

/** − **n servings** + on sand. The number alone until the servings stretch goal is built. */
export function ServingsStepper({ servings, original, onChange }: { servings: number; original: number; onChange: (n: number) => void }) {
  return (
    <div className="ui-stepper">
      <button type="button" onClick={() => onChange(servings - 1)} disabled={servings <= MIN_SERVINGS} aria-label="Fewer servings">
        −
      </button>
      <b className="ui-stepper__value">
        {servings} {servings === 1 ? 'serving' : 'servings'}{original !== servings ? ` (was ${original})` : ''}
      </b>
      <button type="button" onClick={() => onChange(servings + 1)} disabled={servings >= MAX_SERVINGS} aria-label="More servings">
        +
      </button>
    </div>
  )
}

/** A drawn ingredient, so prep isn't emoji. */
function IngredientArt({ id, size = 74 }: { id: string; size?: number }) {
  const { color, shape } = ingredientLook(id)
  const ink = 'var(--ink)'
  const parts: Record<IngredientShape, React.ReactNode> = {
    sack: (
      <>
        <path d="M18 30 Q14 60 22 62 H50 Q58 60 54 30 Z" fill={color} stroke={ink} strokeWidth="3" />
        <path d="M20 30 Q36 20 52 30" fill="none" stroke={ink} strokeWidth="3" />
        <path d="M28 44 h16" stroke={ink} strokeWidth="3" strokeLinecap="round" />
      </>
    ),
    jug: (
      <>
        <path d="M22 20 H46 L48 62 H20 Z" fill={color} stroke={ink} strokeWidth="3" />
        <path d="M46 28 Q58 30 54 44 L48 46" fill="none" stroke={ink} strokeWidth="3" />
        <path d="M20 34 H48" stroke={ink} strokeWidth="2" opacity=".5" />
      </>
    ),
    egg: <ellipse cx="36" cy="40" rx="17" ry="22" fill={color} stroke={ink} strokeWidth="3" />,
    block: (
      <>
        <path d="M14 36 L36 26 L58 36 L36 46 Z" fill="#ffe2b8" stroke={ink} strokeWidth="3" />
        <path d="M14 36 V50 L36 60 V46 Z" fill={color} stroke={ink} strokeWidth="3" />
        <path d="M58 36 V50 L36 60 V46 Z" fill={color} stroke={ink} strokeWidth="3" />
      </>
    ),
    jar: (
      <>
        <rect x="20" y="24" width="32" height="38" rx="8" fill={color} stroke={ink} strokeWidth="3" />
        <rect x="22" y="16" width="28" height="9" rx="3" fill="var(--cocoa)" stroke={ink} strokeWidth="3" />
      </>
    ),
    tin: (
      <>
        <rect x="20" y="22" width="32" height="40" rx="4" fill={color} stroke={ink} strokeWidth="3" />
        <ellipse cx="36" cy="22" rx="16" ry="5" fill="#e3beb2" stroke={ink} strokeWidth="3" />
        <path d="M26 40 h20" stroke={ink} strokeWidth="3" strokeLinecap="round" />
      </>
    ),
    shaker: (
      <>
        <path d="M24 30 Q24 22 36 20 Q48 22 48 30 V60 H24 Z" fill={color} stroke={ink} strokeWidth="3" />
        <circle cx="32" cy="26" r="1.8" fill={ink} />
        <circle cx="40" cy="26" r="1.8" fill={ink} />
      </>
    ),
    bottle: (
      <>
        <path d="M30 14 H42 V26 Q52 32 52 44 V62 H20 V44 Q20 32 30 26 Z" fill={color} stroke={ink} strokeWidth="3" />
        <path d="M20 46 H52" stroke={ink} strokeWidth="2" opacity=".5" />
      </>
    ),
  }
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" aria-hidden>
      {parts[shape]}
    </svg>
  )
}

/**
 * Every ingredient at the chosen servings. Amounts that moved because the servings changed are
 * called out, and an awkward whole-item rounding gets a note underneath.
 */
export function IngredientList({ ingredients }: { ingredients: ScaledIngredient[] }) {
  const notes = ingredients.filter(i => i.note)
  return (
    <>
      <div className="ui-ings">
        {ingredients.map((ingredient, n) => (
          <div key={ingredient.id} className="ui-ing" style={{ background: ingredientTint(ingredient.id), animationDelay: `${n * 50}ms` }}>
            <IngredientArt id={ingredient.id} />
            <b className={`ui-ing__amount ${ingredient.changed ? 'ui-ing__amount--changed' : ''}`}>{ingredient.amount}</b>
            <span>{ingredient.name}</span>
          </div>
        ))}
      </div>
      {notes.length > 0 && (
        <p className="ui-ing__note">
          {notes.map(i => i.note).join(' · ')}
        </p>
      )}
    </>
  )
}

/** Tickable rows, each box in the next of the four colours. Ticks are local UI state only. */
export function PrepChecklist({ items }: { items: string[] }) {
  const [ticked, setTicked] = useState<string[]>([])
  const toggle = (item: string) => setTicked(t => (t.includes(item) ? t.filter(x => x !== item) : [...t, item]))

  return (
    <div className="ui-checklist">
      <h3>Before you start</h3>
      {items.map((item, n) => {
        const done = ticked.includes(item)
        const colour = CHECKLIST_COLOURS[n % CHECKLIST_COLOURS.length]
        return (
          <label key={item} className={`ui-check ${done ? 'ui-check--done' : ''}`}>
            <input type="checkbox" checked={done} onChange={() => toggle(item)} />
            <span className="ui-check__box" style={{ borderColor: colour, background: done ? colour : 'transparent' }} />
            {item}
          </label>
        )
      })}
    </div>
  )
}

/** The camera setup check: is the bowl actually in the window? */
export function CameraSetup() {
  const { camera } = useCooking()
  return (
    <div className="ui-setup">
      <CameraView
        cam={camera}
        caption="Remy's view"
        className="ui-prep-cam"
        style={{ '--cam-ring': 'var(--apricot)', '--cam-bg': 'var(--sand)', '--cam-fg': 'var(--umber)' } as React.CSSProperties}
      />
      <p>Can Remy see your bowl? Look down at it and check it's in the window.</p>
    </div>
  )
}

/** "Preparing voice… 4/10", with a retry once voicing has failed. */
export function VoicingProgress({ ready, total, failed, onRetry }: { ready: number; total: number; failed: boolean; onRetry: () => void }) {
  return (
    <div className="ui-voicing">
      <span>
        {failed ? "Remy's voice isn't ready" : total > 0 && ready >= total ? "Remy's voice is ready" : `Preparing voice… ${ready}/${total}`}
      </span>
      {failed && (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

/** One line at the top of the screen, with a way to clear it. */
export function ErrorBanner({ error, onDismiss }: { error: CookingError | null; onDismiss: () => void }) {
  if (!error) return null
  return (
    <div className="ui-error" role="alert">
      <span>{error.message}</span>
      <button type="button" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  )
}

/** The step's cue, shown only when the step can be checked. */
export function CueChip({ step }: { step: FilledStep }) {
  if (!step.cue) return null
  return (
    <div className="ui-cue">
      ✋ Ready when: <b>{step.cue}</b>
    </div>
  )
}

/** A warning about what the next step needs ready. Hidden when there isn't one. */
export function HeadsUpBanner({ text }: { text: string | null }) {
  if (!text) return null
  return <div className="ui-headsup">🔥 {text}</div>
}