// The band's drawing. Pure: it takes the surface's elements and the data, never `$`.
//
//   ╭──────────────────────────────────────────────────────────────────────╮
//   │ ◆ Session   1.24M  ████████▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒                      │
//   │                    ● in 3.4k  ● out 12k  ● cache read 1.1M  ● …     │
//   │ ◷ 5h window 4.5M   █████░░░░░░░░░░░░░░░░░░░  23% · resets 15:00 · 2h 14m │
//   ╰──────────────────────────────────────────────────────────────────────╯
//
// While paused, a warning row leads the card and the border turns amber:
//   │ ⏸ Paused    weekly limit at 96% · auto-resume 10-18 15:12 · in 1d 3h  [ Resume now ] [ Cancel ] │
import type { BoxProps, ButtonProps, ElementConstructor, TextProps } from 'claude-code'

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

const LABEL_WIDTH = 12
const VALUE_WIDTH = 7
const CHROME = 4 // border (2) + paddingX (2)
const NARROW = 64
const FULL = '█'
const EMPTY = '░'

const windowTail = (w: WindowSummary, now: number, isNarrow: boolean): string => {
  const left = countdown(Math.max(0, w.end - now))
  const resets = localTime(w.end).slice(11, 16)
  if (w.isEstimated) return isNarrow ? `~${left} left` : `~resets ${resets} · ${left} left (est.)`
  const used = `${w.percentUsed ?? 0}%`
  return isNarrow ? `${used} · ${left}` : `${used} used · resets ${resets} · ${left} left`
}

/** `15:12` today, `10-18 15:12` on another day. */
const whenText = (at: number, now: number): string => {
  const stamp = localTime(at)
  return stamp.slice(0, 10) === localTime(now).slice(0, 10) ? stamp.slice(11, 16) : stamp.slice(5, 16)
}

export function bandView({ Box, Text, Button }: BandElements, { snapshot, now, columns, pause }: BandModel) {
  const inner = Math.max(20, columns - CHROME)
  const isNarrow = inner < NARROW
  const w = snapshot.window
  const tail = w ? windowTail(w, now, isNarrow) : ''
  const barWidth = Math.max(6, Math.min(48, inner - LABEL_WIDTH - VALUE_WIDTH - tail.length - 2))

  const label = (icon: string, text: string) => (
    <Box width={LABEL_WIDTH}>
      <Text color="claude" bold>{icon} </Text>
      <Text bold>{text}</Text>
    </Box>
  )
  const value = (n: number) => (
    <Box width={VALUE_WIDTH}>
      <Text bold>{compact(n)}</Text>
    </Box>
  )

  const sessionRow = (
    <Box>
      {label('◆', 'Session')}
      {value(grandTotal(snapshot.session))}
      {snapshot.session.requests === 0 ? (
        <Text dimColor>no requests yet</Text>
      ) : (
        stackSegments(snapshot.session, barWidth).map(s => <Text color={s.color}>{FULL.repeat(s.cells)}</Text>)
      )}
    </Box>
  )

  const legendRow = (
    <Box paddingLeft={LABEL_WIDTH + VALUE_WIDTH} columnGap={2} flexWrap="wrap">
      {PARTS.map(p => (
        <Box>
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
    const filled = meterFill(fraction, barWidth)
    const tone = open.isEstimated ? 'inactive' : usageTone(open.percentUsed ?? 0)
    const [headline, ...rest] = tail.split(' · ')
    return (
      <Box>
        {label('◷', '5h window')}
        {value(grandTotal(open.totals))}
        <Text color={tone}>{FULL.repeat(filled)}</Text>
        <Text color="inactive">{EMPTY.repeat(barWidth - filled)}</Text>
        <Text color={tone} bold={!open.isEstimated}> {headline}</Text>
        <Text dimColor wrap="truncate">{rest.length > 0 ? ` · ${rest.join(' · ')}` : ''}</Text>
      </Box>
    )
  }

  const windowRow = w ? (
    meterRow(w)
  ) : (
    <Box>
      {label('◷', '5h window')}
      <Text dimColor>no requests in the current window yet</Text>
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
        <Box width={LABEL_WIDTH - 1}>
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
