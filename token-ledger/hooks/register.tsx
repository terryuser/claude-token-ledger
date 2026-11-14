import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register } from 'claude-code'

import type { PauseRecord, Snapshot } from '../types'
import { RESPONSE_HEADER, logDirFrom, responseLine, responsesPath, sessionsCsv, windowsCsv } from './csv'
import type { ResponseRow } from './csv'
import { emptyTotals, openWindow, recordResponse, toTokens } from './ledger'
import type { LedgerData, WindowReading } from './ledger'
import { LIMIT_LABEL, RESUME_PROMPT, findLimitHit, isResumeDue, makePause, parseThreshold } from './pause'
import type { LimitHit } from './pause'
import { PERIODS, buildReport, formatReport, formatStatus, inScope, isPeriod, parseResponses, periodDates } from './report'
import type { Period, UsageRow } from './report'
import { bandView } from './view'

// Pure logic lives in ledger.ts / pause.ts / report.ts / bars.ts / csv.ts / format.ts / view.tsx. Everything that
// touches `$` stays in this file: the engine only follows `$` into functions declared here.

const snapshot = atom({ plugin: 'token-ledger', key: 'snapshot' } as const, null)
const isHidden = atom({ plugin: 'token-ledger', key: 'isHidden' } as const, false)
/** Redraw clock for the countdowns; also drives the resume watcher. */
const now = atom({ plugin: 'token-ledger', key: 'now' } as const, 0)
const pause = atom({ plugin: 'token-ledger', key: 'pause' } as const, null)

const TICK_MS = 30_000

const COMMAND = 'tokens'
const REPORT_COMMAND = 'tokens-report'
const STATUS_COMMAND = 'tokens-status'
// Tools the model calls when the person asks in plain words; listed as mcp__token-ledger__<name>.
const REPORT_TOOL = 'usage_report'
const CONTROL_TOOL = 'usage_control'
const CONTROL_ACTIONS = ['status', 'set_threshold', 'resume', 'cancel_resume', 'show_band', 'hide_band'] as const
type ControlAction = (typeof CONTROL_ACTIONS)[number]
const WINDOWS_KEY = 'windows'
const SESSIONS_KEY = 'sessions'
const PAUSES_KEY = 'pauses'
const THRESHOLD_KEY = 'token-ledger.pauseAtPercent'

const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [])
const asRecord = <T,>(value: unknown): Record<string, T> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, T>) : {}

// ── Ledger storage ─────────────────────────────────────────────────────────────

async function loadLedger($: EngineInterface): Promise<LedgerData> {
  return {
    windows: asArray(await $.store.get(WINDOWS_KEY)),
    sessions: asArray(await $.store.get(SESSIONS_KEY)),
  }
}

async function saveLedger($: EngineInterface, data: LedgerData): Promise<void> {
  await $.store.set(WINDOWS_KEY, data.windows)
  await $.store.set(SESSIONS_KEY, data.sessions)
}

