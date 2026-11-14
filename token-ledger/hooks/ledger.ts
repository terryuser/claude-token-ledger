// Pure accounting: no `$`, no I/O. Everything here is deterministic and unit-tested.
import type { ModelUsage } from 'claude-code'

import type { SessionSummary, Tokens, Totals, WindowSummary } from '../types'

export const FIVE_HOURS_MS = 5 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
/** Two readings of the same real window may report resets a few seconds apart. */
const SAME_WINDOW_TOLERANCE_MS = 2 * 60 * 1000

/** History caps keep `$.store` far below its 4 MiB limit. */
export const MAX_WINDOWS = 1000
export const MAX_SESSIONS = 3000

export type LedgerData = {
  windows: WindowSummary[]
  sessions: SessionSummary[]
}

/** The five-hour reading from `$.session.usage().rateLimits`, when there is one. */
export type WindowReading = { resetsAt: string; percentUsed: number }

export type ResponseInput = {
  sessionId: string
  project: string
  now: number
  tokens: Tokens
  reading: WindowReading | null
}

export type RecordResult = {
  data: LedgerData
  window: WindowSummary
  session: SessionSummary
}

export const emptyTotals = (): Totals => ({
  requests: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
})

export const toTokens = (usage: ModelUsage): Tokens => ({
  input: usage.input_tokens ?? 0,
  output: usage.output_tokens ?? 0,
  cacheRead: usage.cache_read_input_tokens ?? 0,
  cacheWrite: usage.cache_creation_input_tokens ?? 0,
})

export const addTokens = (totals: Totals, tokens: Tokens): Totals => ({
  requests: totals.requests + 1,
  input: totals.input + tokens.input,
  output: totals.output + tokens.output,
  cacheRead: totals.cacheRead + tokens.cacheRead,
  cacheWrite: totals.cacheWrite + tokens.cacheWrite,
})

export const grandTotal = (t: Tokens): number =>
  t.input + t.output + t.cacheRead + t.cacheWrite

const isoAt = (ms: number): string => new Date(ms).toISOString()

const newWindow = (start: number, end: number, isEstimated: boolean): WindowSummary => ({
  id: isoAt(end),
  start,
  end,
  isEstimated,
  percentUsed: null,
  sessionIds: [],
  totals: emptyTotals(),
})

/**
 * Finds or creates the window `now` falls in.
 *
 * Real reading: the window ending at `resetsAt`. An estimated window that is
 * still open is upgraded to the real one, so its tokens are kept.
 * No reading: the open window if any, else a new one from the top of the hour
 * (plan windows reset on the hour) lasting five hours.
 */
export const resolveWindow = (
  windows: readonly WindowSummary[],
  now: number,
  reading: WindowReading | null,
): { windows: WindowSummary[]; window: WindowSummary } => {
  const list = [...windows]
  const latest = list.at(-1)
  const isOpen = (w: WindowSummary | undefined): w is WindowSummary =>
    w !== undefined && now >= w.start && now < w.end

  const resetsAt = reading ? Date.parse(reading.resetsAt) : NaN

  if (!Number.isNaN(resetsAt)) {
    const matching = list.findIndex(w => Math.abs(w.end - resetsAt) <= SAME_WINDOW_TOLERANCE_MS)
    const index = matching !== -1 ? matching : isOpen(latest) && latest.isEstimated ? list.length - 1 : -1
    const found = list[index]
    if (found && !found.isEstimated) {
      return { windows: list, window: found }
    }
    if (found) {
      const upgraded = { ...found, id: isoAt(resetsAt), start: resetsAt - FIVE_HOURS_MS, end: resetsAt, isEstimated: false }
      list[index] = upgraded
      return { windows: list, window: upgraded }
    }
    const created = newWindow(resetsAt - FIVE_HOURS_MS, resetsAt, false)
    list.push(created)
    return { windows: list, window: created }
  }

  if (isOpen(latest)) {
    return { windows: list, window: latest }
  }
  const start = now - (now % HOUR_MS)
  const created = newWindow(start, start + FIVE_HOURS_MS, true)
  list.push(created)
  return { windows: list, window: created }
}

const replaceById = <T extends { id: string }>(list: T[], item: T): T[] =>
  list.map(one => (one.id === item.id ? item : one))

/** Adds one model request to its window and its session. */
export const recordResponse = (data: LedgerData, input: ResponseInput): RecordResult => {
  const { windows, window: found } = resolveWindow(data.windows, input.now, input.reading)

  const window: WindowSummary = {
    ...found,
    percentUsed: input.reading && !found.isEstimated ? input.reading.percentUsed : found.percentUsed,
    sessionIds: found.sessionIds.includes(input.sessionId)
      ? found.sessionIds
      : [...found.sessionIds, input.sessionId],
    totals: addTokens(found.totals, input.tokens),
  }

  const existing = data.sessions.find(s => s.id === input.sessionId)
  const session: SessionSummary = existing
    ? { ...existing, lastAt: input.now, totals: addTokens(existing.totals, input.tokens) }
    : {
        id: input.sessionId,
        project: input.project,
        firstAt: input.now,
        lastAt: input.now,
        totals: addTokens(emptyTotals(), input.tokens),
      }

  const sessions = existing ? replaceById(data.sessions, session) : [...data.sessions, session]

  return {
    data: {
      windows: replaceById(windows, window).slice(-MAX_WINDOWS),
      sessions: sessions.slice(-MAX_SESSIONS),
    },
    window,
    session,
  }
}

/** The window open at `now`, for the band before this session's first request. */
export const openWindow = (
  windows: readonly WindowSummary[],
  now: number,
): WindowSummary | null => {
  const latest = windows.at(-1)
  return latest && now >= latest.start && now < latest.end ? latest : null
}
