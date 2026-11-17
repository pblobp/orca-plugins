import type { Clock, TimerHandle } from './clock.ts'
import { cpuUsage, type CpuTimes } from './cpu.ts'
import type { Provider } from './platform/types.ts'
import { createProcessTracker, type ProcessSnapshot } from './processes.ts'
import type { MemoryReading, Sample, Tier, ViewName } from './protocol.ts'
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

export type PollDemand = {
  view: ViewName
  processes: boolean
}

export type Sampler = {
  notePoll(demand?: PollDemand): Promise<void>
  configure(config: SamplerConfig): void
  since(seq: number): Sample[]
  latest(): Sample | null
  memory(): MemoryReading | null
  processes(): ProcessSnapshot | null
  seq(): number
  invalidateProcesses(): void
  scheduled(): Tier | null
  idle(): Promise<void>
  stop(): void
}

export function historyCapacity(config: SamplerConfig): number {
  const step = Math.max(1, Math.min(config.activeIntervalMs, BACKGROUND_INTERVAL_MS))
  return Math.ceil(config.historyMs / step) + 1
}

export function createSampler(deps: SamplerDeps, initial: SamplerConfig): Sampler {
  let config = { ...initial }
  const ring = createRing<Sample>(historyCapacity(config))
  const tracker = createProcessTracker()
  let counter = 0
  let baseline: { at: number; times: CpuTimes[] } | null = null
  let lastPollAt = Number.NEGATIVE_INFINITY
  let demand: (PollDemand & { at: number }) | null = null
  let latestMemory: MemoryReading | null = null
  let snapshot: ProcessSnapshot | null = null
  let staleProcesses = false
  let activeTicks = 0
  let timer: TimerHandle | null = null
  let scheduledTier: Tier | null = null
  let reading: Promise<void> | null = null
  let processReading: Promise<void> | null = null
  let stopped = false

  const activeAt = (now: number) =>
    now - lastPollAt <= ACTIVE_WINDOW_INTERVALS * config.activeIntervalMs

  const tierAt = (now: number): Tier | null => {
    if (activeAt(now)) return 'active'
    return config.backgroundEnabled ? 'background' : null
  }

  const demandedAt = (now: number) =>
    demand !== null &&
    demand.processes &&
    now - demand.at <= ACTIVE_WINDOW_INTERVALS * config.activeIntervalMs

  function report(error: unknown): void {
    deps.onError?.(error)
  }

  function readTimes(): CpuTimes[] | null {
    try {
      return deps.provider.cpuTimes()
    } catch (error) {
      report(error)
      return null
    }
  }

  function cpuReading(now: number): ReturnType<typeof cpuUsage> {
    const previous = baseline
    if (previous && now - previous.at >= 0 && now - previous.at < MIN_DELTA_MS) return null
    const times = readTimes()
    if (!times || times.length === 0) return null
    baseline = { at: now, times }
    if (!previous || now - previous.at > MAX_DELTA_MS || now < previous.at) return null
    return cpuUsage(previous.times, times)
  }

  async function readMemory(): Promise<MemoryReading | null> {
    if (!deps.provider.sections().memory) return null
    try {
      return await deps.provider.memory()
    } catch (error) {
      report(error)
      return null
    }
  }

  function readProcesses(now: number): Promise<void> {
    if (processReading) return processReading
    const current = (async () => {
      try {
        if (!deps.provider.sections().processes) return
        const list = await deps.provider.processes()
        if (!stopped && list) {
          snapshot = tracker.update(list, now)
          staleProcesses = false
        }
      } catch (error) {
        report(error)
      }
    })()
    processReading = current
    void current.finally(() => {
      if (processReading === current) processReading = null
    })
    return current
  }

  const freshAt = (now: number) =>
    snapshot !== null &&
    !staleProcesses &&
    now - snapshot.t <= ACTIVE_WINDOW_INTERVALS * config.activeIntervalMs

  function wantsProcesses(tier: Tier, now: number): boolean {
    if (tier !== 'active' || !demandedAt(now)) return false
    if (!freshAt(now) || demand?.view === 'processes') return true
    return activeTicks % 2 === 0
  }

  async function read(tier: Tier, now: number): Promise<void> {
    if (tier === 'active') activeTicks += 1
    const usage = cpuReading(now)
    const work: Promise<unknown>[] = [
      readMemory().then((memory) => {
        if (memory) latestMemory = memory
      })
    ]
    if (wantsProcesses(tier, now)) work.push(readProcesses(now))
    await Promise.all(work)
    if (stopped || !usage) return
    counter += 1
    const sample: Sample = {
      seq: counter,
      t: now,
      total: usage.total,
      user: usage.user,
      system: usage.system,
      cores: tier === 'active' ? usage.cores : null,
      memory: latestMemory
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

  function run(tier: Tier, now: number): Promise<void> {
    cancel()
    scheduledTier = tier
    const current = read(tier, now)
      .catch(report)
      .finally(() => {
        reading = null
        schedule()
      })
    reading = current
    return current
  }

  function tick(): void {
    timer = null
    const now = deps.clock.now()
    const tier = tierAt(now)
    if (!tier) {
      schedule()
      return
    }
    void run(tier, now)
  }

  const startTimes = readTimes()
  if (startTimes && startTimes.length > 0) baseline = { at: deps.clock.now(), times: startTimes }
  schedule()

  return {
    async notePoll(next = { view: 'overview', processes: false }) {
      if (stopped) return
      const now = deps.clock.now()
      lastPollAt = now
      demand = { ...next, at: now }
      if (reading) await reading
      else if (scheduledTier !== 'active') await run('active', now)
      if (!stopped && next.processes && !freshAt(deps.clock.now())) {
        await readProcesses(deps.clock.now())
      }
    },
    configure(nextConfig) {
      config = { ...nextConfig }
      ring.resize(historyCapacity(config))
      if (!reading) schedule()
    },
    since(seq) {
      const oldest = deps.clock.now() - config.historyMs
      return ring.toArray().filter((sample) => sample.seq > seq && sample.t >= oldest)
    },
    latest: () => ring.last() ?? null,
    memory: () => latestMemory,
    processes: () => snapshot,
    seq: () => counter,
    invalidateProcesses() {
      staleProcesses = true
    },
    scheduled: () => scheduledTier,
    async idle() {
      while (reading || processReading) await (reading ?? processReading)
    },
    stop() {
      stopped = true
      cancel()
      tracker.clear()
    }
  }
}
