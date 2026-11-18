import type { Clock, TimerHandle } from './clock.ts'
import { cpuUsage, type CpuTimes } from './cpu.ts'
import type { DiskDriver } from './parse/ioreg-disk.ts'
import type { InterfaceCounters } from './parse/netstat.ts'
import { sleepBlockers, type Assertion } from './parse/pmset.ts'
import type { EnergySample } from './parse/top.ts'
import type { Provider } from './platform/types.ts'
import { createProcessTracker, type ProcessSnapshot } from './processes.ts'
import type {
  BatteryReading,
  DiskRate,
  DiskReading,
  EnergyReading,
  GpuReading,
  MemoryReading,
  NetRate,
  NetworkReading,
  ProcessRow,
  Sample,
  Tier,
  ViewName,
  Volume
} from './protocol.ts'
import { diskReading, networkReading } from './rates.ts'
import { createRing } from './ring.ts'

export const BACKGROUND_INTERVAL_MS = 5000
export const ACTIVE_WINDOW_INTERVALS = 3
export const MIN_DELTA_MS = 250
export const MAX_DELTA_MS = 15000
export const SLOW_INTERVAL_MS = 30000
export const ENERGY_INTERVAL_MS = 5000
export const ENERGY_MIN_GAP_MS = 1000
export const ENERGY_LIMIT = 10

export type SamplerConfig = {
  activeIntervalMs: number
  backgroundEnabled: boolean
  historyMs: number
}

export type SamplerDeps = {
  clock: Clock
  provider: Provider
  selfPid?: number
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
  network(): NetworkReading | null
  disk(): DiskReading | null
  gpu(): GpuReading | null
  volumes(): Volume[] | null
  battery(): BatteryReading | null
  energy(): EnergyReading | null
  seq(): number
  invalidateProcesses(): void
  scheduled(): Tier | null
  idle(): Promise<void>
  stop(): void
}

type Counted<T> = { at: number; value: T }

type Extras = { net: NetRate | null; disk: DiskRate | null; gpu: number | null }

const NO_EXTRAS: Extras = { net: null, disk: null, gpu: null }

const round2 = (value: number) => Math.round(value * 100) / 100

