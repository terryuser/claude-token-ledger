import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { RESUME_BUFFER_MS, RESUME_PROMPT, findLimitHit, isResumeDue, makePause, parseThreshold } from '../hooks/pause'
import { NOW, RESETS, WEEK_RESETS, setupWorld, step } from './harness'

const reading = (kind: string, percentUsed: number, resetsAt = RESETS) => ({ kind, percentUsed, resetsAt })

describe('findLimitHit', () => {
  test('nothing below the threshold', async () => {
    expect(findLimitHit([reading('five_hour', 94.9)], 95, NOW)).toBe(null)
  })

  test('the 5-hour limit at the threshold', async () => {
    expect(findLimitHit([reading('five_hour', 95)], 95, NOW)?.kind).toBe('five_hour')
  })

  test('the weekly limit counts too', async () => {
    expect(findLimitHit([reading('five_hour', 20), reading('seven_day', 97, WEEK_RESETS)], 95, NOW)?.kind).toBe('seven_day')
  })

  test('both hit: wait for the later reset', async () => {
    const hit = findLimitHit([reading('five_hour', 99), reading('seven_day', 96, WEEK_RESETS)], 95, NOW)
    expect(hit?.resetsAt).toBe(WEEK_RESETS)
  })

  test('a reading whose reset is past is stale', async () => {
    expect(findLimitHit([reading('five_hour', 99)], 95, Date.parse(RESETS) + 1)).toBe(null)
  })

  test('other limits (a gateway spend limit) are not watched', async () => {
    expect(findLimitHit([reading('spend_limit', 120)], 95, NOW)).toBe(null)
  })
})

describe('pause record', () => {
  test('resumes a little after the reset', async () => {
    const hit = { kind: 'five_hour' as const, percentUsed: 96, resetsAt: RESETS }
    const pause = makePause('s', hit, NOW, 'threshold')
    expect(pause.resumeAt).toBe(Date.parse(RESETS) + RESUME_BUFFER_MS)
    expect(isResumeDue(pause, pause.resumeAt - 1)).toBe(false)
    expect(isResumeDue(pause, pause.resumeAt)).toBe(true)
  })

  test('typed thresholds are clamped to 50-100', async () => {
    expect(parseThreshold('90', 95)).toBe(90)
    expect(parseThreshold('20', 95)).toBe(50)
    expect(parseThreshold('150', 95)).toBe(100)
    expect(parseThreshold('abc', 95)).toBe(95)
  })
})

/** The engine-side answers a session gives beneath the plugin. */
const bootSession = async ($: Engine, on: On) => {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'done' }))
  await $.session.start({ cwd: 'D:\\work\\demo-app', surface: null, isInteractive: true })
}

test('a reply that asks for tools at 95% stops the turn; one that ends it does not', async ($, on) => {
  const world = setupWorld(on, 96)
  await bootSession($, on)

  await $.turn.start({ text: 'refactor', turnId: 't1' })
  world.callsTools = false
  await step($, 0)
  expect(world.aborted).toEqual([]) // the turn ends anyway

  world.callsTools = true
  await step($, 1)
  expect(world.aborted).toEqual(['t1'])
})

test('below the threshold nothing stops', async ($, on) => {
  const world = setupWorld(on, 60)
  await bootSession($, on)
  await $.turn.start({ text: 'refactor', turnId: 't1' })
  world.callsTools = true
  await step($, 0)
  expect(world.aborted).toEqual([])
})

test('the weekly limit pauses too', async ($, on) => {
  const world = setupWorld(on, 30)
  world.sevenDay = 98
  await bootSession($, on)
  await $.turn.start({ text: 'refactor', turnId: 't1' })
  world.callsTools = true
  await step($, 0)
  expect(world.aborted).toEqual(['t1'])
})

test('a prompt typed while paused is let through', async ($, on) => {
  const world = setupWorld(on, 96)
  await bootSession($, on)
  world.callsTools = true
  await $.turn.start({ text: 'refactor', turnId: 't1' })
  await step($, 0, 't1')
  await $.turn.start({ text: 'quick question', turnId: 't2' })
  await step($, 0, 't2')
  expect(world.aborted).toEqual(['t1'])
})

test('after the reset the session continues by itself', async ($, on) => {
  const world = setupWorld(on, 96)
  await bootSession($, on)
  world.callsTools = true
  await $.turn.start({ text: 'refactor', turnId: 't1' })
  await step($, 0)

  await world.clock.set(Date.parse(RESETS) + 60_000) // reset passed, buffer not yet
  expect(world.submitted).toEqual([])

  await world.clock.set(Date.parse(RESETS) + RESUME_BUFFER_MS + 30_000)
  expect(world.submitted).toEqual([RESUME_PROMPT])

  // The stale 96% reading of the old window does not pause the resumed turn.
  await $.turn.start({ text: RESUME_PROMPT, turnId: 't2' })
  await step($, 0, 't2')
  expect(world.aborted).toEqual(['t1'])
})

test('a request refused at the limit pauses too', async ($, on) => {
  const world = setupWorld(on, 100)
  await bootSession($, on)
  await $.turn.start({ text: 'refactor', turnId: 't1' })
  await $.turn.complete({ turnId: 't1', reason: 'error', answer: '', durationMs: 1 } as never)

  await world.clock.set(Date.parse(RESETS) + RESUME_BUFFER_MS + 30_000)
  expect(world.submitted).toEqual([RESUME_PROMPT])
})

test('cancel stops the auto-resume', async ($, on) => {
  const world = setupWorld(on, 96)
  await bootSession($, on)
  world.callsTools = true
  await $.turn.start({ text: 'refactor', turnId: 't1' })
  await step($, 0)

  await $.command.run({ command: 'tokens', args: 'cancel' } as never)
  await world.clock.set(Date.parse(RESETS) + RESUME_BUFFER_MS + 30_000)
  expect(world.submitted).toEqual([])
})
