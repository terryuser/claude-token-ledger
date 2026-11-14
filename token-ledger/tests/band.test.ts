import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { countdown, meterFill, stackSegments, usageTone } from '../hooks/bars'
import { compact } from '../hooks/format'
import { setupWorld, step } from './harness'

describe('bars', () => {
  test('segments fill the width exactly, by share', async () => {
    const segments = stackSegments({ input: 10, output: 30, cacheRead: 60, cacheWrite: 0 }, 20)
    expect(segments.map(s => [s.key, s.cells])).toEqual([['input', 2], ['output', 6], ['cacheRead', 12]])
  })

  test('a tiny share still gets one cell', async () => {
    const segments = stackSegments({ input: 1, output: 1, cacheRead: 100_000, cacheWrite: 1 }, 10)
    expect(segments.map(s => s.cells)).toEqual([1, 1, 7, 1])
  })

  test('nothing to draw for no tokens', async () => {
    expect(stackSegments({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, 10)).toEqual([])
  })

  test('meter and tone', async () => {
    expect(meterFill(0.23, 20)).toBe(5)
    expect(meterFill(1.4, 20)).toBe(20)
    expect(usageTone(23)).toBe('success')
    expect(usageTone(50)).toBe('warning')
    expect(usageTone(80)).toBe('error')
  })

  test('countdown', async () => {
    expect(countdown(30_000)).toBe('<1m')
    expect(countdown(14 * 60_000)).toBe('14m')
    expect(countdown((2 * 60 + 14) * 60_000)).toBe('2h 14m')
  })

  test('compact does not print 1000k', async () => {
    expect(compact(999_999)).toBe('1M')
  })
})

const bandProps = (bodyColumns: number) => ({
  hasSurvey: false,
  isCollapsed: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
})

const textOf = async ($: Engine, surface: 'terminal' | 'desktop', columns: number): Promise<string> => {
  const ui = await $.ui.mount({ plugin: 'token-ledger', surface, component: 'AbovePrompt', props: bandProps(columns) })
  const drawn = await ui.find({ type: 'Box' })
  await ui.unmount()
  return drawn?.text ?? ''
}

test('the band shows session totals, the legend and the window meter', async ($, on) => {
  setupWorld(on, 23)
  await step($, 0)

  for (const surface of ['terminal', 'desktop'] as const) {
    const wide = await textOf($, surface, 110)
    expect(wide).toContain('Session')
    expect(wide).toContain('1.06k')
    expect(wide).toContain('cache read')
    expect(wide).toContain('23% used')
    expect(wide).toContain('4h 0m left')

    const narrow = await textOf($, surface, 50)
    expect(narrow).toContain('c.read')
    expect(narrow).toContain('23% · 4h 0m')
  }
})

test('while paused the band says why and Resume now continues', async ($, on) => {
  const world = setupWorld(on, 96)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  world.callsTools = true
  await $.turn.start({ text: 'refactor', turnId: 't1' })
  await step($, 0)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'token-ledger', surface, component: 'AbovePrompt', props: bandProps(120) })
    const text = (await ui.find({ type: 'Box' }))?.text ?? ''
    expect(text).toContain('Paused')
    expect(text).toContain('5-hour limit at 96%')
    expect(text).toContain('auto-resume')
    if (surface === 'desktop') {
      await ui.press({ key: 'resume' })
      expect(world.submitted.length).toBe(1)
    }
    await ui.unmount()
  }
})
