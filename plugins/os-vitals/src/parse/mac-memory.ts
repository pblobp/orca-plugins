import type { MemoryReading } from '../protocol.ts'
import { parseSwapUsage, parseSysctl, pressureLevel } from './sysctl.ts'
import { parseVmStat } from './vm-stat.ts'

export function macMemory(vmStatText: string, sysctlText: string): MemoryReading | null {
  const vm = parseVmStat(vmStatText)
  if (!vm) return null
  const sysctl = parseSysctl(sysctlText)
  const total = Number(sysctl['hw.memsize'])
  if (!Number.isFinite(total) || total <= 0) return null
  const page = (key: string): number | null => {
    const value = vm.pages[key]
    return typeof value === 'number' && Number.isFinite(value) ? value * vm.pageSize : null
  }
  const anonymous = page('anonymous pages')
  const purgeable = page('pages purgeable') ?? 0
  const wired = page('pages wired down')
  const compressed = page('pages occupied by compressor') ?? 0
  const fileBacked = page('file-backed pages')
  if (anonymous === null || wired === null || fileBacked === null) return null
  const app = Math.max(0, anonymous - purgeable)
  const used = Math.min(total, app + wired + compressed)
  const cached = Math.max(0, Math.min(total - used, fileBacked + purgeable))
  const swap = parseSwapUsage(sysctl['vm.swapusage'])
  return {
    total,
    used,
    app,
    wired,
    compressed,
    cached,
    free: Math.max(0, total - used - cached),
    swapUsed: swap ? swap.used : null,
    swapTotal: swap ? swap.total : null,
    pressure: pressureLevel(sysctl['kern.memorystatus_vm_pressure_level'])
  }
}
