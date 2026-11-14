import { describe, expect, test } from 'claude-code/testing'

import { RESPONSE_HEADER, responseLine } from '../hooks/csv'
import { buildReport, formatReport, inScope, parseResponses, periodDates, splitCsvLine } from '../hooks/report'
import { NOW, RESETS, setupWorld, step } from './harness'

const DAY = 24 * 60 * 60 * 1000
const tokens = { input: 10, output: 20, cacheRead: 300, cacheWrite: 4 }

const csvOf = (rows: { at: number; project: string; model: string; sessionId?: string }[]) =>
  RESPONSE_HEADER +
  rows
    .map(r => responseLine({
      at: r.at, sessionId: r.sessionId ?? 's1', project: r.project, agent: 'main', source: 'turn',
      model: r.model, tokens, windowId: RESETS,
    }))
    .join('')

describe('parsing the log', () => {
  test('quoted cells keep their commas and quotes', async () => {
    expect(splitCsvLine('a,"b,c","say ""hi""",d')).toEqual(['a', 'b,c', 'say "hi"', 'd'])
  })

  test('rows round-trip from the writer', async () => {
    const rows = parseResponses(csvOf([{ at: NOW, project: 'my, project', model: 'claude-opus-5-5' }]))
    expect(rows.length).toBe(1)
    expect(rows[0]?.project).toBe('my, project')
    expect(rows[0]?.tokens).toEqual(tokens)
    expect(rows[0]?.windowId).toBe(RESETS)
  })
})

describe('periods', () => {
  test('a week is seven local dates, today first', async () => {
    const dates = periodDates('week', NOW) ?? []
    expect(dates.length).toBe(7)
    expect(periodDates('all', NOW)).toBe(null)
  })

  test('session and window scopes', async () => {
    const [row] = parseResponses(csvOf([{ at: NOW, project: 'p', model: 'm', sessionId: 's1' }]))
    const base = { now: NOW, sessionId: 's1', windowId: RESETS }
    expect(inScope(row!, { ...base, period: 'session' })).toBe(true)
    expect(inScope(row!, { ...base, period: 'session', sessionId: 's2' })).toBe(false)
    expect(inScope(row!, { ...base, period: 'window', windowId: 'other' })).toBe(false)
    expect(inScope(row!, { ...base, period: 'yesterday' })).toBe(false)
  })
})

describe('the report', () => {
  test('groups by project, model and day, biggest first', async () => {
    const rows = parseResponses(csvOf([
      { at: NOW, project: 'alpha', model: 'claude-opus-5-5' },
      { at: NOW, project: 'beta', model: 'claude-sonnet-5-5' },
      { at: NOW - DAY, project: 'beta', model: 'claude-opus-5-5' },
    ]))
    const report = buildReport(rows)
    expect(report.totals.requests).toBe(3)
    expect(report.byProject.map(([name]) => name)).toEqual(['beta', 'alpha'])
    expect(report.byDay.length).toBe(2)

    const text = formatReport('week', report)
    expect(text).toContain('Last 7 days')
    expect(text).toContain('By project')
    expect(text).toContain('| beta |')
  })

  test('says so when nothing was recorded', async () => {
    expect(formatReport('today', buildReport([]))).toContain('no requests recorded')
  })
})

test('the model can ask for a report and the status', async ($, on) => {
  const world = setupWorld(on, 40)
  await step($, 0)
  await step($, 1)

  const report = await $.tool.call({ tool: 'mcp__token-ledger__usage_report', input: { period: 'today' } } as never)
  expect(String((report as { result?: unknown }).result)).toContain('2 requests')
  expect(String((report as { result?: unknown }).result)).toContain('demo-app')

  const status = await $.tool.call({ tool: 'mcp__token-ledger__usage_control', input: { action: 'status' } } as never)
  expect(String((status as { result?: unknown }).result)).toContain('40% of the plan limit used')
  expect(world.submitted).toEqual([])
})
