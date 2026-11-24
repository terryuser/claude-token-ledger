// The band's drawing. Pure: it takes the surface's elements and the data, never `$`.
//
//   ╭──────────────────────────────────────────────────────────────────────────╮
//   │ ◆ Session      59.7M  [▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇]      │
//   │                       ● input 350  ● output 144.6k  ● cache read 57.2M  ● …  │
//   │ ◷ 5h window   300.3M  [▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇·······························]      │
//   │                       35% used  ·  resets 03:40  ·  1h 55m left              │
//   ╰──────────────────────────────────────────────────────────────────────────╯
//
// Each bar has one quieter line beneath it, starting at the bar's left edge: the
// legend under the session bar, the window's status under the meter.
//
// While paused, a block leads the card and the border turns amber. Its lines start where the bars do:
//   │ ⏸ Paused              5-hour limit at 96%                                        │
//   │                       Auto-resume at 15:12 · in 1h 12m · subagents wait too       │
//   │                       [ Resume now ]  [ Cancel auto-resume ]                      │
//   │                                                                                  │
//   │ ◆ Session ...                                                                    │
//
// Layout rule: the desktop draws text in a proportional font, so nothing is sized by counting
// characters. Bars are Boxes of a fixed cell width filled with a background colour, labels and
// values sit in fixed slots that never shrink, and nothing shares a row with a bar, so no text
// can push or wrap around one.
import type { BoxProps, ButtonProps, Color, ElementConstructor, TextProps } from 'claude-code'

import type { PauseRecord, Snapshot, WindowSummary } from '../types'
import { PARTS, countdown, meterFill, stackSegments, usageTone } from './bars'
import { localTime } from './csv'
import { compact } from './format'
import { grandTotal } from './ledger'
import { LIMIT_LABEL } from './pause'

export type BandElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
}

export type PauseModel = {
  record: PauseRecord
  autoResume: boolean
  onResume: () => void
  onCancel: () => void
}

export type BandModel = {
  snapshot: Snapshot
  now: number
  /** The band's usable width (`e.props.bodyColumns`). */
  columns: number
  pause: PauseModel | null
}

/** One coloured run of a bar, `cells` wide. */
export type BarSegment = { key: string; color: Color; cells: number }

const LABEL_WIDTH = 14 // "◷ 5h window" in a bold proportional font, with room to spare
const VALUE_WIDTH = 9 // "1158.3M" plus a gap before the bar
const GUTTER = LABEL_WIDTH + VALUE_WIDTH
const CHROME = 4 // border (2) + paddingX (2)
const NARROW = 64
const MAX_BAR = 64
const MIN_BAR = 6
const TRACK: Color = 'inactive'

/** The window's status line: a headline in the usage tone, then dim details. */
export const windowStatus = (w: WindowSummary, now: number, isNarrow: boolean): { headline: string; details: string[] } => {
  const left = `${countdown(Math.max(0, w.end - now))} left`
  const resets = `resets ${localTime(w.end).slice(11, 16)}`
  if (w.isEstimated) {
    return { headline: isNarrow ? `~${left}` : `~${resets}`, details: isNarrow ? [] : [left, 'estimated'] }
  }
  const used = `${w.percentUsed ?? 0}%`
  return isNarrow ? { headline: used, details: [left] } : { headline: `${used} used`, details: [resets, left] }
}

/** `15:12` today, `10-18 15:12` on another day. */
const whenText = (at: number, now: number): string => {
  const stamp = localTime(at)
  return stamp.slice(0, 10) === localTime(now).slice(0, 10) ? stamp.slice(11, 16) : stamp.slice(5, 16)
}

/** The width both bars share, so the session bar and the window meter line up. */
export const barWidthFor = (columns: number): number => {
  const inner = Math.max(20, columns - CHROME)
  return Math.max(MIN_BAR, Math.min(MAX_BAR, inner - GUTTER))
}

/** The window meter's runs: the filled part in the usage tone, the rest as a dim track. */
export const meterSegments = (fraction: number, width: number, tone: Color): BarSegment[] => {
  const filled = meterFill(fraction, width)
  return [
    { key: 'meter-fill', color: tone, cells: filled },
    { key: 'meter-track', color: TRACK, cells: width - filled },
  ].filter(s => s.cells > 0)
}

