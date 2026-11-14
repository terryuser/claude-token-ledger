import { expect, test } from 'claude-code/testing'

import type { Snapshot } from '../types'
import { localDate } from '../hooks/csv'
import { NOW, setupWorld, step } from './harness'

/**
 * The written file whose path ends with `suffix`. The engine resolves the fake
 * home against the working directory where it is not absolute (Linux CI), so
 * tests match on the log folder's tail rather than the full path.
 */
const fileEnding = (files: Map<string, string>, suffix: string): string | undefined =>
  [...files].find(([path]) => path.endsWith(`/.claude/token-log/${suffix}`))?.[1]

test('each model request is counted, stored and logged as CSV', async ($, on) => {
  const { files } = setupWorld(on)

  let last = null as Snapshot | null
  on('state.set', ($, e, next) => {
    if (e.key === 'snapshot') last = e.value as Snapshot
    return next(e)
  })

  await step($, 0)
  await step($, 1)

  expect(last?.session.requests).toBe(2)
  expect(last?.session.cacheRead).toBe(2000)
  expect(last?.window?.percentUsed).toBe(9)
  expect(last?.window?.isEstimated).toBe(false)

  const rows = fileEnding(files, `responses/${localDate(NOW)}_sess-1.csv`)?.trim().split('\r\n') ?? []
  expect(rows.length).toBe(3) // header + 2 requests
  expect(rows[1]).toContain('sess-1,demo-app,main,turn,claude-opus-5-5,5,7,1000,50,1062')
  expect(fileEnding(files, 'sessions.csv')).toContain('sess-1,demo-app')
  expect(fileEnding(files, 'windows.csv')?.split('\r\n')[1]).toContain('false,9,1,2,10,14,2000,100,2124')
})
