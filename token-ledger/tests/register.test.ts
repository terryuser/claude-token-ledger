import { expect, test } from 'claude-code/testing'

import type { Snapshot } from '../types'
import { localDate } from '../hooks/csv'
import { DIR, NOW, setupWorld, step } from './harness'

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

  const rows = files.get(`${DIR}/responses/${localDate(NOW)}_sess-1.csv`)?.trim().split('\r\n') ?? []
  expect(rows.length).toBe(3) // header + 2 requests
  expect(rows[1]).toContain('sess-1,demo-app,main,turn,claude-opus-5-5,5,7,1000,50,1062')
  expect(files.get(`${DIR}/sessions.csv`)).toContain('sess-1,demo-app')
  expect(files.get(`${DIR}/windows.csv`)?.split('\r\n')[1]).toContain('false,9,1,2,10,14,2000,100,2124')
})
