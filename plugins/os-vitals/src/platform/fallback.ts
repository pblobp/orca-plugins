import { copyTimes, type CpuTimes } from '../cpu.ts'
import type { LoadAverage, Sections } from '../protocol.ts'
import type { Provider } from './types.ts'

export type OsSource = {
  cpus(): { model: string; times: CpuTimes }[]
  loadavg(): number[]
  uptime(): number
  totalmem(): number
}

function safely<T>(read: () => T, fallback: T): T {
  try {
    return read()
  } catch {
    return fallback
  }
}

export function nodeOsProvider(source: OsSource, platform: string): Provider {
  const hasLoad = platform !== 'win32'
  const cpuList = () => safely(() => source.cpus(), [])
  return {
    platform,
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
      const cpu = cpuList().length > 0
      return {
        cpu,
        load: hasLoad,
        memory: false,
        processes: false,
        network: false,
        disk: false,
        gpu: false,
        battery: false,
        energy: false
      }
    }
  }
}
