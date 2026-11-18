import { execFile } from 'node:child_process'
import { readdir, readlink } from 'node:fs/promises'
import { posix } from 'node:path'
import { otherVolumes, parseDf } from '../parse/df.ts'
import { parseCoreKinds } from '../parse/ioreg-cpus.ts'
import { parseDiskDrivers } from '../parse/ioreg-disk.ts'
import { parseGpu } from '../parse/ioreg-gpu.ts'
import { macMemory } from '../parse/mac-memory.ts'
import { parseDefaultRoute, parseNetstat } from '../parse/netstat.ts'
import { hasPowerSource, parseAssertions, parseBattery } from '../parse/pmset.ts'
import { parseDetail, parseIdentity, parsePs } from '../parse/ps.ts'
import { parseTopEnergy } from '../parse/top.ts'
import type { CoreKind, Volume } from '../protocol.ts'
import { nodeOsProvider, type OsSource } from './fallback.ts'
import { readSpace, type VolumeSpace } from './space.ts'
import { sectionGuard, type Provider } from './types.ts'

export const COMMAND_TIMEOUT_MS = 1500
export const TOP_TIMEOUT_MS = 4000
export const PS_MAX_BUFFER = 16 * 1024 * 1024
export const SMALL_MAX_BUFFER = 1024 * 1024
export const IOREG_MAX_BUFFER = 8 * 1024 * 1024
export const DATA_VOLUME = '/System/Volumes/Data'
export const STARTUP_MOUNTS: readonly string[] = [DATA_VOLUME, '/']
export const VOLUMES_FOLDER = '/Volumes'

export const PS_COLUMNS: readonly string[] = [
  '-o',
  'pid=',
  '-o',
  'ppid=',
  '-o',
  'uid=',
  '-o',
  'pcpu=',
  '-o',
  'rss=',
  '-o',
  'time=',
  '-o',
  'lstart=',
  '-o',
  'user='
]
export const PROCESS_LIST_ARGS: readonly string[] = ['-A', ...PS_COLUMNS, '-o', 'comm=']
export const MEMORY_KEYS: readonly string[] = [
  'hw.memsize',
  'vm.swapusage',
  'kern.memorystatus_vm_pressure_level'
]
export const IOREG_CPU_ARGS: readonly string[] = ['-p', 'IODeviceTree', '-c', 'IOPlatformDevice']
export const IOREG_GPU_ARGS: readonly string[] = ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator']
export const IOREG_DISK_ARGS: readonly string[] = [
  '-r',
  '-d',
  '2',
  '-w',
  '0',
  '-c',
  'IOBlockStorageDriver'
]
export const NETSTAT_ARGS: readonly string[] = ['-ibn']
export const ROUTE_ARGS: readonly string[] = ['-n', 'get', 'default']
export const DF_ARGS: readonly string[] = ['-kPl']
export const BATTERY_ARGS: readonly string[] = ['-g', 'batt']
export const ASSERTION_ARGS: readonly string[] = ['-g', 'assertions']
export const TOP_ARGS: readonly string[] = [
  '-l',
  '2',
  '-s',
  '1',
  '-o',
  'power',
  '-n',
  '30',
  '-stats',
  'pid,power'
]

export function detailArgs(pid: number): string[] {
  return ['-p', String(pid), ...PS_COLUMNS, '-o', 'command=']
}

export function identityArgs(pid: number): string[] {
  return ['-p', String(pid), '-o', 'lstart=', '-o', 'uid=', '-o', 'comm=']
}

export function threadArgs(pid: number): string[] {
  return ['-M', '-p', String(pid)]
}

export type DarwinCommands = {
  ps(args: readonly string[]): Promise<string>
  vmStat(): Promise<string>
  sysctl(args: readonly string[]): Promise<string>
  ioreg(args: readonly string[]): Promise<string>
  netstat(args: readonly string[]): Promise<string>
  route(args: readonly string[]): Promise<string>
  df(args: readonly string[]): Promise<string>
  pmset(args: readonly string[]): Promise<string>
  top(args: readonly string[]): Promise<string>
  space(path: string): Promise<VolumeSpace | null>
  startupName(): Promise<string | null>
  dispose(): void
}

type Done = (error: Error | null, stdout: string) => void

async function readStartupName(): Promise<string | null> {
  try {
    for (const entry of await readdir(VOLUMES_FOLDER, { withFileTypes: true })) {
      if (!entry.isSymbolicLink()) continue
      if ((await readlink(posix.join(VOLUMES_FOLDER, entry.name))) === '/') return entry.name
    }
  } catch {
    return null
  }
  return null
}

