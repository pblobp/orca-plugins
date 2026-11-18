import { bytes } from './format.ts'
import type { MemoryReading, Sample } from './protocol.ts'
import type { VitalsSettings } from './settings.ts'
import { memoryPercent, type StatusTone } from './status.ts'

export const MEMORY_HOLD_MS = 30_000
export const MEMORY_QUIET_MS = 10 * 60_000
export const CPU_HOLD_MS = 60_000
export const SAMPLE_GAP_MS = 20_000
export const ALERT_TITLE = 'OS Vitals: memory is critical'

export type TopProcess = { name: string; memory: number }

export type AlertNotice = { title: string; body: string }

export type AlertDeps = {
  topProcess(): Promise<TopProcess | null>
  notify(notice: AlertNotice): Promise<void>
  onChange?(): void
}

export type AlertStatus = {
  tone: StatusTone
  reasons: string[]
}

export type AlertSettings = Pick<
  VitalsSettings,
  'memoryAlert' | 'memoryAlertPercent' | 'cpuAlert' | 'cpuAlertPercent'
>

export type Alerts = {
  observe(sample: Sample, settings: AlertSettings): void
  status(): AlertStatus
  idle(): Promise<void>
  stop(): void
}

export function memoryHigh(memory: MemoryReading | null, limit: number): boolean {
  if (!memory) return false
  const share = memoryPercent(memory)
  return memory.pressure === 'critical' || (share !== null && share >= limit)
}

export function alertBody(memory: MemoryReading, top: TopProcess | null): string {
  const share = Math.round(memoryPercent(memory) ?? 0)
  const first = `${share}% of memory is in use.`
  return top ? `${first} ${top.name} is using ${bytes(top.memory)}.` : first
}

export function createAlerts(deps: AlertDeps): Alerts {
  let memorySince: number | null = null
  let cpuSince: number | null = null
  let lastAt = Number.NEGATIVE_INFINITY
  let quietUntil = Number.NEGATIVE_INFINITY
  let current: AlertStatus = { tone: 'neutral', reasons: [] }
  let sending: Promise<void> | null = null
  let stopped = false

  function send(memory: MemoryReading): void {
    if (sending || stopped) return
    const pending = (async () => {
      let top: TopProcess | null = null
      try {
        top = await deps.topProcess()
      } catch {
        top = null
      }
      if (stopped) return
      try {
        await deps.notify({ title: ALERT_TITLE, body: alertBody(memory, top) })
      } catch {}
    })()
    sending = pending
    void pending.finally(() => {
      if (sending === pending) sending = null
    })
  }

  function decide(sample: Sample, settings: AlertSettings, now: number): AlertStatus {
    const reasons: string[] = []
    let tone: StatusTone = 'neutral'
    const memory = sample.memory
    if (settings.memoryAlert && memory) {
      const high = memoryHigh(memory, settings.memoryAlertPercent)
      if (high) {
        memorySince ??= now
        if (now - memorySince >= MEMORY_HOLD_MS) {
          tone = 'danger'
          const share = Math.round(memoryPercent(memory) ?? 0)
          reasons.push(
            memory.pressure === 'critical'
              ? `Memory pressure is critical (${share}% in use)`
              : `Memory has been at ${share}% for over 30 seconds`
          )
          if (now >= quietUntil) {
            quietUntil = now + MEMORY_QUIET_MS
            send(memory)
          }
        } else {
          tone = 'warning'
          reasons.push(`Memory is at ${Math.round(memoryPercent(memory) ?? 0)}%`)
        }
      } else {
        memorySince = null
        if (memory.pressure === 'warning') {
          tone = 'warning'
          reasons.push('Memory pressure is elevated')
        }
      }
    } else {
      memorySince = null
    }
    if (settings.cpuAlert && sample.total >= settings.cpuAlertPercent) {
      cpuSince ??= now
      if (now - cpuSince >= CPU_HOLD_MS) {
        if (tone === 'neutral') tone = 'warning'
        reasons.push(`CPU has been above ${settings.cpuAlertPercent}% for a minute`)
      }
    } else {
      cpuSince = null
    }
    return { tone, reasons }
  }

  return {
    observe(sample, settings) {
      if (stopped) return
      const now = sample.t
      if (now - lastAt > SAMPLE_GAP_MS) {
        memorySince = null
        cpuSince = null
      }
      lastAt = now
      const next = decide(sample, settings, now)
      const changed = next.tone !== current.tone
      current = next
      if (changed) deps.onChange?.()
    },
    status: () => current,
    async idle() {
      while (sending) await sending
    },
    stop() {
      stopped = true
    }
  }
}
