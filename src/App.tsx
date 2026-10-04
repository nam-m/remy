// The app: one CookingProvider, and whichever of the four screens the phase calls for (§9.2).
// Components read through useCooking() and useHoldProgress() only (§9.5).
import { CookingProvider } from './cooking/contract.ts'
import { useCooking } from './cooking/context.ts'
import { CookingScreen } from './ui/CookingScreen.tsx'
import { DevTag } from './ui/DevTag.tsx'
import { DoneScreen } from './ui/DoneScreen.tsx'
import { PrepReview } from './ui/PrepReview.tsx'
import { RecipeInput } from './ui/RecipeInput.tsx'
import './ui/tokens.css'
import './ui/base.css'
import './ui/components.css'
import './ui/steps.css'
import './ui/screens.css'

function Screens() {
  const { state, controller, dispatch } = useCooking()

  if (state.phase === 'input' || state.phase === 'parsing') {
    return (
      <RecipeInput
        phase={state.phase}
        recipeText={state.recipeText}
        error={state.error}
        onTextChange={text => dispatch({ type: 'recipeTextChanged', text })}
        onSubmit={text => void controller.submitRecipe(text)}
        onDismissError={() => dispatch({ type: 'errorDismissed' })}
      />
    )
  }

  if (state.phase === 'prep') return <PrepReview />

  if (state.phase === 'cooking') return <CookingScreen />

  return <DoneScreen stats={state.stats} title={state.recipe?.title ?? 'Your recipe'} onRestart={controller.restart} />
}

export default function App() {
  return (
    <div className="ui">
      <CookingProvider>
        <Screens />
        {import.meta.env.DEV && <DevTag />}
      </CookingProvider>
    </div>
  )
}