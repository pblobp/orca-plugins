import type { Clock, TimerHandle } from './clock.ts'
import { cpuUsage, type CpuTimes } from './cpu.ts'
import type { Provider } from './platform/types.ts'
import type { Sample, Tier } from './protocol.ts'
import { createRing } from './ring.ts'

export const BACKGROUND_INTERVAL_MS = 5000
export const ACTIVE_WINDOW_INTERVALS = 3
export const MIN_DELTA_MS = 250
export const MAX_DELTA_MS = 15000

export type SamplerConfig = {
  activeIntervalMs: number
  backgroundEnabled: boolean
  historyMs: number
}

export type SamplerDeps = {
  clock: Clock
  provider: Provider
  onSample?: (sample: Sample) => void
  onError?: (error: unknown) => void
}

export type Sampler = {
  notePoll(): void
  configure(config: SamplerConfig): void
  since(seq: number): Sample[]
  latest(): Sample | null
  seq(): number
  scheduled(): Tier | null
  stop(): void
}

export function historyCapacity(config: SamplerConfig): number {
  const step = Math.max(1, Math.min(config.activeIntervalMs, BACKGROUND_INTERVAL_MS))
  return Math.ceil(config.historyMs / step) + 1
}

export function createSampler(deps: SamplerDeps, initial: SamplerConfig): Sampler {
  let config = { ...initial }
  const ring = createRing<Sample>(historyCapacity(config))
  let counter = 0
  let baseline: { at: number; times: CpuTimes[] } | null = null
  let lastPollAt = Number.NEGATIVE_INFINITY
  let timer: TimerHandle | null = null
  let scheduledTier: Tier | null = null
  let stopped = false

  const activeAt = (now: number) =>
    now - lastPollAt <= ACTIVE_WINDOW_INTERVALS * config.activeIntervalMs

  const tierAt = (now: number): Tier | null => {
    if (activeAt(now)) return 'active'
    return config.backgroundEnabled ? 'background' : null
  }

  function readTimes(): CpuTimes[] | null {
    try {
      return deps.provider.cpuTimes()
    } catch (error) {
      deps.onError?.(error)
      return null
    }
  }

  function read(tier: Tier, now: number): void {
    const previous = baseline
    if (previous && now - previous.at >= 0 && now - previous.at < MIN_DELTA_MS) return
    const times = readTimes()
    if (!times || times.length === 0) return
    baseline = { at: now, times }
    if (!previous || now - previous.at > MAX_DELTA_MS || now < previous.at) return
    const usage = cpuUsage(previous.times, times)
    if (!usage) return
    counter += 1
    const sample: Sample = {
      seq: counter,
      t: now,
      total: usage.total,
      user: usage.user,
      system: usage.system,
      cores: tier === 'active' ? usage.cores : null
    }
    ring.push(sample)
    deps.onSample?.(sample)
  }

  function cancel(): void {
    if (timer !== null) deps.clock.clearTimeout(timer)
    timer = null
    scheduledTier = null
  }

  function schedule(): void {
    cancel()
    if (stopped) return
    const tier = tierAt(deps.clock.now())
    if (!tier) return
    scheduledTier = tier
    const delay = tier === 'active' ? config.activeIntervalMs : BACKGROUND_INTERVAL_MS
    timer = deps.clock.setTimeout(tick, delay)
  }

  function tick(): void {
    timer = null
    const now = deps.clock.now()
    const tier = tierAt(now)
    if (tier) read(tier, now)
    schedule()
  }

  const startTimes = readTimes()
  if (startTimes && startTimes.length > 0) baseline = { at: deps.clock.now(), times: startTimes }
  schedule()

  return {
    notePoll() {
      if (stopped) return
      const now = deps.clock.now()
      const wasActive = scheduledTier === 'active'
      lastPollAt = now
      if (wasActive) return
      read('active', now)
      schedule()
    },
    configure(next) {
      config = { ...next }
      ring.resize(historyCapacity(config))
      schedule()
    },
    since(seq) {
      const oldest = deps.clock.now() - config.historyMs
      return ring.toArray().filter((sample) => sample.seq > seq && sample.t >= oldest)
    },
    latest: () => ring.last() ?? null,
    seq: () => counter,
    scheduled: () => scheduledTier,
    stop() {
      stopped = true
      cancel()
    }
  }
}
