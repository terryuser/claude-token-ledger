import { describe, expect, test } from 'claude-code/testing'

import { csvLine, logDirFrom } from '../hooks/csv'
import { compact } from '../hooks/format'
import { FIVE_HOURS_MS, emptyTotals, grandTotal, recordResponse, resolveWindow } from '../hooks/ledger'
import type { LedgerData } from '../hooks/ledger'

const HOUR = 60 * 60 * 1000
const T0 = Date.parse('2026-10-09T02:00:00.000Z')
const tokens = { input: 10, output: 20, cacheRead: 300, cacheWrite: 4 }
const empty = (): LedgerData => ({ windows: [], sessions: [] })

describe('estimated windows (no rate-limit reading)', () => {
  test('a window starts at the top of the hour and lasts five hours', async () => {
    const { window } = resolveWindow([], T0 + 23 * 60 * 1000, null)
    expect(window.start).toBe(T0)
    expect(window.end).toBe(T0 + FIVE_HOURS_MS)
    expect(window.isEstimated).toBe(true)
  })

  test('requests inside the window share it; one after it opens a new one', async () => {
    const first = resolveWindow([], T0, null)
    const inside = resolveWindow(first.windows, T0 + 4 * HOUR, null)
    expect(inside.windows.length).toBe(1)
    const after = resolveWindow(inside.windows, T0 + 5 * HOUR + 1, null)
    expect(after.windows.length).toBe(2)
    expect(after.window.start).toBe(T0 + 5 * HOUR)
  })
})

describe('real windows (rate-limit reading)', () => {
  const reading = { resetsAt: '2026-10-09T07:00:00.000Z', percentUsed: 12 }

  test('the window ends at resetsAt', async () => {
    const { window } = resolveWindow([], T0 + HOUR, reading)
    expect(window.end).toBe(Date.parse(reading.resetsAt))
    expect(window.isEstimated).toBe(false)
  })

  test('an open estimated window is upgraded, keeping its tokens', async () => {
    const estimated = recordResponse(empty(), { sessionId: 's', project: 'p', now: T0, tokens, reading: null })
    const real = recordResponse(estimated.data, { sessionId: 's', project: 'p', now: T0 + HOUR, tokens, reading })
    expect(real.data.windows.length).toBe(1)
    expect(real.window.isEstimated).toBe(false)
    expect(real.window.totals.requests).toBe(2)
    expect(real.window.percentUsed).toBe(12)
  })

  test('readings a few seconds apart are the same window', async () => {
    const a = resolveWindow([], T0, reading)
    const b = resolveWindow(a.windows, T0 + HOUR, { ...reading, resetsAt: '2026-10-09T07:00:30.000Z' })
    expect(b.windows.length).toBe(1)
  })
})

describe('sessions', () => {
  test('two sessions in one window are counted apart and together', async () => {
    const a = recordResponse(empty(), { sessionId: 'a', project: 'p', now: T0, tokens, reading: null })
    const b = recordResponse(a.data, { sessionId: 'b', project: 'q', now: T0 + 1, tokens, reading: null })
    const a2 = recordResponse(b.data, { sessionId: 'a', project: 'p', now: T0 + 2, tokens, reading: null })
    expect(a2.session.totals.requests).toBe(2)
    expect(a2.data.sessions.length).toBe(2)
    expect(a2.window.totals.requests).toBe(3)
    expect(a2.window.sessionIds).toEqual(['a', 'b'])
    expect(grandTotal(a2.window.totals)).toBe(3 * 334)
  })
})

describe('formatting', () => {
  test('compact numbers', async () => {
    expect(compact(950)).toBe('950')
    expect(compact(1000)).toBe('1k')
    expect(compact(12_345)).toBe('12.3k')
    expect(compact(4_560_000)).toBe('4.56M')
    expect(compact(20_000_000)).toBe('20M')
  })

  test('csv escapes commas and quotes', async () => {
    expect(csvLine(['a,b', 'say "hi"', 1, null])).toBe('"a,b","say ""hi""",1,\r\n')
  })

  test('log dir from a Windows home', async () => {
    expect(logDirFrom('C:\\Users\\me\\')).toBe('C:/Users/me/.claude/token-log')
  })

  test('empty totals are zero', async () => {
    expect(grandTotal(emptyTotals())).toBe(0)
  })
})
