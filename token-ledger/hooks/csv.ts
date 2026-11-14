// Pure CSV rendering of the ledger. Times are written twice: local for reading, UTC ISO for sorting/joining.
import type { SessionSummary, Tokens, WindowSummary } from '../types'
import { grandTotal } from './ledger'

export type ResponseRow = {
  at: number
  sessionId: string
  project: string
  /** `main`, or the subagent's id. */
  agent: string
  /** `turn` for a model request of a turn, `compaction` for a summarizer call. */
  source: 'turn' | 'compaction'
  model: string
  tokens: Tokens
  windowId: string
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** `YYYY-MM-DD HH:mm:ss` in the machine's time zone, which Excel reads as a date. */
export const localTime = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** `YYYY-MM-DD` in the machine's time zone. */
export const localDate = (ms: number): string => localTime(ms).slice(0, 10)

const cell = (value: string | number | boolean | null): string => {
  const text = value === null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export const csvLine = (values: readonly (string | number | boolean | null)[]): string =>
  values.map(cell).join(',') + '\r\n'

const tokenCells = (t: Tokens) => [t.input, t.output, t.cacheRead, t.cacheWrite, grandTotal(t)]
const TOKEN_HEADERS = ['input', 'output', 'cache_read', 'cache_write', 'total']

export const RESPONSE_HEADER = csvLine([
  'time_local', 'time_utc', 'session_id', 'project', 'agent', 'source', 'model',
  ...TOKEN_HEADERS, 'window_resets_utc',
])

export const responseLine = (r: ResponseRow): string =>
  csvLine([
    localTime(r.at), new Date(r.at).toISOString(), r.sessionId, r.project, r.agent, r.source, r.model,
    ...tokenCells(r.tokens), r.windowId,
  ])

export const sessionsCsv = (sessions: readonly SessionSummary[]): string =>
  csvLine(['session_id', 'project', 'first_local', 'last_local', 'requests', ...TOKEN_HEADERS]) +
  sessions
    .map(s => csvLine([s.id, s.project, localTime(s.firstAt), localTime(s.lastAt), s.totals.requests, ...tokenCells(s.totals)]))
    .join('')

export const windowsCsv = (windows: readonly WindowSummary[]): string =>
  csvLine(['window_start_local', 'window_end_local', 'estimated', 'percent_used', 'sessions', 'requests', ...TOKEN_HEADERS]) +
  windows
    .map(w => csvLine([
      localTime(w.start), localTime(w.end), w.isEstimated, w.percentUsed, w.sessionIds.length, w.totals.requests,
      ...tokenCells(w.totals),
    ]))
    .join('')

/** `~/.claude/token-log` from a home directory, with forward slashes (which Windows accepts). */
export const logDirFrom = (home: string): string =>
  `${home.replace(/\\/g, '/').replace(/\/$/, '')}/.claude/token-log`

/** One file per session per day keeps each file small enough to rewrite whole. */
export const responsesPath = (dir: string, row: ResponseRow): string =>
  `${dir}/responses/${localDate(row.at)}_${row.sessionId}.csv`