async function logDir($: EngineInterface): Promise<string> {
  return logDirFrom((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.')
}

/** `$.fs` has no append: read the day's file (or start one), add the line, write back. */
async function appendResponse($: EngineInterface, dir: string, row: ResponseRow): Promise<void> {
  const path = responsesPath(dir, row)
  const existing = (await $.fs.exists(path)) ? String(await $.fs.read(path)) : RESPONSE_HEADER
  await $.fs.write(path, existing + responseLine(row))
}

async function writeSummaries($: EngineInterface, dir: string, data: LedgerData): Promise<void> {
  await $.fs.write(`${dir}/sessions.csv`, sessionsCsv(data.sessions))
  await $.fs.write(`${dir}/windows.csv`, windowsCsv(data.windows))
}

// ── Recording ──────────────────────────────────────────────────────────────────

type Request = {
  agentId?: string
  source: ResponseRow['source']
  model: string
  usage: ModelUsage
}

const projectName = (cwd: string): string =>
  cwd.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) ?? cwd

async function fiveHourReading($: EngineInterface): Promise<WindowReading | null> {
  const { rateLimits } = await $.session.usage()
  const limit = rateLimits.find(r => r.kind === 'five_hour')
  return limit?.resetsAt ? { resetsAt: limit.resetsAt, percentUsed: limit.percentUsed } : null
}

async function record($: EngineInterface, request: Request): Promise<void> {
  const [sessionId, cwd, at, reading, dir] = await Promise.all([
    $.session.id(), $.session.cwd(), $.clock.now(), fiveHourReading($), logDir($),
  ])
  const tokens = toTokens(request.usage)
  const result = recordResponse(await loadLedger($), {
    sessionId, project: projectName(cwd), now: at, tokens, reading,
  })

  await saveLedger($, result.data)
  await update($, snapshot, () => ({ session: result.session.totals, window: result.window }))

  await appendResponse($, dir, {
    at,
    sessionId,
    project: result.session.project,
    agent: request.agentId ?? 'main',
    source: request.source,
    model: request.model,
    tokens,
    windowId: result.window.id,
  })
  await writeSummaries($, dir, result.data)
}

// Requests can finish concurrently (parallel subagents); the ledger is
// read-modify-write, so records run one at a time.
let queue: Promise<void> = Promise.resolve()
let hasWarned = false

async function recordOrWarn($: EngineInterface, request: Request): Promise<void> {
  try {
    await record($, request)
  } catch (error) {
    // A CSV open in Excel is locked on Windows; say so once, keep counting.
    if (!hasWarned) {
      hasWarned = true
      $.ui.toast(`token-ledger: could not write the log (${String(error).slice(0, 120)})`)
    }
  }
}

function enqueue($: EngineInterface, request: Request): Promise<void> {
  queue = queue.then(() => recordOrWarn($, request))
  return queue
}

// ── Pause and resume ───────────────────────────────────────────────────────────

/** The main loop's running turn, the one a pause aborts (subagent steps carry their own ids). */
let mainTurnId: string | undefined

async function loadPause($: EngineInterface, sessionId: string): Promise<PauseRecord | null> {
  return asRecord<PauseRecord>(await $.store.get(PAUSES_KEY))[sessionId] ?? null
}

async function writePause($: EngineInterface, sessionId: string, record: PauseRecord | null): Promise<void> {
  const { [sessionId]: _old, ...others } = asRecord<PauseRecord>(await $.store.get(PAUSES_KEY))
  await $.store.set(PAUSES_KEY, record ? { ...others, [sessionId]: record } : others)
  await update($, pause, () => record)
}

async function limitHit($: EngineInterface, threshold: number): Promise<LimitHit | null> {
  const [{ rateLimits }, at] = await Promise.all([$.session.usage(), $.clock.now()])
  return findLimitHit(rateLimits, threshold, at)
}

/** Records the pause and, when a turn is running, stops it. */
async function pauseSession($: EngineInterface, hit: LimitHit, reason: PauseRecord['reason']): Promise<void> {
  const [sessionId, at] = await Promise.all([$.session.id(), $.clock.now()])
  await writePause($, sessionId, makePause(sessionId, hit, at, reason))
  $.ui.toast(`token-ledger: paused at ${hit.percentUsed}% of the ${LIMIT_LABEL[hit.kind]} limit`)

  const turnId = mainTurnId
  if (turnId) {
    mainTurnId = undefined
    try {
      await $.turn.abort({ turnId })
    } catch {
      // The turn ended on its own meanwhile: nothing left to stop.
    }
  }
}

async function cancelPause($: EngineInterface): Promise<void> {
  await writePause($, await $.session.id(), null)
}

/** Clears the pause, then queues the continue prompt (it starts once the session is idle). */
async function resumeNow($: EngineInterface): Promise<void> {
  await cancelPause($)
  // Resolves when the turn starts, which may be a while if the session is busy: don't hold the tick.
  $.prompt.submit({ text: RESUME_PROMPT }).catch(() => {
    $.ui.toast('token-ledger: could not auto-resume. Type "continue" to carry on.')
  })
}

async function resumeIfDue($: EngineInterface, autoResume: boolean): Promise<void> {
  const current = await read($, pause)
  if (autoResume && current && isResumeDue(current, await $.clock.now())) {
    await resumeNow($)
  }
}

// ── Reports and controls (shared by the slash commands and the model's tools) ─────

/** Reads only the day files a period can touch, then keeps the rows in scope. */
async function usageRows($: EngineInterface, period: Period): Promise<UsageRow[]> {
  const [dir, at, sessionId, current] = await Promise.all([logDir($), $.clock.now(), $.session.id(), read($, snapshot)])
  const folder = `${dir}/responses`
  if (!(await $.fs.exists(folder))) return []

  const dates = periodDates(period, at)
  const files = (await $.fs.list(folder))
    .map(entry => entry.name)
    .filter(name => name.endsWith('.csv'))
    .filter(name => dates === null || dates.includes(name.slice(0, 10)))
    .filter(name => period !== 'session' || name.endsWith(`_${sessionId}.csv`))

  const scope = { period, now: at, sessionId, windowId: current?.window?.id ?? null }
  const rows: UsageRow[] = []
  for (const name of files) {
    rows.push(...parseResponses(String(await $.fs.read(`${folder}/${name}`))).filter(r => inScope(r, scope)))
  }
  return rows
}

async function reportText($: EngineInterface, period: Period): Promise<string> {
  return formatReport(period, buildReport(await usageRows($, period)))
}

async function statusText($: EngineInterface, threshold: number, autoResume: boolean): Promise<string> {
  const [current, paused, at] = await Promise.all([read($, snapshot), read($, pause), $.clock.now()])
  return formatStatus({ snapshot: current, pause: paused, threshold, autoResume, now: at })
}

/**
 * One control, as `/tokens` and the model's tool both ask for it. A `resume`
 * asked by the model clears the pause only: the turn asking is the continuation,
 * so no extra "continue" prompt is queued behind it.
 */
async function control(
  $: EngineInterface,
  action: ControlAction,
  value: string,
  settings: { threshold: number; autoResume: boolean; isModel: boolean },
): Promise<string> {
  switch (action) {
    case 'resume':
      if (settings.isModel) {
        await cancelPause($)
        return 'Pause cleared. Carry on with the task that was paused.'
      }
      await resumeNow($)
      return 'Resuming now.'
    case 'cancel_resume':
      await cancelPause($)
      return 'Auto-resume cancelled. The session stays stopped until you continue it.'
    case 'set_threshold': {
      const next = parseThreshold(value, settings.threshold)
      await $.config.set({ key: THRESHOLD_KEY, value: next })
      return `Pausing at ${next}% of the 5-hour or weekly limit.`
    }
    case 'show_band':
    case 'hide_band': {
      const hidden = await update($, isHidden, () => action === 'hide_band')
      return `Token band ${hidden ? 'hidden' : 'shown'}.`
    }
    default:
      return statusText($, settings.threshold, settings.autoResume)
  }
}

async function registerCommandsAndTools($: EngineInterface): Promise<void> {
  await $.command.register({
    name: COMMAND,
    description: 'Token band: toggle · resume · cancel · limit <50-100>',
    argumentHint: '[resume | cancel | limit <n>]',
  })
  await $.command.register({
    name: REPORT_COMMAND,
    description: 'Token usage report by project, model and day',
    argumentHint: `[${PERIODS.join(' | ')}]`,
  })
  await $.command.register({
    name: STATUS_COMMAND,
    description: 'This session, the 5-hour window and the pause state',
  })
  await $.tool.register({
    name: REPORT_TOOL,
    description:
      'Report Claude Code token usage recorded by token-ledger: totals and the input/output/cache split, ' +
      'broken down by project, model and day. Use when the person asks how many tokens they used ' +
      '(today, this week, this month, this session, the current 5-hour window, or overall).',
    inputSchema: {
      type: 'object',
      properties: { period: { type: 'string', enum: [...PERIODS], description: 'Which span to report. Defaults to today.' } },
    },
    isDeferred: false,
  })
  await $.tool.register({
    name: CONTROL_TOOL,
    description:
      'Check or change the token-ledger usage-limit pause: `status` (session, 5-hour window, pause state), ' +
      '`set_threshold` (value 50-100: pause at that % of the 5-hour or weekly limit), `resume` (clear a pause ' +
      'and carry on), `cancel_resume` (stay paused, no auto-resume), `show_band` / `hide_band`.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: [...CONTROL_ACTIONS] },
        value: { type: 'number', description: 'The threshold, for set_threshold.' },
      },
      required: ['action'],
    },
    isDeferred: false,
  })
}

