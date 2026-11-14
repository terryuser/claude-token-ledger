// Pure usage reports built from the per-request CSV rows. No `$`: register.tsx reads the files.
import type { PauseRecord, Snapshot, Tokens, Totals } from '../types'
import { countdown } from './bars'
import { localDate, localTime } from './csv'
import { compact } from './format'
import { addTokens, emptyTotals, grandTotal } from './ledger'
import { LIMIT_LABEL } from './pause'

export const PERIODS = ['today', 'yesterday', 'week', 'month', 'window', 'session', 'all'] as const
export type Period = (typeof PERIODS)[number]

export const isPeriod = (text: string): text is Period => (PERIODS as readonly string[]).includes(text)

export type UsageRow = {
  at: number
  sessionId: string
  project: string
  agent: string
  model: string
  windowId: string
  tokens: Tokens
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Splits one CSV line, honouring quoted cells (`"a,b"`, `""` for a quote). */
export const splitCsvLine = (line: string): string[] => {
  const cells: string[] = []
  let cell = ''
  let isQuoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (isQuoted && ch === '"' && line[i + 1] === '"') {
      cell += '"'
      i += 1
    } else if (ch === '"') {
      isQuoted = !isQuoted
    } else if (ch === ',' && !isQuoted) {
      cells.push(cell)
      cell = ''
    } else {
      cell += ch
    }
  }
  cells.push(cell)
  return cells
}

/** Rows of one `responses/<date>_<session>.csv` file (the layout `csv.ts` writes). */
export const parseResponses = (text: string): UsageRow[] =>
  text
    .split(/\r?\n/)
    .slice(1)
    .filter(line => line.trim() !== '')
    .map(splitCsvLine)
    .filter(c => c.length >= 13)
    .map(c => ({
      at: Date.parse(c[1]!),
      sessionId: c[2]!,
      project: c[3]!,
      agent: c[4]!,
      model: c[6]!,
      tokens: { input: Number(c[7]), output: Number(c[8]), cacheRead: Number(c[9]), cacheWrite: Number(c[10]) },
      windowId: c[12]!,
    }))

/** The local dates (YYYY-MM-DD) a period can touch; null = every file. */
export const periodDates = (period: Period, now: number): string[] | null => {
  const back = (days: number) => Array.from({ length: days }, (_, i) => localDate(now - i * DAY_MS))
  switch (period) {
    case 'today': return back(1)
    case 'yesterday': return [localDate(now - DAY_MS)]
    case 'week': return back(7)
    case 'month': return back(30)
    case 'window': return back(2) // a 5-hour window spans at most two dates
    default: return null
  }
}

export type ReportScope = { period: Period; now: number; sessionId: string; windowId: string | null }

export const inScope = (row: UsageRow, scope: ReportScope): boolean => {
  const dates = periodDates(scope.period, scope.now)
  if (dates && !dates.includes(localDate(row.at))) return false
  if (scope.period === 'window') return row.windowId === scope.windowId
  if (scope.period === 'session') return row.sessionId === scope.sessionId
  return true
}

export type Report = {
  totals: Totals
  byProject: [string, Totals][]
  byModel: [string, Totals][]
  byDay: [string, Totals][]
  sessions: number
}

const groupBy = (rows: readonly UsageRow[], key: (r: UsageRow) => string): [string, Totals][] => {
  const groups = new Map<string, Totals>()
  for (const r of rows) groups.set(key(r), addTokens(groups.get(key(r)) ?? emptyTotals(), r.tokens))
  return [...groups].sort((a, b) => grandTotal(b[1]) - grandTotal(a[1]))
}

export const buildReport = (rows: readonly UsageRow[]): Report => ({
  totals: rows.reduce((t, r) => addTokens(t, r.tokens), emptyTotals()),
  byProject: groupBy(rows, r => r.project),
  byModel: groupBy(rows, r => r.model),
  byDay: groupBy(rows, r => localDate(r.at)).sort((a, b) => a[0].localeCompare(b[0])),
  sessions: new Set(rows.map(r => r.sessionId)).size,
})

const PERIOD_TITLE: Record<Period, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'Last 7 days',
  month: 'Last 30 days',
  window: 'Current 5-hour window',
  session: 'This session',
  all: 'All recorded usage',
}

const row = (name: string, t: Totals) =>
  `| ${name} | ${compact(grandTotal(t))} | ${compact(t.input)} | ${compact(t.output)} | ${compact(t.cacheRead)} | ${compact(t.cacheWrite)} | ${t.requests} |`

const table = (heading: string, groups: [string, Totals][]) =>
  groups.length === 0
    ? ''
    : [`\n**${heading}**\n`, '| | total | input | output | cache read | cache write | requests |', '|---|--:|--:|--:|--:|--:|--:|',
       ...groups.map(([name, t]) => row(name, t))].join('\n')

/** Markdown the model can relay as is, and a slash command prints. */
export const formatReport = (period: Period, report: Report): string => {
  const t = report.totals
  if (t.requests === 0) return `**${PERIOD_TITLE[period]}:** no requests recorded.`
  return [
    `**${PERIOD_TITLE[period]}:** ${compact(grandTotal(t))} tokens over ${t.requests} requests in ${report.sessions} session(s)`,
    `(input ${compact(t.input)} · output ${compact(t.output)} · cache read ${compact(t.cacheRead)} · cache write ${compact(t.cacheWrite)})`,
    table('By project', report.byProject),
    table('By model', report.byModel),
    report.byDay.length > 1 ? table('By day', report.byDay) : '',
  ].filter(Boolean).join('\n')
}

export type StatusInput = {
  snapshot: Snapshot | null
  pause: PauseRecord | null
  threshold: number
  autoResume: boolean
  now: number
}

/** One short paragraph: this session, the 5-hour window, and the pause. */
export const formatStatus = ({ snapshot, pause, threshold, autoResume, now }: StatusInput): string => {
  const session = snapshot?.session ?? emptyTotals()
  const w = snapshot?.window && now < snapshot.window.end ? snapshot.window : null
  const lines = [
    `**This session:** ${compact(grandTotal(session))} tokens over ${session.requests} requests.`,
    w
      ? `**5-hour window:** ${compact(grandTotal(w.totals))} tokens recorded here` +
        (w.percentUsed === null ? '' : `, ${w.percentUsed}% of the plan limit used`) +
        `; resets ${localTime(w.end).slice(11, 16)} (in ${countdown(w.end - now)}).`
      : '**5-hour window:** no requests in the current window yet.',
    pause
      ? `**Paused** at ${pause.percentUsed}% of the ${LIMIT_LABEL[pause.kind]} limit. ` +
        (autoResume
          ? `Auto-resume ${localTime(pause.resumeAt).slice(5, 16)} (in ${countdown(Math.max(0, pause.resumeAt - now))}).`
          : 'Auto-resume is off.')
      : `**Not paused.** Pauses at ${threshold}% of the 5-hour or weekly limit; auto-resume ${autoResume ? 'on' : 'off'}.`,
  ]
  return lines.join('\n')
}
