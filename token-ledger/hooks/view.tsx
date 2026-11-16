// The band's drawing. Pure: it takes the surface's elements and the data, never `$`.
//
//   ╭──────────────────────────────────────────────────────────────────────────╮
//   │ ◆ Session    1158.3M  [▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇]                     │
//   │                       ● input 20.3k  ● output 4.07M  ● cache read 1144.3M  ● … │
//   │ ◷ 5h window   262.7M  [▇▇▇▇▇▇▇▇▇·······················]  28% used · resets … │
//   ╰──────────────────────────────────────────────────────────────────────────╯
//
// While paused, a warning row leads the card and the border turns amber:
//   │ ⏸ Paused    weekly limit at 96% · auto-resume 10-18 15:12 · in 1d 3h  [ Resume now ] [ Cancel ] │
//
// Layout rule: the desktop draws text in a proportional font, so nothing is sized by counting
// characters. Bars are Boxes of a fixed cell width filled with a background colour, labels and
// values sit in fixed slots that never shrink, and only the trailing text may be cut short.
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

const LABEL_WIDTH = 13
const VALUE_WIDTH = 9 // "1158.3M" plus a gap before the bar
const GUTTER = LABEL_WIDTH + VALUE_WIDTH
const CHROME = 4 // border (2) + paddingX (2)
const NARROW = 64
const MAX_BAR = 48
const MIN_BAR = 6
const TAIL_ROOM = 34 // cells kept for "28% used · resets 03:40 · 2h 15m left"
const NARROW_TAIL_ROOM = 14
const TRACK: Color = 'inactive'

const windowTail = (w: WindowSummary, now: number, isNarrow: boolean): { headline: string; detail: string } => {
  const left = countdown(Math.max(0, w.end - now))
  const resets = localTime(w.end).slice(11, 16)
  if (w.isEstimated) {
    return isNarrow ? { headline: `~${left}`, detail: '' } : { headline: `~resets ${resets}`, detail: `${left} left (est.)` }
  }
  const used = `${w.percentUsed ?? 0}%`
  return isNarrow ? { headline: used, detail: left } : { headline: `${used} used`, detail: `resets ${resets} · ${left} left` }
}

/** `15:12` today, `10-18 15:12` on another day. */
const whenText = (at: number, now: number): string => {
  const stamp = localTime(at)
  return stamp.slice(0, 10) === localTime(now).slice(0, 10) ? stamp.slice(11, 16) : stamp.slice(5, 16)
}

/** The width both bars share, so the session bar and the window meter line up. */
export const barWidthFor = (columns: number): number => {
  const inner = Math.max(20, columns - CHROME)
  const room = inner < NARROW ? NARROW_TAIL_ROOM : TAIL_ROOM
  return Math.max(MIN_BAR, Math.min(MAX_BAR, inner - GUTTER - room))
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

  const meterRow = (open: WindowSummary) => {
    // A real window meters plan usage; an estimate can only meter elapsed time.
    const fraction = open.isEstimated
      ? (now - open.start) / (open.end - open.start)
      : (open.percentUsed ?? 0) / 100
    const tone: Color = open.isEstimated ? 'inactive' : usageTone(open.percentUsed ?? 0)
    const { headline, detail } = windowTail(open, now, isNarrow)
    return (
      <Box>
        {label('◷', '5h window')}
        {value(grandTotal(open.totals))}
        {bar('window-bar', meterSegments(fraction, barWidth, tone))}
        <Box flexShrink={0} paddingLeft={1}>
          <Text color={tone} bold={!open.isEstimated}>{headline}</Text>
        </Box>
        {/* The only part allowed to give way: cut short, never wrapped onto a second line. */}
        <Box flexShrink={1} minWidth={0} overflow="hidden">
          <Text dimColor wrap="truncate">{detail ? ` · ${detail}` : ''}</Text>
        </Box>
      </Box>
    )
  }

  const windowRow = w ? (
    meterRow(w)
  ) : (
    <Box>
      {label('◷', '5h window')}
      <Text dimColor wrap="truncate">no requests in the current window yet</Text>
    </Box>
  )

  const pauseRow = (p: PauseModel) => {
    const { record } = p
    const limit = `${LIMIT_LABEL[record.kind]} limit at ${record.percentUsed}%`
    const plan = p.autoResume
      ? `auto-resume ${whenText(record.resumeAt, now)} · in ${countdown(Math.max(0, record.resumeAt - now))}`
      : 'auto-resume off · /tokens resume to continue'
    return (
      <Box columnGap={1} flexWrap="wrap">
        <Box width={LABEL_WIDTH - 1} flexShrink={0}>
          <Text color="warning" bold>⏸ Paused</Text>
        </Box>
        <Text color="warning">{limit}</Text>
        <Text dimColor wrap="truncate">· {isNarrow ? countdown(Math.max(0, record.resumeAt - now)) : plan}</Text>
        <Button key="resume" label="Resume now" variant="primary" onPress={p.onResume} />
        {p.autoResume && <Button key="cancel" label="Cancel" onPress={p.onCancel} />}
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
      {pause && pauseRow(pause)}
      {sessionRow}
      {snapshot.session.requests > 0 && legendRow}
      {windowRow}
    </Box>
  )
}
