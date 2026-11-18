import type { MemoryPressure, MemoryReading } from '../protocol.ts'

const LINE = /^([A-Za-z0-9_()]+):\s+(\d+)(?:\s+kB)?\s*$/
const AVERAGE = /\bavg10=([\d.]+)/
export const PRESSURE_WARNING = 10
export const PRESSURE_CRITICAL = 40
export const FULL_CRITICAL = 10

export function parseMeminfo(text: string): Map<string, number> {
  const values = new Map<string, number>()
  for (const line of text.split('\n')) {
    const match = LINE.exec(line.trim())
    if (match) values.set(match[1], Number(match[2]) * (line.includes('kB') ? 1024 : 1))
  }
  return values
}

export function parsePressure(text: string): MemoryPressure | null {
  let some: number | null = null
  let full: number | null = null
  for (const line of text.split('\n')) {
    const value = AVERAGE.exec(line)
    if (!value) continue
    if (line.startsWith('some')) some = Number(value[1])
    if (line.startsWith('full')) full = Number(value[1])
  }
  if (some === null || !Number.isFinite(some)) return null
  if (some >= PRESSURE_CRITICAL || (full !== null && full >= FULL_CRITICAL)) return 'critical'
  return some >= PRESSURE_WARNING ? 'warning' : 'normal'
}

export function linuxMemory(
  info: Map<string, number>,
  pressure: MemoryPressure | null
): MemoryReading | null {
  const total = info.get('MemTotal')
  const free = info.get('MemFree')
  if (!total || total <= 0 || free === undefined) return null
  const buffers = info.get('Buffers') ?? 0
  const cachedRaw = (info.get('Cached') ?? 0) + (info.get('SReclaimable') ?? 0)
  const cached = Math.max(0, cachedRaw - (info.get('Shmem') ?? 0))
  const available = info.get('MemAvailable')
  const usedRaw =
    available === undefined ? total - free - buffers - cached : total - Math.min(total, available)
  const used = Math.max(0, Math.min(total, usedRaw))
  const swapTotal = info.get('SwapTotal')
  const swapFree = info.get('SwapFree')
  const hasSwap = swapTotal !== undefined && swapFree !== undefined
  return {
    total,
    used,
    app: null,
    wired: null,
    compressed: null,
    buffers: Math.min(buffers, total),
    cached: Math.min(cached, total),
    free: Math.max(0, Math.min(total, free)),
    swapUsed: hasSwap ? Math.max(0, swapTotal - swapFree) : null,
    swapTotal: hasSwap ? swapTotal : null,
    pressure
  }
}
