import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// The whole suite runs in parallel, which can slow async UI updates past the 1 s default.
configure({ asyncUtilTimeout: 10_000 })

// Testing Library only cleans up on its own when Vitest globals are on.
afterEach(cleanup)

// jsdom has no media playback. Skipped in tests that run in the node environment.
if (typeof HTMLMediaElement !== 'undefined') {
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
  HTMLMediaElement.prototype.pause = vi.fn()
}