export function realDarwinCommands(): DarwinCommands {
  const controller = new AbortController()
  const options = (maxBuffer: number, timeout = COMMAND_TIMEOUT_MS) => ({
    encoding: 'utf8' as const,
    timeout,
    maxBuffer,
    env: { ...process.env, LC_ALL: 'C' },
    windowsHide: true,
    signal: controller.signal
  })
  const settle = (start: (done: Done) => void, partial = false) =>
    new Promise<string>((resolve, reject) => {
      start((error, stdout) => {
        if (!error) resolve(stdout)
        else if (partial && typeof stdout === 'string' && stdout.trim() !== '') resolve(stdout)
        else reject(error)
      })
    })
  return {
    ps: (args) => settle((done) => execFile('/bin/ps', [...args], options(PS_MAX_BUFFER), done)),
    vmStat: () =>
      settle((done) => execFile('/usr/bin/vm_stat', [], options(SMALL_MAX_BUFFER), done)),
    sysctl: (args) =>
      settle(
        (done) => execFile('/usr/sbin/sysctl', [...args], options(SMALL_MAX_BUFFER), done),
        true
      ),
    ioreg: (args) =>
      settle((done) => execFile('/usr/sbin/ioreg', [...args], options(IOREG_MAX_BUFFER), done)),
    netstat: (args) =>
      settle((done) => execFile('/usr/sbin/netstat', [...args], options(SMALL_MAX_BUFFER), done)),
    route: (args) =>
      settle((done) => execFile('/sbin/route', [...args], options(SMALL_MAX_BUFFER), done)),
    df: (args) => settle((done) => execFile('/bin/df', [...args], options(SMALL_MAX_BUFFER), done)),
    pmset: (args) =>
      settle((done) => execFile('/usr/bin/pmset', [...args], options(SMALL_MAX_BUFFER), done)),
    top: (args) =>
      settle((done) =>
        execFile('/usr/bin/top', [...args], options(SMALL_MAX_BUFFER, TOP_TIMEOUT_MS), done)
      ),
    space: readSpace,
    startupName: readStartupName,
    dispose: () => controller.abort()
  }
}

type Presence = 'unknown' | 'present' | 'absent'

