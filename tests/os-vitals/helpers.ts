import type { Clock, TimerHandle } from '../../plugins/os-vitals/src/clock.ts'
import type { CpuTimes } from '../../plugins/os-vitals/src/cpu.ts'
import { nodeOsProvider } from '../../plugins/os-vitals/src/platform/fallback.ts'
import type { Provider } from '../../plugins/os-vitals/src/platform/types.ts'

type Timer = { at: number; callback: () => void }

export type FakeClock = {
  clock: Clock
  now(): number
  pending(): number
  nextDelay(): number | null
  advance(ms: number): void
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
    advance(ms) {
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
      }
      now = end
    }
  }
}

export type FakeCpus = {
  provider: Provider
  reads(): number
  setStep(step: Partial<CpuTimes>): void
  fail(error: Error | null): void
}

export function fakeCpus(cores = 2, platform = 'linux'): FakeCpus {
  const step: CpuTimes = { user: 250, nice: 0, sys: 50, idle: 700, irq: 0 }
  const totals: CpuTimes[] = Array.from({ length: cores }, () => ({
    user: 0,
    nice: 0,
    sys: 0,
    idle: 0,
    irq: 0
  }))
  let reads = 0
  let failure: Error | null = null
  const provider = nodeOsProvider(
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
      totalmem: () => 8 * 1024 ** 3
    },
    platform
  )
  return {
    provider: {
      ...provider,
      cpuTimes() {
        if (failure) throw failure
        return provider.cpuTimes()
      }
    },
    reads: () => reads,
    setStep(next) {
      Object.assign(step, next)
    },
    fail(error) {
      failure = error
    }
  }
}
