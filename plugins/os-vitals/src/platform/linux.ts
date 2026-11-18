import { execFile } from 'node:child_process'
import { access, readdir, readFile } from 'node:fs/promises'
import { posix } from 'node:path'
import { linuxBattery, type BatteryFiles } from '../parse/linux-battery.ts'
import { parseDiskstats, parseMounts, realMounts, sysBlockName } from '../parse/linux-disk.ts'
import { amdGpu, parseNvidiaSmi } from '../parse/linux-gpu.ts'
import { linuxMemory, parseMeminfo, parsePressure } from '../parse/linux-memory.ts'
import { parseLinuxDefaultRoute, parseNetDev } from '../parse/linux-net.ts'
import {
  calibrateTicks,
  DEFAULT_TICKS,
  isKernelThread,
  parsePasswd,
  parseProcStat,
  parseProcStatus,
  parseUptime,
  procName,
  type ProcStat
} from '../parse/linux-proc.ts'
import type { Identity, RawDetail, RawProcess } from '../parse/ps.ts'
import type { GpuReading, Sections, Volume } from '../protocol.ts'
import { nodeOsProvider, type OsSource } from './fallback.ts'
import { readSpace, type VolumeSpace } from './space.ts'
import { sectionGuard, type Provider } from './types.ts'

export const LINUX_TIMEOUT_MS = 1500
export const NVIDIA_MAX_BUFFER = 256 * 1024
export const PROCESS_CONCURRENCY = 32
export const VOLUME_LIMIT = 16
export const NVIDIA_ARGS: readonly string[] = [
  '--query-gpu=utilization.gpu,memory.used,memory.total,name',
  '--format=csv,noheader,nounits'
]
export const NVIDIA_PATHS: readonly string[] = ['/usr/bin/nvidia-smi', '/usr/local/bin/nvidia-smi']

const PID = /^\d+$/
const BATTERY = /^BAT\d*$/
const CARD = /^card\d+$/
const GONE = new Set(['ENOENT', 'ESRCH', 'ENOTDIR'])

export type LinuxFiles = {
  read(path: string): Promise<string>
  list(path: string): Promise<string[]>
  exists(path: string): Promise<boolean>
  space(path: string): Promise<VolumeSpace | null>
}

export type LinuxCommands = {
  nvidiaSmi(index: number): Promise<string>
  dispose(): void
}

export type LinuxContext = {
  now(): number
  age(): number
}

type GpuSource = { kind: 'nvidia'; index: number } | { kind: 'amd'; card: string } | null

export function realLinuxFiles(): LinuxFiles {
  return {
    read: (path) => readFile(path, 'utf8'),
    list: (path) => readdir(path),
    exists: (path) =>
      access(path).then(
        () => true,
        () => false
      ),
    space: readSpace
  }
}

export function realLinuxCommands(): LinuxCommands {
  const controller = new AbortController()
  const options = {
    encoding: 'utf8' as const,
    timeout: LINUX_TIMEOUT_MS,
    maxBuffer: NVIDIA_MAX_BUFFER,
    env: { ...process.env, LC_ALL: 'C' },
    windowsHide: true,
    signal: controller.signal
  }
  const settle = (start: (done: (error: Error | null, stdout: string) => void) => void) =>
    new Promise<string>((resolve, reject) => {
      start((error, stdout) => (error ? reject(error) : resolve(stdout)))
    })
  return {
    nvidiaSmi(index) {
      if (index === 0) {
        return settle((done) => execFile('/usr/bin/nvidia-smi', [...NVIDIA_ARGS], options, done))
      }
      return settle((done) =>
        execFile('/usr/local/bin/nvidia-smi', [...NVIDIA_ARGS], options, done)
      )
    },
    dispose: () => controller.abort()
  }
}

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const runner = async () => {
    while (next < items.length) {
      const index = next
      next += 1
      out[index] = await work(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner))
  return out
}

function errorCode(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null
}

