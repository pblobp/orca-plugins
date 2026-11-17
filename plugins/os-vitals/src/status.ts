import type { Clock } from './clock.ts'
import type { LoadAverage } from './protocol.ts'
import type { StatusBarMode } from './settings.ts'

export const STATUS_BAR_ID = 'os-vitals'
export const STATUS_MIN_INTERVAL_MS = 5000

export type StatusTone = 'neutral' | 'warning' | 'danger'

export type StatusView = {
  text: string
  tone: StatusTone
  tooltip: string
}

export type StatusInput = {
  cpu: number | null
  memory: number | null
  load: LoadAverage | null
}

export type StatusBarUpdate = {
  id: string
  text?: string
  tone?: StatusTone
  tooltip?: string
  visible?: boolean
}

export type StatusBar = {
  applyVisibility(mode: StatusBarMode): void
  show(mode: StatusBarMode, input: StatusInput, force?: boolean): void
}

export function percentText(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '–' : `${Math.round(value)}%`
}

export function loadText(load: LoadAverage): string {
  return load.map((value) => value.toFixed(2)).join(' · ')
}

export function statusView(mode: StatusBarMode, input: StatusInput): StatusView | null {
  if (mode === 'hidden') return null
  const parts: string[] = []
  if (mode !== 'memory') parts.push(`CPU ${percentText(input.cpu)}`)
  if (mode === 'memory' || (mode === 'cpu-memory' && input.memory !== null)) {
    parts.push(`MEM ${percentText(input.memory)}`)
  }
  const lines = ['OS Vitals']
  if (input.load) lines.push(`Load ${loadText(input.load)}`)
  return { text: parts.join(' · '), tone: 'neutral', tooltip: lines.join('\n') }
}

function sameView(a: StatusView, b: StatusView): boolean {
  return a.text === b.text && a.tone === b.tone && a.tooltip === b.tooltip
}

export function createStatusBar(deps: {
  clock: Clock
  update: (params: StatusBarUpdate) => void
}): StatusBar {
  let lastSent: StatusView | null = null
  let lastSentAt = Number.NEGATIVE_INFINITY
  return {
    applyVisibility(mode) {
      const visible = mode !== 'hidden'
      if (!visible) lastSent = null
      deps.update({ id: STATUS_BAR_ID, visible })
    },
    show(mode, input, force = false) {
      const view = statusView(mode, input)
      if (!view) return
      if (lastSent && sameView(view, lastSent)) return
      const now = deps.clock.now()
      if (!force && now - lastSentAt < STATUS_MIN_INTERVAL_MS) return
      lastSent = view
      lastSentAt = now
      deps.update({ id: STATUS_BAR_ID, text: view.text, tone: view.tone, tooltip: view.tooltip })
    }
  }
}
