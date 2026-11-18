import type { GpuReading } from '../protocol.ts'
import { parseDictionary } from './ioreg-disk.ts'

const ROOT = /^\+-o \S/
const STATISTICS = /"PerformanceStatistics" = \{(.*)\}/
const MODEL = /"model" = <?"([^"]*)">?/

function percentOf(stats: Map<string, number>, key: string): number | null {
  const value = stats.get(key)
  return value === undefined || !Number.isFinite(value) ? null : Math.max(0, Math.min(100, value))
}

function bytesOf(stats: Map<string, number>, key: string): number | null {
  const value = stats.get(key)
  return value === undefined || !Number.isFinite(value) || value < 0 ? null : value
}

function readBlock(lines: readonly string[]): GpuReading | null {
  let stats: Map<string, number> | null = null
  let model: string | null = null
  for (const line of lines) {
    const found = STATISTICS.exec(line)
    if (found && !stats) stats = parseDictionary(found[1])
    const named = MODEL.exec(line)
    if (named && model === null) model = named[1].trim() || null
  }
  if (!stats) return null
  const utilization = percentOf(stats, 'Device Utilization %')
  if (utilization === null) return null
  return {
    model,
    utilization,
    renderer: percentOf(stats, 'Renderer Utilization %'),
    inUse: bytesOf(stats, 'In use system memory'),
    allocated: bytesOf(stats, 'Alloc system memory'),
    dedicated: false
  }
}

export function parseGpu(text: string): GpuReading | null {
  const blocks: string[][] = []
  for (const line of text.split('\n')) {
    if (ROOT.test(line)) blocks.push([])
    else blocks[blocks.length - 1]?.push(line)
  }
  let best: GpuReading | null = null
  for (const block of blocks) {
    const stats = readBlock(block)
    if (stats && (!best || stats.utilization > best.utilization)) best = stats
  }
  return best
}
