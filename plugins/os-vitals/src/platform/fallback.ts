import { copyTimes, type CpuTimes } from '../cpu.ts'
import type { LoadAverage, MemoryReading, Sections } from '../protocol.ts'
import type { Provider } from './types.ts'

export type OsSource = {
  cpus(): { model: string; times: CpuTimes }[]
  loadavg(): number[]
  uptime(): number
  totalmem(): number
  freemem(): number
}

export function safely<T>(read: () => T, fallback: T): T {
  try {
    return read()
  } catch {
    return fallback
  }
}

export function osMemory(source: OsSource): MemoryReading | null {
  const total = safely(() => source.totalmem(), 0)
  const free = safely(() => source.freemem(), Number.NaN)
  if (!(total > 0) || !Number.isFinite(free) || free < 0) return null
  const clamped = Math.min(total, free)
  return {
    total,
    used: total - clamped,
    app: null,
    wired: null,
    compressed: null,
    cached: null,
    free: clamped,
    swapUsed: null,
    swapTotal: null,
    pressure: null
  }
}

export function nodeOsProvider(source: OsSource, platform: string): Provider {
  const hasLoad = platform !== 'win32'
  const hasMemory = platform !== 'linux' && platform !== 'darwin'
  const cpuList = () => safely(() => source.cpus(), [])
  const hasCpu = cpuList().length > 0
  return {
    platform,
    init: async () => {},
    cpuModel() {
      const model = cpuList()[0]?.model?.trim()
      return model ? model.replace(/\s+/g, ' ') : null
    },
    cores: () => cpuList().map(() => ({ kind: null })),
    cpuTimes: () => cpuList().map((cpu) => copyTimes(cpu.times)),
    load() {
      if (!hasLoad) return null
      const values = safely(() => source.loadavg(), [])
      if (values.length < 3 || !values.slice(0, 3).every((v) => Number.isFinite(v) && v >= 0)) {
        return null
      }
      const load: LoadAverage = [values[0], values[1], values[2]]
      return load
    },
    uptime: () => safely(() => source.uptime(), 0),
    totalMemory: () => safely(() => source.totalmem(), 0),
    sections(): Sections {
      return {
        cpu: hasCpu,
        load: hasLoad,
        memory: hasMemory,
        processes: false,
        network: false,
        disk: false,
        gpu: false,
        battery: false,
        energy: false
      }
    },
    memory: async () => (hasMemory ? osMemory(source) : null),
    processes: async () => null,
    processDetail: async () => null,
    dispose() {}
  }
}