export function linuxProvider(
  source: OsSource,
  files: LinuxFiles,
  commands: LinuxCommands,
  context: LinuxContext
): Provider {
  const base = nodeOsProvider(source, 'linux')
  const memoryGuard = sectionGuard()
  const processGuard = sectionGuard()
  const networkGuard = sectionGuard()
  const diskGuard = sectionGuard()
  const spaceGuard = sectionGuard()
  const gpuGuard = sectionGuard()
  const batteryGuard = sectionGuard()
  let ticks = DEFAULT_TICKS
  let bootAt = context.now() - base.uptime() * 1000
  let users = new Map<number, string>()
  let gpuSource: GpuSource = null
  let batteryName: string | null = null
  const blockDevices = new Map<string, boolean>()

  const optional = (path: string) => files.read(path).catch(() => null)

  async function probeGpu(): Promise<void> {
    for (let index = 0; index < NVIDIA_PATHS.length; index++) {
      try {
        if (parseNvidiaSmi(await commands.nvidiaSmi(index))) {
          gpuSource = { kind: 'nvidia', index }
          return
        }
      } catch {}
    }
    const cards = await files.list('/sys/class/drm').catch(() => [] as string[])
    for (const card of cards.filter((name) => CARD.test(name)).sort()) {
      const busy = await optional(`/sys/class/drm/${card}/device/gpu_busy_percent`)
      if (busy !== null && amdGpu(busy, null, null, null)) {
        gpuSource = { kind: 'amd', card }
        return
      }
    }
  }

  async function probeBattery(): Promise<void> {
    const supplies = await files.list('/sys/class/power_supply').catch(() => [] as string[])
    batteryName = supplies.filter((name) => BATTERY.test(name)).sort()[0] ?? null
  }

  function toRaw(stat: ProcStat, statusText: string, cmdline: string): RawProcess | null {
    const status = parseProcStatus(statusText)
    if (status.uid === null) return null
    const name = procName(cmdline, stat.comm)
    const kernel = isKernelThread(stat)
    const raw: RawProcess = {
      pid: stat.pid,
      ppid: stat.ppid,
      uid: status.uid,
      pcpu: 0,
      rss: status.rssBytes ?? 0,
      cpuTime: Math.round(((stat.utime + stat.stime) / ticks) * 100) / 100,
      startedAt: Math.round(bootAt + (stat.starttime / ticks) * 1000),
      start: String(stat.starttime),
      user: users.get(status.uid) ?? String(status.uid),
      comm: name.path || name.name,
      name: name.name
    }
    if (kernel) raw.kernel = true
    return raw
  }

  type ReadProcess = { raw: RawProcess; command: string; threads: number | null }

  async function readProcess(pid: string): Promise<ReadProcess | null> {
    try {
      const [statText, statusText, cmdline] = await Promise.all([
        files.read(`/proc/${pid}/stat`),
        files.read(`/proc/${pid}/status`),
        files.read(`/proc/${pid}/cmdline`)
      ])
      const stat = parseProcStat(statText)
      if (!stat || String(stat.pid) !== pid) return null
      const raw = toRaw(stat, statusText, cmdline)
      if (!raw) return null
      return {
        raw,
        command: procName(cmdline, stat.comm).command,
        threads: parseProcStatus(statusText).threads
      }
    } catch {
      return null
    }
  }

  async function hasDevice(name: string): Promise<boolean> {
    const known = blockDevices.get(name)
    if (known !== undefined) return known
    const sys = sysBlockName(name)
    const found = sys !== null && (await files.exists(`/sys/block/${sys}/device`))
    blockDevices.set(name, found)
    return found
  }

  async function readGpu(): Promise<GpuReading | null> {
    const found = gpuSource
    if (!found || !gpuGuard.ok()) return null
    try {
      let reading: GpuReading | null
      if (found.kind === 'nvidia') {
        reading = parseNvidiaSmi(await commands.nvidiaSmi(found.index))
      } else {
        const root = `/sys/class/drm/${found.card}/device`
        const [busy, used, total, name] = await Promise.all([
          files.read(`${root}/gpu_busy_percent`),
          optional(`${root}/mem_info_vram_used`),
          optional(`${root}/mem_info_vram_total`),
          optional(`${root}/product_name`)
        ])
        reading = amdGpu(busy, used, total, name)
      }
      if (reading) gpuGuard.succeeded()
      else gpuGuard.failed()
      return reading
    } catch {
      gpuGuard.failed()
      return null
    }
  }

  return {
    ...base,
    async init() {
      const [selfStat, uptimeText, passwd] = await Promise.all([
        optional('/proc/self/stat'),
        optional('/proc/uptime'),
        optional('/etc/passwd')
      ])
      const uptime = uptimeText === null ? null : parseUptime(uptimeText)
      const self = selfStat === null ? null : parseProcStat(selfStat)
      if (uptime !== null) {
        bootAt = context.now() - uptime * 1000
        if (self) ticks = calibrateTicks(self.starttime, uptime, context.age())
      }
      users = passwd === null ? new Map() : parsePasswd(passwd)
      await Promise.all([probeGpu(), probeBattery()])
    },
    sections(): Sections {
      return {
        ...base.sections(),
        memory: memoryGuard.ok(),
        processes: processGuard.ok(),
        network: networkGuard.ok(),
        disk: diskGuard.ok() || spaceGuard.ok(),
        gpu: gpuSource !== null && gpuGuard.ok(),
        battery: batteryName !== null && batteryGuard.ok(),
        energy: false
      }
    },
    async memory() {
      if (!memoryGuard.ok()) return null
      try {
        const [info, pressure] = await Promise.all([
          files.read('/proc/meminfo'),
          optional('/proc/pressure/memory')
        ])
        const reading = linuxMemory(
          parseMeminfo(info),
          pressure === null ? null : parsePressure(pressure)
        )
        if (reading) memoryGuard.succeeded()
        else memoryGuard.failed()
        return reading
      } catch {
        memoryGuard.failed()
        return null
      }
    },
    async processes() {
      if (!processGuard.ok()) return null
      try {
        const pids = (await files.list('/proc')).filter((name) => PID.test(name))
        const rows = await mapLimit(pids, PROCESS_CONCURRENCY, readProcess)
        const list = rows.flatMap((row) => (row ? [row.raw] : []))
        if (list.length > 0) processGuard.succeeded()
        else processGuard.failed()
        return list.length > 0 ? list : null
      } catch {
        processGuard.failed()
        return null
      }
    },
    async processDetail(pid): Promise<RawDetail | null> {
      const row = await readProcess(String(pid))
      return row ? { ...row.raw, command: row.command, threads: row.threads } : null
    },
    async identify(pid): Promise<Identity | null> {
      const texts = await Promise.all([
        files.read(`/proc/${pid}/stat`),
        files.read(`/proc/${pid}/status`),
        files.read(`/proc/${pid}/cmdline`)
      ]).catch((error: unknown) => {
        if (GONE.has(errorCode(error) ?? '')) return null
        throw error
      })
      if (!texts) return null
      const [statText, statusText, cmdline] = texts
      const stat = parseProcStat(statText)
      const uid = parseProcStatus(statusText).uid
      if (!stat || stat.pid !== pid || uid === null) throw new Error(`no identity for pid ${pid}`)
      const name = procName(cmdline, stat.comm)
      const identity: Identity = {
        start: String(stat.starttime),
        uid,
        path: name.path,
        name: name.name
      }
      if (isKernelThread(stat)) identity.kernel = true
      return identity
    },
    async network() {
      if (!networkGuard.ok()) return null
      try {
        const list = parseNetDev(await files.read('/proc/net/dev'))
        if (list && list.length > 0) networkGuard.succeeded()
        else networkGuard.failed()
        return list && list.length > 0 ? list : null
      } catch {
        networkGuard.failed()
        return null
      }
    },
    async defaultInterface() {
      const text = await optional('/proc/net/route')
      return text === null ? null : parseLinuxDefaultRoute(text)
    },
    async disk() {
      if (!diskGuard.ok()) return null
      try {
        const all = parseDiskstats(await files.read('/proc/diskstats'))
        const keep = await Promise.all(all.map((row) => hasDevice(row.id)))
        const drives = all.filter((_, index) => keep[index])
        if (drives.length > 0) diskGuard.succeeded()
        else diskGuard.failed()
        return drives.length > 0 ? drives : null
      } catch {
        diskGuard.failed()
        return null
      }
    },
    async volumes() {
      if (!spaceGuard.ok()) return null
      const mountsText = await optional('/proc/mounts')
      const mounts = mountsText === null ? ['/'] : realMounts(parseMounts(mountsText))
      const spaces = await mapLimit(mounts.slice(0, VOLUME_LIMIT), 4, (mount) => files.space(mount))
      const volumes: Volume[] = []
      mounts.slice(0, VOLUME_LIMIT).forEach((mount, index) => {
        const space = spaces[index]
        if (!space) return
        volumes.push({
          name: mount,
          mount,
          startup: mount === '/',
          total: space.total,
          available: space.available
        })
      })
      if (!volumes.some((volume) => volume.startup)) {
        spaceGuard.failed()
        return null
      }
      spaceGuard.succeeded()
      return volumes
    },
    gpu: readGpu,
    async battery() {
      const name = batteryName
      if (!name || !batteryGuard.ok()) return null
      const root = `/sys/class/power_supply/${name}`
      const read = (file: string) => optional(posix.join(root, file))
      const fields: BatteryFiles = {
        capacity: await read('capacity'),
        status: await read('status'),
        powerNow: await read('power_now'),
        currentNow: await read('current_now'),
        voltageNow: await read('voltage_now'),
        energyNow: await read('energy_now'),
        energyFull: await read('energy_full'),
        chargeNow: await read('charge_now'),
        chargeFull: await read('charge_full')
      }
      const reading = linuxBattery(fields)
      if (reading) batteryGuard.succeeded()
      else batteryGuard.failed()
      return reading
    },
    energy: async () => null,
    assertions: async () => null,
    dispose() {
      commands.dispose()
    }
  }
}
