import type { MemoryPressure } from '../protocol.ts'

const UNITS: Record<string, number> = {
  B: 1,
  K: 1024,
  M: 1024 ** 2,
  G: 1024 ** 3,
  T: 1024 ** 4
}

export function parseSysctl(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const match = /^([a-z0-9_.]+):\s*(.*)$/i.exec(line.trim())
    if (match && !match[1].startsWith('sysctl')) values[match[1]] = match[2].trim()
  }
  return values
}

function amount(text: string, key: string): number | null {
  const match = new RegExp(`${key}\\s*=\\s*([\\d.]+)([BKMGT])`, 'i').exec(text)
  if (!match) return null
  const value = Number(match[1]) * (UNITS[match[2].toUpperCase()] ?? 1)
  return Number.isFinite(value) ? Math.round(value) : null
}

export function parseSwapUsage(text: string | undefined): { total: number; used: number } | null {
  if (!text) return null
  const total = amount(text, 'total')
  const used = amount(text, 'used')
  return total === null || used === null ? null : { total, used }
}

export function pressureLevel(text: string | undefined): MemoryPressure | null {
  switch (text?.trim()) {
    case '1':
      return 'normal'
    case '2':
      return 'warning'
    case '4':
      return 'critical'
    default:
      return null
  }
}
