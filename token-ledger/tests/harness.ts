// Shared test world: an in-memory disk, store and clock, and a session on real plan limits
// whose readings a test changes through the returned `world`.
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

export const NOW = Date.parse('2026-10-09T03:00:00.000Z')
export const RESETS = '2026-10-09T07:00:00.000Z'
export const WEEK_RESETS = '2026-10-12T00:00:00.000Z'

// The engine hands fs hooks native paths; compare with forward slashes.
const slash = (path: string): string => path.split(String.fromCharCode(92)).join('/')

export type World = {
  files: Map<string, string>
  clock: MockClock
  /** % used the next `session.usage` reports for each limit. */
  fiveHour: number
  sevenDay: number
  /** Whether the next model reply asks for a tool (so the turn would go on). */
  callsTools: boolean
  aborted: string[]
  submitted: string[]
}

export const setupWorld = (on: On, fiveHour = 9): World => {
  const world: World = {
    files: new Map(),
    clock: mock.clock(on, { now: NOW }),
    fiveHour,
    sevenDay: 10,
    callsTools: false,
    aborted: [],
    submitted: [],
  }
  mock.store(on)
  mock.env(on, { USERPROFILE: 'C:\\Users\\me' })

  on('fs.exists', ($, e) => {
    const path = slash(e.path)
    return { value: world.files.has(path) || [...world.files.keys()].some(k => k.startsWith(`${path}/`)) }
  })
  on('fs.list', ($, e) => {
    const folder = `${slash(e.path ?? '.')}/`
    const names = [...world.files.keys()].filter(k => k.startsWith(folder)).map(k => k.slice(folder.length))
    return {
      value: names
        .filter(n => !n.includes('/'))
        .map(name => ({ name, kind: 'file', size: 0, mtimeMs: 0, isLink: false }) as never),
    }
  })
  on('fs.read', ($, e) => ({ value: world.files.get(slash(e.path)) ?? '' }))
  on('fs.write', ($, e) => {
    world.files.set(slash(e.path), e.text)
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: 'D:\\work\\demo-app' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: {} as never,
      rateLimits: [
        { kind: 'five_hour', percentUsed: world.fiveHour, resetsAt: RESETS },
        { kind: 'seven_day', percentUsed: world.sevenDay, resetsAt: WEEK_RESETS },
      ],
    },
  }))
  on('ui.toast', () => ({ value: undefined }))
  on('command.register', () => ({ value: {} as never }))
  on('tool.register', () => ({ value: {} as never }))
  on('turn.abort', ($, e) => {
    world.aborted.push(e.turnId)
    return { value: undefined }
  })
  on('prompt.submit', ($, e) => {
    world.submitted.push(e.text)
    return { text: e.text }
  })
  on('turn.step', async function* ($, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'ok',
      toolUses: world.callsTools ? [{ id: 'tu1', name: 'Bash', input: {} } as never] : [],
      stopReason: world.callsTools ? 'tool_use' : 'end_turn',
      usage: {
        model: 'claude-opus-5-5',
        input_tokens: 5,
        output_tokens: 7,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 50,
      },
    }
  })
  return world
}

/** Runs one model request through every plugin's `turn.step` hooks. */
export const step = async ($: Engine, index: number, turnId = 't1'): Promise<void> => {
  const stream = $.turn.step({ turnId, index, model: 'claude-opus-5-5', messageCount: 1 })
  for await (const _ of stream) {
    // drain
  }
  await stream.result
}
