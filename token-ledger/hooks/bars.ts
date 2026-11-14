// Pure maths for the band's bars: how many cells each colour gets. No `$`, no JSX.
import type { ThemeKey } from 'claude-code'

import type { Tokens } from '../types'

export type Part = keyof Tokens

/** Theme keys adapt to the person's light/dark theme; none of these mean good/bad. */
export const PARTS: readonly { key: Part; label: string; short: string; color: ThemeKey }[] = [
  { key: 'input', label: 'input', short: 'in', color: 'suggestion' },
  { key: 'output', label: 'output', short: 'out', color: 'claude' },
  { key: 'cacheRead', label: 'cache read', short: 'c.read', color: 'remember' },
  { key: 'cacheWrite', label: 'cache write', short: 'c.write', color: 'merged' },
]

export type Segment = { key: Part; color: ThemeKey; cells: number }

/**
 * Splits `width` cells across the four token kinds by share (largest remainder),
 * giving every non-zero kind at least one cell so a small share stays visible.
 */
export const stackSegments = (tokens: Tokens, width: number): Segment[] => {
  const total = PARTS.reduce((sum, p) => sum + tokens[p.key], 0)
  if (total === 0 || width <= 0) return []

  const exact = PARTS.map(p => ({ part: p, share: (tokens[p.key] / total) * width }))
  const cells = exact.map(x => (tokens[x.part.key] > 0 ? Math.max(1, Math.floor(x.share)) : 0))

  let spare = width - cells.reduce((a, b) => a + b, 0)
  const byRemainder = exact
    .map((x, i) => ({ i, rest: x.share - Math.floor(x.share) }))
    .sort((a, b) => b.rest - a.rest)
  for (let k = 0; spare > 0; k = (k + 1) % byRemainder.length) {
    const i = byRemainder[k]!.i
    if (tokens[PARTS[i]!.key] > 0) {
      cells[i]! += 1
      spare -= 1
    }
  }
  // The minimum of one cell can overshoot on tiny widths: take back from the largest.
  while (spare < 0) {
    const largest = cells.indexOf(Math.max(...cells))
    cells[largest]! -= 1
    spare += 1
  }

  return PARTS.map((p, i) => ({ key: p.key, color: p.color, cells: cells[i]! })).filter(s => s.cells > 0)
}

/** Filled cells of a meter for a 0..1 fraction (clamped). */
export const meterFill = (fraction: number, width: number): number =>
  Math.round(Math.min(1, Math.max(0, fraction)) * width)

export type Tone = 'success' | 'warning' | 'error'

/** Plan usage: calm under half, a warning past half, alarm from 80%. */
export const usageTone = (percent: number): Tone =>
  percent >= 80 ? 'error' : percent >= 50 ? 'warning' : 'success'

/** 1d 3h · 2h 14m · 14m · <1m (the weekly limit can be days away). */
export const countdown = (ms: number): string => {
  if (ms < 60_000) return '<1m'
  const minutes = Math.floor(ms / 60_000)
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d > 0) return `${d}d ${h}h`
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
