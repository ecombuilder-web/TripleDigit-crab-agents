export type CrabState = 'attention' | 'working' | 'finished'

export type CrabRow = {
  id: string
  title: string
  link: string
  isSelf: boolean
  state: CrabState
  /** Why it needs you; set when state is 'attention'. */
  attention: string | null
  isRunning: boolean
  model: string
  effort: string
  ctxTokens: number
  ctxPercent: number | null
  progress: { done: number; total: number } | null
  /** When the current (or last) turn started, ms. */
  turnStartedAt: number
  lastActivityAt: number
  hat: number
}

export type CrabLimit = { label: string; percentUsed: number; resetsAt: string | null }

export type CrabSnapshot = {
  updatedAt: number
  rows: CrabRow[]
  limits: CrabLimit[]
  /** When the limits were read from the app's usage card, ms; 0 when unknown. */
  limitsAt: number
  error: string | null
}

/** `auto` follows the Claude app's light or dark theme; the others force a background. */
export type CrabTheme = 'auto' | 'light' | 'dark'

declare module 'claude-code' {
  interface PluginState {
    'crab-agents': {
      snapshot: CrabSnapshot
      finishedOpen: boolean
      theme: CrabTheme
      /** The person closed the pane in this session: it stays closed until /crabs. */
      closedByYou: boolean
      /** The built-in browser pane is open and on screen, so the Agents pane steps aside. */
      browserInUse: boolean
    }
  }
}