export function bandView({ Box, Text, Button }: BandElements, { snapshot, now, columns, pause }: BandModel) {
  const isNarrow = Math.max(20, columns - CHROME) < NARROW
  const barWidth = barWidthFor(columns)
  const w = snapshot.window

  const label = (icon: string, text: string) => (
    <Box width={LABEL_WIDTH} flexShrink={0}>
      <Text color="claude" bold>{icon} </Text>
      <Text bold wrap="truncate">{text}</Text>
    </Box>
  )
  const value = (n: number) => (
    <Box width={VALUE_WIDTH} flexShrink={0} justifyContent="flex-end" paddingRight={1}>
      <Text bold>{compact(n)}</Text>
    </Box>
  )
  // A run is a Box of fixed width with a background colour: the same length on every surface.
  const bar = (key: string, segments: BarSegment[]) => (
    <Box key={key} width={barWidth} flexShrink={0}>
      {segments.map(s => (
        <Box key={s.key} width={s.cells} flexShrink={0} backgroundColor={s.color}>
          <Text> </Text>
        </Box>
      ))}
    </Box>
  )

  const sessionRow = (
    <Box>
      {label('◆', 'Session')}
      {value(grandTotal(snapshot.session))}
      {snapshot.session.requests === 0 ? (
        <Text dimColor>no requests yet</Text>
      ) : (
        bar(
          'session-bar',
          stackSegments(snapshot.session, barWidth).map(s => ({ key: `session-${s.key}`, color: s.color, cells: s.cells })),
        )
      )}
    </Box>
  )

  const legendRow = (
    <Box paddingLeft={GUTTER} columnGap={2} flexWrap="wrap">
      {PARTS.map(p => (
        <Box key={`legend-${p.key}`} flexShrink={0}>
          <Text color={p.color}>● </Text>
          <Text dimColor>{isNarrow ? p.short : p.label} </Text>
          <Text>{compact(snapshot.session[p.key])}</Text>
        </Box>
      ))}
    </Box>
  )

  // The meter and, beneath it, the status line, as a pair like the session bar and its legend.
  const windowBlock = (open: WindowSummary) => {
    // A real window meters plan usage; an estimate can only meter elapsed time.
    const fraction = open.isEstimated
      ? (now - open.start) / (open.end - open.start)
      : (open.percentUsed ?? 0) / 100
    const tone: Color = open.isEstimated ? 'inactive' : usageTone(open.percentUsed ?? 0)
    const { headline, details } = windowStatus(open, now, isNarrow)
    return (
      <Box flexDirection="column">
        <Box>
          {label('◷', '5h window')}
          {value(grandTotal(open.totals))}
          {bar('window-bar', meterSegments(fraction, barWidth, tone))}
        </Box>
        <Box key="window-status" paddingLeft={GUTTER}>
          <Text color={tone} bold={!open.isEstimated}>{headline}</Text>
          <Text dimColor wrap="truncate">{details.map(d => `  ·  ${d}`).join('')}</Text>
        </Box>
      </Box>
    )
  }

  const windowRow = w ? (
    windowBlock(w)
  ) : (
    <Box>
      {label('◷', '5h window')}
      <Text dimColor wrap="truncate">no requests in the current window yet</Text>
    </Box>
  )

  const pauseBlock = (p: PauseModel) => {
    const { record } = p
    const left = countdown(Math.max(0, record.resumeAt - now))
    const plan = p.autoResume
      ? isNarrow
        ? `Auto-resume in ${left}`
        : `Auto-resume at ${whenText(record.resumeAt, now)} · in ${left} · subagents wait too`
      : 'Auto-resume is off: press Resume now when ready'
    return (
      <Box key="pause" marginBottom={1}>
        <Box width={GUTTER} flexShrink={0}>
          <Text color="warning" bold>⏸ Paused</Text>
        </Box>
        <Box flexDirection="column" flexShrink={1} minWidth={0}>
          <Text color="warning" bold wrap="truncate">
            {LIMIT_LABEL[record.kind]} limit at {record.percentUsed}%
          </Text>
          <Text dimColor wrap="truncate">{plan}</Text>
          <Box columnGap={2} flexWrap="wrap">
            <Button key="resume" label="Resume now" variant="primary" onPress={p.onResume} />
            {p.autoResume && <Button key="cancel" label="Cancel auto-resume" onPress={p.onCancel} />}
          </Box>
        </Box>
      </Box>
    )
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={pause ? 'warning' : 'claude'}
      borderDimColor={!pause}
      paddingX={1}
      width={columns}
    >
      {pause && pauseBlock(pause)}
      {sessionRow}
      {snapshot.session.requests > 0 && legendRow}
      {windowRow}
    </Box>
  )
}
