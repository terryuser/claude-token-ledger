// Pure pause/resume decisions. No `$`: register.tsx feeds readings in and acts on the answers.
import type { LimitKind, PauseRecord } from '../types'

/** The plan limits a pause watches, as `$.session.usage().rateLimits[].kind` names them. */
export const WATCHED: readonly LimitKind[] = ['five_hour', 'seven_day']

export const LIMIT_LABEL: Record<LimitKind, string> = {
  five_hour: '5-hour',
  seven_day: 'weekly',
}

/** Anthropic may reset a little after the stated time; resuming early would only fail again. */
export const RESUME_BUFFER_MS = 2 * 60 * 1000

export const RESUME_PROMPT =
  'Continue where you left off. (Auto-resumed by token-ledger after the usage limit reset.)'

export type LimitReading = { kind: string; percentUsed: number; resetsAt?: string }

export type LimitHit = { kind: LimitKind; percentUsed: number; resetsAt: string }

const isWatched = (kind: string): kind is LimitKind => (WATCHED as readonly string[]).includes(kind)

/**
 * The watched limit at or over `threshold`, or null.
 *
 * A reading whose reset is already past is stale (the window rolled over since
 * the last response) and is ignored. When several limits are hit, the one that
 * resets last wins: work can only continue once all of them have reset.
 */
export const findLimitHit = (
  readings: readonly LimitReading[],
  threshold: number,
  now: number,
): LimitHit | null => {
  const hits = readings
    .filter((r): r is LimitReading & { kind: LimitKind; resetsAt: string } =>
      isWatched(r.kind) && r.resetsAt !== undefined && r.percentUsed >= threshold)
    .filter(r => Date.parse(r.resetsAt) > now)
    .sort((a, b) => Date.parse(b.resetsAt) - Date.parse(a.resetsAt))
  const latest = hits[0]
  return latest ? { kind: latest.kind, percentUsed: latest.percentUsed, resetsAt: latest.resetsAt } : null
}

export const makePause = (
  sessionId: string,
  hit: LimitHit,
  now: number,
  reason: PauseRecord['reason'],
): PauseRecord => ({
  sessionId,
  kind: hit.kind,
  percentUsed: hit.percentUsed,
  resetsAt: hit.resetsAt,
  resumeAt: Date.parse(hit.resetsAt) + RESUME_BUFFER_MS,
  pausedAt: now,
  reason,
})

export const isResumeDue = (pause: PauseRecord, now: number): boolean => now >= pause.resumeAt

/** Clamp a typed threshold to something sensible; NaN keeps the current one. */
export const parseThreshold = (text: string, current: number): number => {
  const n = Number.parseFloat(text)
  return Number.isNaN(n) ? current : Math.min(100, Math.max(50, Math.round(n)))
}
