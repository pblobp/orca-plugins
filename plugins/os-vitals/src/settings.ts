import type { DefaultView } from './protocol.ts'

export type StatusBarMode = 'cpu-memory' | 'cpu' | 'memory' | 'hidden'

export type VitalsSettings = {
  refreshSeconds: number
  historyMinutes: number
  statusBar: StatusBarMode
  backgroundSampling: boolean
  memoryAlert: boolean
  memoryAlertPercent: number
  cpuAlert: boolean
  cpuAlertPercent: number
  defaultView: DefaultView
}

export const REFRESH_SECONDS = [1, 2, 5]
export const HISTORY_MINUTES = [1, 5, 15]
export const STATUS_BAR_MODES: readonly StatusBarMode[] = ['cpu-memory', 'cpu', 'memory', 'hidden']
export const DEFAULT_VIEWS: readonly DefaultView[] = ['last', 'overview', 'processes']

export const DEFAULT_SETTINGS: VitalsSettings = {
  refreshSeconds: 2,
  historyMinutes: 5,
  statusBar: 'cpu-memory',
  backgroundSampling: true,
  memoryAlert: true,
  memoryAlertPercent: 92,
  cpuAlert: false,
  cpuAlertPercent: 90,
  defaultView: 'last'
}

function choice<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function whole(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback
}

export function readSettings(raw: unknown): VitalsSettings {
  const source: Record<string, unknown> =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const d = DEFAULT_SETTINGS
  return {
    refreshSeconds: choice(source.refreshSeconds, REFRESH_SECONDS, d.refreshSeconds),
    historyMinutes: choice(source.historyMinutes, HISTORY_MINUTES, d.historyMinutes),
    statusBar: choice(source.statusBar, STATUS_BAR_MODES, d.statusBar),
    backgroundSampling: flag(source.backgroundSampling, d.backgroundSampling),
    memoryAlert: flag(source.memoryAlert, d.memoryAlert),
    memoryAlertPercent: whole(source.memoryAlertPercent, 70, 99, d.memoryAlertPercent),
    cpuAlert: flag(source.cpuAlert, d.cpuAlert),
    cpuAlertPercent: whole(source.cpuAlertPercent, 50, 100, d.cpuAlertPercent),
    defaultView: choice(source.defaultView, DEFAULT_VIEWS, d.defaultView)
  }
}

export function backgroundEnabled(settings: VitalsSettings): boolean {
  if (!settings.backgroundSampling) return false
  return settings.statusBar !== 'hidden' || settings.memoryAlert || settings.cpuAlert
}