export function darwinProvider(source: OsSource, commands: DarwinCommands): Provider {
  const base = nodeOsProvider(source, 'darwin')
  const memoryGuard = sectionGuard()
  const processGuard = sectionGuard()
  const networkGuard = sectionGuard()
  const diskGuard = sectionGuard()
  const spaceGuard = sectionGuard()
  const dfGuard = sectionGuard()
  const gpuGuard = sectionGuard()
  const batteryGuard = sectionGuard()
  const energyGuard = sectionGuard()
  const assertionGuard = sectionGuard()
  let kinds = new Map<number, CoreKind>()
  let gpuPresence: Presence = 'unknown'
  let batteryPresence: Presence = 'unknown'

  async function readGpu() {
    if (gpuPresence === 'absent' || !gpuGuard.ok()) return null
    try {
      const reading = parseGpu(await commands.ioreg(IOREG_GPU_ARGS))
      if (reading) {
        gpuPresence = 'present'
        gpuGuard.succeeded()
      } else if (gpuPresence === 'unknown') {
        gpuPresence = 'absent'
      } else {
        gpuGuard.failed()
      }
      return reading
    } catch {
      gpuGuard.failed()
      return null
    }
  }

  async function readBattery() {
    if (batteryPresence === 'absent' || !batteryGuard.ok()) return null
    try {
      const text = await commands.pmset(BATTERY_ARGS)
      const reading = parseBattery(text)
      if (reading) {
        batteryPresence = 'present'
        batteryGuard.succeeded()
      } else if (batteryPresence === 'unknown' && hasPowerSource(text)) {
        batteryPresence = 'absent'
      } else {
        batteryGuard.failed()
      }
      return reading
    } catch {
      batteryGuard.failed()
      return null
    }
  }

  async function readOtherVolumes(): Promise<Volume[]> {
    if (!dfGuard.ok()) return []
    try {
      const rows = parseDf(await commands.df(DF_ARGS))
      if (rows.length > 0) dfGuard.succeeded()
      else dfGuard.failed()
      return otherVolumes(rows, STARTUP_MOUNTS).map((row) => ({
        name: posix.basename(row.mount),
        mount: row.mount,
        startup: false,
        total: row.total,
        available: Math.min(row.total, row.available)
      }))
    } catch {
      dfGuard.failed()
      return []
    }
  }

  return {
    ...base,
    async init() {
      const [cpus] = await Promise.all([
        commands.ioreg(IOREG_CPU_ARGS).catch(() => ''),
        readGpu(),
        readBattery()
      ])
      try {
        kinds = parseCoreKinds(cpus)
      } catch {
        kinds = new Map()
      }
    },
    cores() {
      const list = base.cores()
      if (kinds.size !== list.length) return list
      return list.map((_, index) => ({ kind: kinds.get(index) ?? null }))
    },
    sections() {
      return {
        ...base.sections(),
        memory: memoryGuard.ok(),
        processes: processGuard.ok(),
        network: networkGuard.ok(),
        disk: diskGuard.ok() || spaceGuard.ok(),
        gpu: gpuGuard.ok() && gpuPresence !== 'absent',
        battery: batteryGuard.ok() && batteryPresence !== 'absent',
        energy: energyGuard.ok()
      }
    },
    async memory() {
      if (!memoryGuard.ok()) return null
      try {
        const [vmStat, sysctl] = await Promise.all([
          commands.vmStat(),
          commands.sysctl(MEMORY_KEYS)
        ])
        const reading = macMemory(vmStat, sysctl)
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
        const list = parsePs(await commands.ps(PROCESS_LIST_ARGS))
        if (list.length > 0) processGuard.succeeded()
        else processGuard.failed()
        return list.length > 0 ? list : null
      } catch {
        processGuard.failed()
        return null
      }
    },
    async processDetail(pid) {
      try {
        const [line, threads] = await Promise.all([
          commands.ps(detailArgs(pid)),
          commands.ps(threadArgs(pid)).catch(() => null)
        ])
        return parseDetail(line, threads)
      } catch {
        return null
      }
    },
    async identify(pid) {
      let text: string
      try {
        text = await commands.ps(identityArgs(pid))
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 1) return null
        throw error
      }
      const identity = parseIdentity(text)
      if (!identity) throw new Error(`ps gave no identity for pid ${pid}`)
      return identity
    },
    async network() {
      if (!networkGuard.ok()) return null
      try {
        const list = parseNetstat(await commands.netstat(NETSTAT_ARGS))
        if (list && list.length > 0) networkGuard.succeeded()
        else networkGuard.failed()
        return list && list.length > 0 ? list : null
      } catch {
        networkGuard.failed()
        return null
      }
    },
    async defaultInterface() {
      if (!networkGuard.ok()) return null
      try {
        return parseDefaultRoute(await commands.route(ROUTE_ARGS))
      } catch {
        return null
      }
    },
    async disk() {
      if (!diskGuard.ok()) return null
      try {
        const drivers = parseDiskDrivers(await commands.ioreg(IOREG_DISK_ARGS))
        if (drivers.length > 0) diskGuard.succeeded()
        else diskGuard.failed()
        return drivers.length > 0 ? drivers : null
      } catch {
        diskGuard.failed()
        return null
      }
    },
    async volumes() {
      if (!spaceGuard.ok()) return null
      const [space, name, others] = await Promise.all([
        commands.space(DATA_VOLUME).then((found) => found ?? commands.space('/')),
        commands.startupName().catch(() => null),
        readOtherVolumes()
      ])
      if (!space) {
        spaceGuard.failed()
        return null
      }
      spaceGuard.succeeded()
      const startup: Volume = {
        name: name ?? 'Startup disk',
        mount: '/',
        startup: true,
        total: space.total,
        available: space.available
      }
      return [startup, ...others]
    },
    gpu: readGpu,
    battery: readBattery,
    async energy() {
      if (!energyGuard.ok()) return null
      try {
        const samples = parseTopEnergy(await commands.top(TOP_ARGS))
        if (samples) energyGuard.succeeded()
        else energyGuard.failed()
        return samples
      } catch {
        energyGuard.failed()
        return null
      }
    },
    async assertions() {
      if (!assertionGuard.ok()) return null
      try {
        const list = parseAssertions(await commands.pmset(ASSERTION_ARGS))
        assertionGuard.succeeded()
        return list
      } catch {
        assertionGuard.failed()
        return null
      }
    },
    dispose() {
      commands.dispose()
    }
  }
}
