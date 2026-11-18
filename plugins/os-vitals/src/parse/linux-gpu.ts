import type { GpuReading } from '../protocol.ts'

const MIB = 1024 * 1024
const NUMBER = /^\d+(?:\.\d+)?$/

export function parseNvidiaSmi(text: string): GpuReading | null {
  let best: GpuReading | null = null
  for (const line of text.split('\n')) {
    const parts = line.split(',').map((part) => part.trim())
    if (parts.length < 4) continue
    const [use, used, total] = parts
    if (!NUMBER.test(use)) continue
    const reading: GpuReading = {
      model: parts.slice(3).join(', ') || null,
      utilization: Math.max(0, Math.min(100, Number(use))),
      renderer: null,
      inUse: NUMBER.test(used) ? Number(used) * MIB : null,
      allocated: NUMBER.test(total) ? Number(total) * MIB : null,
      dedicated: true
    }
    if (!best || reading.utilization > best.utilization) best = reading
  }
  return best
}

export function amdGpu(
  busy: string,
  used: string | null,
  total: string | null,
  name: string | null
): GpuReading | null {
  const value = busy.trim()
  if (!NUMBER.test(value)) return null
  const bytes = (text: string | null) => {
    const trimmed = (text ?? '').trim()
    return NUMBER.test(trimmed) ? Number(trimmed) : null
  }
  return {
    model: name?.trim() || 'AMD GPU',
    utilization: Math.max(0, Math.min(100, Number(value))),
    renderer: null,
    inUse: bytes(used),
    allocated: bytes(total),
    dedicated: true
  }
}
