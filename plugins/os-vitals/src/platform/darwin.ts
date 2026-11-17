import { execFile } from 'node:child_process'
import { parseCoreKinds } from '../parse/ioreg-cpus.ts'
import { macMemory } from '../parse/mac-memory.ts'
import { parseDetail, parseIdentity, parsePs } from '../parse/ps.ts'
import type { CoreKind } from '../protocol.ts'
import { nodeOsProvider, type OsSource } from './fallback.ts'
import { sectionGuard, type Provider } from './types.ts'

export const COMMAND_TIMEOUT_MS = 1500
export const PS_MAX_BUFFER = 16 * 1024 * 1024
export const SMALL_MAX_BUFFER = 1024 * 1024
export const IOREG_MAX_BUFFER = 8 * 1024 * 1024

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
  dispose(): void
}

type Done = (error: Error | null, stdout: string) => void

export function realDarwinCommands(): DarwinCommands {
  const controller = new AbortController()
  const options = (maxBuffer: number) => ({
    encoding: 'utf8' as const,
    timeout: COMMAND_TIMEOUT_MS,
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
    dispose: () => controller.abort()
  }
}

export function darwinProvider(source: OsSource, commands: DarwinCommands): Provider {
  const base = nodeOsProvider(source, 'darwin')
  const memoryGuard = sectionGuard()
  const processGuard = sectionGuard()
  let kinds = new Map<number, CoreKind>()
  return {
    ...base,
    async init() {
      try {
        kinds = parseCoreKinds(await commands.ioreg(IOREG_CPU_ARGS))
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
      return { ...base.sections(), memory: memoryGuard.ok(), processes: processGuard.ok() }
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
    dispose() {
      commands.dispose()
    }
  }
}