// ── Hooks ──────────────────────────────────────────────────────────────────────

export const register: Register = (on, options) => {
  const threshold = Number(options.pauseAtPercent ?? 95)
  const autoResume = options.autoResume !== false

  const settings = { threshold, autoResume }

  on('session.start', async ($, e, next) => {
    // Commands and tools are extras: if they fail, counting, the band and the resume timer still start.
    await registerCommandsAndTools($).catch(error => {
      $.ui.toast(`token-ledger: commands/tools unavailable (${String(error).slice(0, 120)})`)
    })

    const [sessionId, startedAt, ledger] = await Promise.all([$.session.id(), $.clock.now(), loadLedger($)])
    const resumed = ledger.sessions.find(s => s.id === sessionId)
    await update($, snapshot, (): Snapshot => ({
      session: resumed?.totals ?? emptyTotals(),
      window: openWindow(ledger.windows, startedAt),
    }))
    // A pause survives a reload or a resumed session; a due one resumes on the first tick.
    const saved = await loadPause($, sessionId)
    await update($, pause, () => saved)

    await update($, now, () => startedAt)
    $.clock.every(TICK_MS, async () => {
      const at = await $.clock.now()
      await update($, now, () => at)
      await resumeIfDue($, autoResume)
    })

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const [verb = '', value = ''] = e.args.trim().toLowerCase().split(/\s+/)
    const verbs: Record<string, ControlAction> = { resume: 'resume', cancel: 'cancel_resume', limit: 'set_threshold' }
    const action = verbs[verb]
    if (action) return { text: await control($, action, value, { ...settings, isModel: false }) }

    const hidden = await update($, isHidden, h => !h)
    return { text: `Token band ${hidden ? 'hidden' : 'shown'}. Pause at ${threshold}%. Log: ${await logDir($)}` }
  })

  on('command.run', { command: REPORT_COMMAND }, async ($, e) => {
    const asked = e.args.trim().toLowerCase()
    return { text: await reportText($, isPeriod(asked) ? asked : 'today') }
  })

  on('command.run', { command: STATUS_COMMAND }, async $ => ({
    text: await statusText($, threshold, autoResume),
  }))

  on('tool.call', { tool: 'mcp__token-ledger__usage_report' }, async ($, e) => {
    const asked = String((e.input as { period?: unknown }).period ?? 'today')
    return { result: await reportText($, isPeriod(asked) ? asked : 'today') }
  })

  on('tool.call', { tool: 'mcp__token-ledger__usage_control' }, async ($, e) => {
    const input = e.input as { action?: unknown; value?: unknown }
    const action = CONTROL_ACTIONS.find(a => a === input.action) ?? 'status'
    return { result: await control($, action, String(input.value ?? ''), { ...settings, isModel: true }) }
  })

  on('turn.start', ($, e, next) => {
    mainTurnId = e.turnId
    return next(e)
  })

  // Every model request of every turn, main loop and subagents alike.
  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    if (response.usage) {
      await enqueue($, {
        agentId: e.agentId,
        source: 'turn',
        model: response.usage.model,
        usage: response.usage,
      })
    }

    // Work continues after this reply when it asked for tools, or when it is a
    // subagent's (the main turn is still waiting on it). Prompts typed while
    // already paused are let through: a pause is only taken once.
    const isMoreComing = response.toolUses.length > 0 || e.agentId !== undefined
    if (isMoreComing && (await read($, pause)) === null) {
      const hit = await limitHit($, threshold)
      if (hit) await pauseSession($, hit, 'threshold')
    }
    return response
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      mainTurnId = undefined
      // A request refused at the limit ends the turn with an API error.
      if (e.reason === 'error' && (await read($, pause)) === null) {
        const hit = await limitHit($, threshold)
        if (hit) await pauseSession($, hit, 'rate_limit')
      }
    }
    return next(e)
  })

  // The summarizer's request is not a turn step; count it separately.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if ('usage' in result && result.usage) {
      await enqueue($, { agentId: e.agentId, source: 'compaction', model: 'compaction', usage: result.usage })
    }
    return result
  }).catch(($, e, next) => next(e)) // accounting must never block a compaction

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, snapshot)
    const paused = await read($, pause)
    // A pause always shows, even with the band hidden: it explains why work stopped.
    if (e.props.hasSurvey || current === null || (paused === null && (await read($, isHidden)))) {
      return next(e)
    }

    const at = (await read($, now)) || (await $.clock.now()) // before the first tick
    const isWindowOpen = current.window !== null && at < current.window.end
    const { Box, Text, Button } = $.ui.resolve(e)
    return bandView(
      { Box, Text, Button },
      {
        snapshot: { ...current, window: isWindowOpen ? current.window : null },
        now: at,
        columns: e.props.bodyColumns,
        pause: paused && { record: paused, autoResume, onResume: () => resumeNow($), onCancel: () => cancelPause($) },
      },
    )
  })
}
