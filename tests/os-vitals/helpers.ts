import { readFileSync } from 'node:fs'
import type { Clock, TimerHandle } from '../../plugins/os-vitals/src/clock.ts'
import type { CpuTimes } from '../../plugins/os-vitals/src/cpu.ts'
import type { RawProcess } from '../../plugins/os-vitals/src/parse/ps.ts'
import { nodeOsProvider } from '../../plugins/os-vitals/src/platform/fallback.ts'
import type { Provider } from '../../plugins/os-vitals/src/platform/types.ts'
import type { BatteryReading, MemoryReading, Volume } from '../../plugins/os-vitals/src/protocol.ts'

type Timer = { at: number; callback: () => void }

export const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

export function fixture(path: string): string {
  return readFileSync(new URL(`./fixtures/${path}`, import.meta.url), 'utf8')
}

export type FakeClock = {
  clock: Clock
  now(): number
  pending(): number
  nextDelay(): number | null
  advance(ms: number): Promise<void>
}

export function fakeClock(start = 1_700_000_000_000): FakeClock {
  let now = start
  let nextId = 1
  const timers = new Map<number, Timer>()
  const clock: Clock = {
    now: () => now,
    setTimeout(callback, ms) {
      const id = nextId++
      timers.set(id, { at: now + ms, callback })
      return id
    },
    clearTimeout(handle: TimerHandle) {
      timers.delete(handle as number)
    }
  }
  return {
    clock,
    now: () => now,
    pending: () => timers.size,
    nextDelay() {
      let soonest: number | null = null
      for (const timer of timers.values()) {
        if (soonest === null || timer.at < soonest) soonest = timer.at
      }
      return soonest === null ? null : soonest - now
    },
    async advance(ms) {
      const end = now + ms
      for (;;) {
        let due: [number, Timer] | null = null
        for (const entry of timers) {
          if (entry[1].at <= end && (!due || entry[1].at < due[1].at)) due = entry
        }
        if (!due) break
        timers.delete(due[0])
        now = due[1].at
        due[1].callback()
        await settle()
        await settle()
      }
      now = end
      await settle()
    }
  }
}

export type ExtraName =
  'network' | 'defaultInterface' | 'disk' | 'volumes' | 'gpu' | 'battery' | 'energy' | 'assertions'

export type FakeSystem = {
  provider: Provider
  reads(): number
  memoryReads(): number
  processReads(): number
  calls(name: ExtraName): number
  setStep(step: Partial<CpuTimes>): void
  setMemory(memory: MemoryReading | null): void
  setProcesses(list: RawProcess[] | null): void
  setExtras(on: boolean): void
  fail(error: Error | null): void
}

export const EXTRA_STEP = { rx: 2_000_000, tx: 500_000, read: 4_000_000, write: 1_000_000 }

export const FAKE_VOLUMES: Volume[] = [
  { name: 'Macintosh HD', mount: '/', startup: true, total: 500e9, available: 120e9 }
]

export const FAKE_BATTERY: BatteryReading = {
  percent: 82,
  onBattery: true,
  state: 'discharging',
  minutesLeft: 222
}

export function fakeCpus(cores = 2, platform = 'linux'): FakeSystem {
  const step: CpuTimes = { user: 250, nice: 0, sys: 50, idle: 700, irq: 0 }
  const totals: CpuTimes[] = Array.from({ length: cores }, () => ({
    user: 0,
    nice: 0,
    sys: 0,
    idle: 0,
    irq: 0
  }))
  let reads = 0
  let memoryReads = 0
  let processReads = 0
  let failure: Error | null = null
  let memory: MemoryReading | null = null
  let processes: RawProcess[] | null = null
  let extras = false
  let ticks = 0
  const counts = new Map<ExtraName, number>()
  const count = (name: ExtraName) => counts.set(name, (counts.get(name) ?? 0) + 1)
  const base = nodeOsProvider(
    {
      cpus() {
        if (failure) throw failure
        reads += 1
        for (const times of totals) {
          times.user += step.user
          times.nice += step.nice
          times.sys += step.sys
          times.idle += step.idle
          times.irq += step.irq
        }
        return totals.map((times) => ({ model: 'Test CPU', times: { ...times } }))
      },
      loadavg: () => [0.5, 0.25, 0.125],
      uptime: () => 3600,
      totalmem: () => 8 * 1024 ** 3,
      freemem: () => 2 * 1024 ** 3
    },
    platform
  )
  return {
    provider: {
      ...base,
      cpuTimes() {
        if (failure) throw failure
        return base.cpuTimes()
      },
      sections: () => ({
        ...base.sections(),
        memory: memory !== null,
        processes: processes !== null,
        network: extras,
        disk: extras,
        gpu: extras,
        battery: extras,
        energy: extras
      }),
      async network() {
        count('network')
        if (!extras) return null
        ticks += 1
        return [
          {
            name: 'en0',
            rxBytes: ticks * EXTRA_STEP.rx,
            txBytes: ticks * EXTRA_STEP.tx,
            rxPackets: ticks * 100,
            txPackets: ticks * 50
          }
        ]
      },
      async defaultInterface() {
        count('defaultInterface')
        return extras ? 'en0' : null
      },
      async disk() {
        count('disk')
        if (!extras) return null
        const n = counts.get('disk') ?? 0
        return [
          {
            id: '0x1',
            readBytes: n * EXTRA_STEP.read,
            writeBytes: n * EXTRA_STEP.write,
            reads: n * 10,
            writes: n * 5,
            image: false
          }
        ]
      },
      async volumes() {
        count('volumes')
        return extras ? FAKE_VOLUMES : null
      },
      async gpu() {
        count('gpu')
        return extras
          ? { model: 'Test GPU', utilization: 25, renderer: 24, inUse: 1e9, allocated: 6e9 }
          : null
      },
      async battery() {
        count('battery')
        return extras ? FAKE_BATTERY : null
      },
      async energy() {
        count('energy')
        return extras
          ? [
              { pid: 1, impact: 4.5 },
              { pid: 77, impact: 9 },
              { pid: 78, impact: 0 }
            ]
          : null
      },
      async assertions() {
        count('assertions')
        return extras ? [{ pid: 1, name: 'launchd', type: 'PreventUserIdleSystemSleep' }] : null
      },
      async memory() {
        memoryReads += 1
        return memory
      },
      async processes() {
        processReads += 1
        return processes
      }
    },
    reads: () => reads,
    memoryReads: () => memoryReads,
    processReads: () => processReads,
    calls: (name) => counts.get(name) ?? 0,
    setExtras(next) {
      extras = next
    },
    setStep(next) {
      Object.assign(step, next)
    },
    setMemory(next) {
      memory = next
    },
    setProcesses(next) {
      processes = next
    },
    fail(error) {
      failure = error
    }
  }
}
