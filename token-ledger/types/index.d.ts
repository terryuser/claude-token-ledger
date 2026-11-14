/** The four token counts of one or more model requests. */
export type Tokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** Tokens summed over a number of requests. */
export type Totals = Tokens & { requests: number }

/** One 5-hour plan window: the real one when the API reported it, else an estimate. */
export type WindowSummary = {
  /** ISO time the window ends (resets); its identity. */
  id: string
  start: number
  end: number
  isEstimated: boolean
  /** Last `% used` the API reported for the window; null while estimated. */
  percentUsed: number | null
  sessionIds: string[]
  totals: Totals
}

/** One Claude Code chat session. */
export type SessionSummary = {
  id: string
  project: string
  firstAt: number
  lastAt: number
  totals: Totals
}

/** What the band draws. */
export type Snapshot = {
  session: Totals
  window: WindowSummary | null
}

/** A plan limit the mod pauses on. */
export type LimitKind = 'five_hour' | 'seven_day'

/** A session paused at a usage limit, waiting to resume. Kept in `$.store` per session. */
export type PauseRecord = {
  sessionId: string
  kind: LimitKind
  percentUsed: number
  /** ISO time the limit resets. */
  resetsAt: string
  /** When the resume prompt is sent: the reset plus a small buffer. */
  resumeAt: number
  pausedAt: number
  /** `threshold`: stopped before the limit; `rate_limit`: a request was refused at it. */
  reason: 'threshold' | 'rate_limit'
}

declare module 'claude-code' {
  interface PluginState {
    'token-ledger': {
      snapshot: Snapshot | null
      isHidden: boolean
      now: number
      pause: PauseRecord | null
    }
  }
}
