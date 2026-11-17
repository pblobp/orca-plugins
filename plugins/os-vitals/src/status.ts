import type { Clock } from './clock.ts'
import { gigabytes, loadAverage, percent } from './format.ts'
import type { LoadAverage, MemoryReading } from './protocol.ts'
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
  memory: MemoryReading | null
  load: LoadAverage | null
}

export function memoryPercent(memory: MemoryReading | null): number | null {
  return memory && memory.total > 0 ? (memory.used / memory.total) * 100 : null
}

export function memoryLine(memory: MemoryReading): string {
  const amount = `Memory ${gigabytes(memory.used)} of ${gigabytes(memory.total)} GB`
  return memory.pressure ? `${amount}, pressure ${memory.pressure}` : amount
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
  failed(params: StatusBarUpdate): void
}

export function statusView(mode: StatusBarMode, input: StatusInput): StatusView | null {
  if (mode === 'hidden') return null
  const parts: string[] = []
  if (mode !== 'memory') parts.push(`CPU ${percent(input.cpu)}`)
  if (mode === 'memory' || (mode === 'cpu-memory' && input.memory !== null)) {
    parts.push(`MEM ${percent(memoryPercent(input.memory))}`)
  }
  const lines = ['OS Vitals']
  if (input.load) lines.push(`Load ${loadAverage(input.load)}`)
  if (input.memory) lines.push(memoryLine(input.memory))
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
  let visibility: boolean | null = null
  let visibilityPending = false
  return {
    applyVisibility(mode) {
      const visible = mode !== 'hidden'
      if (!visible) lastSent = null
      visibility = visible
      visibilityPending = false
      deps.update({ id: STATUS_BAR_ID, visible })
    },
    failed(params) {
      if (params.visible !== undefined) visibilityPending = true
      if (params.text !== undefined) lastSent = null
    },
    show(mode, input, force = false) {
      if (visibilityPending && visibility !== null) {
        visibilityPending = false
        deps.update({ id: STATUS_BAR_ID, visible: visibility })
      }
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
