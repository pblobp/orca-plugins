import type { InterfaceCounters } from './netstat.ts'

const ROW = /^\s*([^\s:]+):\s*(.*)$/
const COUNT = /^\d+$/

export function parseNetDev(text: string): InterfaceCounters[] | null {
  const lines = text.split('\n')
  if (!lines.some((line) => line.includes('|bytes'))) return null
  const out: InterfaceCounters[] = []
  for (const line of lines) {
    const match = ROW.exec(line)
    if (!match) continue
    const values = match[2].trim().split(/\s+/)
    if (values.length < 16 || !values.slice(0, 16).every((value) => COUNT.test(value))) continue
    out.push({
      name: match[1],
      rxBytes: Number(values[0]),
      rxPackets: Number(values[1]),
      txBytes: Number(values[8]),
      txPackets: Number(values[9])
    })
  }
  return out
}

export function parseLinuxDefaultRoute(text: string): string | null {
  let best: { name: string; metric: number } | null = null
  for (const line of text.split('\n').slice(1)) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 8) continue
    const [name, destination, , flags, , , metric, mask] = fields
    const up = (Number.parseInt(flags, 16) & 1) === 1
    if (destination !== '00000000' || mask !== '00000000' || !up) continue
    const value = Number(metric)
    if (!best || value < best.metric) best = { name, metric: value }
  }
  return best ? best.name : null
}