export function energyReading(
  t: number,
  samples: readonly EnergySample[],
  assertions: readonly Assertion[] | null,
  rows: readonly ProcessRow[],
  selfPid: number | null = null
): EnergyReading {
  const names = new Map(rows.map((row) => [row.pid, row.name]))
  const helpers = new Set(
    rows.filter((row) => selfPid !== null && row.ppid === selfPid).map((row) => row.pid)
  )
  const impact = samples
    .filter((sample) => sample.impact > 0 && !helpers.has(sample.pid))
    .sort((a, b) => b.impact - a.impact || a.pid - b.pid)
    .slice(0, ENERGY_LIMIT)
    .map((sample) => ({
      pid: sample.pid,
      name: names.get(sample.pid) ?? `PID ${sample.pid}`,
      impact: sample.impact
    }))
  const blockers = assertions
    ? sleepBlockers(assertions).map((entry) => ({
        ...entry,
        name: names.get(entry.pid) ?? entry.name
      }))
    : null
  return { t, impact, blockers }
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
  let netBase: Counted<InterfaceCounters[]> | null = null
  let diskBase: Counted<DiskDriver[]> | null = null
  let latestNetwork: NetworkReading | null = null
  let latestDisk: DiskReading | null = null
  let latestGpu: Counted<GpuReading> | null = null
  let defaultInterface: string | null = null
  let latestVolumes: Volume[] | null = null
  let latestBattery: BatteryReading | null = null
  let slowAt = Number.NEGATIVE_INFINITY
  let latestEnergy: EnergyReading | null = null
  let energyTimer: TimerHandle | null = null
  let energyRun: Promise<void> | null = null
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

  async function attempt<T>(read: () => Promise<T | null>): Promise<T | null> {
    try {
      return await read()
    } catch (error) {
      report(error)
      return null
    }
  }

  const fresh = (t: number, now: number) => now - t >= 0 && now - t <= MAX_DELTA_MS

  function rateBase<T>(base: Counted<T> | null, now: number): Counted<T> | null {
    if (!base) return null
    const age = now - base.at
    return age >= MIN_DELTA_MS && age <= MAX_DELTA_MS ? base : null
  }

  async function readExtras(now: number): Promise<Extras> {
    const [counters, drivers, gpu] = await Promise.all([
      attempt(() => deps.provider.network()),
      attempt(() => deps.provider.disk()),
      attempt(() => deps.provider.gpu())
    ])
    if (stopped) return NO_EXTRAS
    const extras: Extras = { net: null, disk: null, gpu: null }
    if (counters) {
      const previous = rateBase(netBase, now)
      netBase = { at: now, value: counters }
      if (previous) {
        const seconds = (now - previous.at) / 1000
        latestNetwork = networkReading(previous.value, counters, seconds, now, defaultInterface)
        extras.net = { down: latestNetwork.down, up: latestNetwork.up }
      }
    }
    if (drivers) {
      const previous = rateBase(diskBase, now)
      diskBase = { at: now, value: drivers }
      if (previous) {
        latestDisk = diskReading(previous.value, drivers, (now - previous.at) / 1000, now)
        extras.disk = { read: latestDisk.read, write: latestDisk.write }
      }
    }
    if (gpu) {
      latestGpu = { at: now, value: gpu }
      extras.gpu = gpu.utilization
    }
    return extras
  }

  async function readSlow(now: number): Promise<void> {
    slowAt = now
    const [route, volumes, battery] = await Promise.all([
      attempt(() => deps.provider.defaultInterface()),
      attempt(() => deps.provider.volumes()),
      attempt(() => deps.provider.battery())
    ])
    if (stopped) return
    defaultInterface = route
    if (latestNetwork) latestNetwork = { ...latestNetwork, defaultInterface: route }
    if (volumes) latestVolumes = volumes
    if (battery || !deps.provider.sections().battery) latestBattery = battery
  }

  const energyWanted = (now: number) =>
    demand !== null &&
    demand.view === 'energy' &&
    now - demand.at <= ACTIVE_WINDOW_INTERVALS * config.activeIntervalMs &&
    deps.provider.sections().energy

  function pauseEnergy(): void {
    if (energyTimer !== null) deps.clock.clearTimeout(energyTimer)
    energyTimer = null
  }

  function stopEnergy(): void {
    pauseEnergy()
    latestEnergy = null
  }

  function scheduleEnergy(delay: number): void {
    if (energyTimer !== null) deps.clock.clearTimeout(energyTimer)
    energyTimer = stopped ? null : deps.clock.setTimeout(energyTick, delay)
  }

  function runEnergy(now: number): Promise<void> {
    if (energyRun) return energyRun
    const current = (async () => {
      const [samples, assertions] = await Promise.all([
        attempt(() => deps.provider.energy()),
        attempt(() => deps.provider.assertions()),
        readProcesses(now)
      ])
      if (stopped || demand?.view !== 'energy' || !samples) return
      latestEnergy = energyReading(
        deps.clock.now(),
        samples,
        assertions,
        snapshot?.rows ?? [],
        deps.selfPid ?? null
      )
    })()
      .catch(report)
      .finally(() => {
        energyRun = null
        const later = deps.clock.now()
        if (stopped || !energyWanted(later)) pauseEnergy()
        else scheduleEnergy(Math.max(ENERGY_MIN_GAP_MS, ENERGY_INTERVAL_MS - (later - now)))
      })
    energyRun = current
    return current
  }

  function energyTick(): void {
    energyTimer = null
    const now = deps.clock.now()
    if (!energyWanted(now)) {
      pauseEnergy()
      return
    }
    void runEnergy(now)
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
    const soon = baseline !== null && now - baseline.at >= 0 && now - baseline.at < MIN_DELTA_MS
    const usage = cpuReading(now)
    let extras = NO_EXTRAS
    const work: Promise<unknown>[] = [
      readMemory().then((memory) => {
        if (memory) latestMemory = memory
      })
    ]
    if (tier === 'active' && !soon) {
      work.push(
        readExtras(now).then((value) => {
          extras = value
        })
      )
    }
    if (tier === 'active' && (now - slowAt >= SLOW_INTERVAL_MS || now < slowAt)) {
      work.push(readSlow(now))
    }
    if (wantsProcesses(tier, now)) work.push(readProcesses(now))
    await Promise.all(work)
    if (stopped || !usage) return
    counter += 1
    const sample: Sample = {
      seq: counter,
      t: now,
      total: round2(usage.total),
      user: round2(usage.user),
      system: round2(usage.system),
      cores: tier === 'active' ? usage.cores.map(round2) : null,
      memory: latestMemory,
      net: extras.net,
      disk: extras.disk,
      gpu: extras.gpu
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
      if (!energyWanted(now)) stopEnergy()
      else if (!energyRun && energyTimer === null) void runEnergy(now)
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
    network: () =>
      latestNetwork && fresh(latestNetwork.t, deps.clock.now()) ? latestNetwork : null,
    disk: () => (latestDisk && fresh(latestDisk.t, deps.clock.now()) ? latestDisk : null),
    gpu: () => (latestGpu && fresh(latestGpu.at, deps.clock.now()) ? latestGpu.value : null),
    volumes: () => latestVolumes,
    battery: () => latestBattery,
    energy: () =>
      latestEnergy && deps.clock.now() - latestEnergy.t <= 3 * ENERGY_INTERVAL_MS
        ? latestEnergy
        : null,
    seq: () => counter,
    invalidateProcesses() {
      staleProcesses = true
    },
    scheduled: () => scheduledTier,
    async idle() {
      while (reading || processReading || energyRun) await (reading ?? processReading ?? energyRun)
    },
    stop() {
      stopped = true
      cancel()
      stopEnergy()
      tracker.clear()
    }
  }
}
