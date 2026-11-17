import { userInfo } from 'node:os'
import { posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { OrcaWorkerApi } from 'orca/worker'
import { locateCli, outermostApp, runOrcaCli, type CliResult } from './cli.ts'
import { realClock, type Clock } from './clock.ts'
import { openOwnPanel, type RunCli } from './open-panel.ts'
import { createProvider, type Provider } from './platform/index.ts'
import { processName } from './parse/ps.ts'
import { queryProcesses, readQuery, withOffers } from './processes.ts'
import type {
  DetailResult,
  HelloResult,
  PollInput,
  PollResult,
  QuitResult,
  Sample
} from './protocol.ts'
import {
  createOfferer,
  quitProcess,
  readQuitInput,
  type QuitContext,
  type QuitSignal
} from './quit.ts'
import { createSampler, type SamplerConfig } from './sampler.ts'
import {
  backgroundEnabled,
  DEFAULT_SETTINGS,
  readSettings,
  type VitalsSettings
} from './settings.ts'
import { loadAverage, percent } from './format.ts'
import { createStatusBar, memoryPercent, type StatusBarUpdate } from './status.ts'

export const OPEN_COMMAND = 'os-vitals.open'
export const CORE_HISTORY_LIMIT = 120

export type VitalsDeps = {
  clock: Clock
  provider: Provider
  locateCli: () => string | null
  runCli: (program: string, args: readonly string[], signal: AbortSignal) => Promise<CliResult>
  workerFile: string | null
  quit: QuitContext
  kill: (pid: number, signal: QuitSignal) => void
}

export type Vitals = {
  stop(): void
}

function samplerConfig(settings: VitalsSettings): SamplerConfig {
  return {
    activeIntervalMs: settings.refreshSeconds * 1000,
    backgroundEnabled: backgroundEnabled(settings),
    historyMs: settings.historyMinutes * 60 * 1000
  }
}

function readInput(input: unknown): PollInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const raw = input as Record<string, unknown>
  const out: PollInput = {}
  if (typeof raw.since === 'number' && Number.isInteger(raw.since) && raw.since >= 0) {
    out.since = raw.since
  }
  if (typeof raw.run === 'string' && raw.run.length <= 64) out.run = raw.run
  if (raw.view === 'overview' || raw.view === 'processes') out.view = raw.view
  const query = readQuery(raw.processes)
  if (query) out.processes = query
  return out
}

export function readPid(input: unknown): number | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const pid = (input as Record<string, unknown>).pid
  return typeof pid === 'number' && Number.isInteger(pid) && pid > 0 && pid <= 0x7fffffff
    ? pid
    : null
}

function commandName(command: string): string {
  return processName(command.trim().split(/\s+/)[0] ?? '') || command
}

function invalid(text: string): Error {
  return Object.assign(new Error(text), { code: 'invalid_params' })
}

function trimCores(samples: Sample[]): Sample[] {
  const keepFrom = samples.length - CORE_HISTORY_LIMIT
  return samples.map((sample, index) =>
    index < keepFrom && sample.cores ? { ...sample, cores: null } : sample
  )
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function startVitals(orca: OrcaWorkerApi, deps: VitalsDeps): Promise<Vitals> {
  const { clock, provider } = deps
  const run = clock.now().toString(36)
  const subscriptions: { dispose(): void }[] = []
  const controllers = new Set<AbortController>()

  const loadSettings = async (): Promise<VitalsSettings> => {
    try {
      return readSettings(await orca.settings.get())
    } catch (error) {
      orca.log(`OS Vitals could not read its settings: ${message(error)}`)
      return DEFAULT_SETTINGS
    }
  }

  let settings = await loadSettings()
  await provider.init()

  const updateStatusBar = (params: StatusBarUpdate): void => {
    orca.host.call('statusBar.update', params).catch((error: unknown) => {
      statusBar.failed(params)
      orca.log(`OS Vitals could not update its status bar item: ${message(error)}`)
    })
  }
  const statusBar = createStatusBar({ clock, update: updateStatusBar })

  const showStatus = (sample: Sample | null, force: boolean): void => {
    if (!sample) return
    statusBar.show(
      settings.statusBar,
      { cpu: sample.total, memory: sample.memory, load: provider.load() },
      force
    )
  }

  const sampler = createSampler(
    {
      clock,
      provider,
      onSample: (sample) => showStatus(sample, false),
      onError: (error) => orca.log(`OS Vitals could not read the system: ${message(error)}`)
    },
    samplerConfig(settings)
  )

  statusBar.applyVisibility(settings.statusBar)

  let stopped = false

  const applySettings = (next: VitalsSettings): void => {
    if (stopped) return
    const previous = settings
    settings = next
    sampler.configure(samplerConfig(next))
    if (previous.statusBar !== next.statusBar) {
      statusBar.applyVisibility(next.statusBar)
      showStatus(sampler.latest(), true)
    }
  }

  subscriptions.push(
    orca.settings.onDidChange(() => {
      void loadSettings().then(applySettings)
    })
  )

  subscriptions.push(
    orca.panels.handle('os-vitals.hello', (): HelloResult => ({
      protocol: 1,
      run,
      platform: provider.platform,
      cpuModel: provider.cpuModel(),
      cores: provider.cores(),
      totalMemory: provider.totalMemory(),
      sections: provider.sections(),
      intervalMs: settings.refreshSeconds * 1000,
      historyMs: settings.historyMinutes * 60 * 1000,
      defaultView: settings.defaultView
    }))
  )

  subscriptions.push(
    orca.panels.handle('os-vitals.poll', async (rawInput): Promise<PollResult> => {
      const input = readInput(rawInput)
      const query = input.processes ?? null
      await sampler.notePoll({ view: input.view ?? 'overview', processes: query !== null })
      const reset = input.run !== run
      const since = reset ? 0 : (input.since ?? 0)
      const samples = sampler.since(since)
      const snapshot = sampler.processes()
      return {
        run,
        reset,
        seq: sampler.seq(),
        samples: reset ? trimCores(samples) : samples,
        current: { load: provider.load(), uptime: provider.uptime() },
        memory: sampler.memory(),
        processes:
          query && snapshot
            ? withOffers(queryProcesses(snapshot, query), createOfferer(deps.quit, snapshot.rows))
            : null,
        intervalMs: settings.refreshSeconds * 1000,
        historyMs: settings.historyMinutes * 60 * 1000
      }
    })
  )

  subscriptions.push(
    orca.panels.handle('os-vitals.process.detail', async (rawInput): Promise<DetailResult> => {
      const pid = readPid(rawInput)
      if (pid === null) throw invalid('pid must be a positive whole number')
      const raw = await provider.processDetail(pid)
      if (!raw || raw.pid !== pid) return { found: false }
      const rows = sampler.processes()?.rows ?? []
      const row = rows.find((entry) => entry.pid === pid && entry.start === raw.start)
      const parent = rows.find((entry) => entry.pid === raw.ppid)
      const name = row ? row.name : commandName(raw.command)
      const offer = createOfferer(deps.quit, rows)
      return {
        found: true,
        process: {
          pid,
          ppid: raw.ppid,
          parentName: parent ? parent.name : null,
          uid: raw.uid,
          user: raw.user,
          name,
          command: raw.command,
          startedAt: raw.startedAt,
          start: raw.start,
          quit: row ? offer(row) : offer({ ...raw, name, path: '', cpu: 0, memory: raw.rss }),
          cpuTime: raw.cpuTime,
          memory: raw.rss,
          cpu: row ? row.cpu : null,
          threads: raw.threads
        }
      }
    })
  )

  subscriptions.push(
    orca.panels.handle('os-vitals.process.quit', async (rawInput): Promise<QuitResult> => {
      const input = readQuitInput(rawInput)
      if (!input) throw invalid('quit takes a whole pid, the start time the list gave, and force')
      const listed = sampler.processes()?.rows ?? []
      const result = await quitProcess(input, {
        ...deps.quit,
        listed: () => listed,
        identify: (pid) => provider.identify(pid),
        kill: deps.kill
      })
      const row = listed.find((entry) => entry.pid === input.pid)
      const signal = input.force ? 'SIGKILL' : 'SIGTERM'
      if (result.ok) {
        sampler.invalidateProcesses()
        orca.log(`OS Vitals sent ${signal} to ${row ? row.name : 'pid'} (${input.pid})`)
      } else {
        orca.log(`OS Vitals did not quit pid ${input.pid}: ${result.reason}`)
      }
      return result
    })
  )

  const cliRunner =
    (program: string): RunCli =>
    async (args) => {
      const controller = new AbortController()
      controllers.add(controller)
      try {
        return await deps.runCli(program, args, controller.signal)
      } finally {
        controllers.delete(controller)
      }
    }

  const notifyNumbers = async (reason: string): Promise<void> => {
    const latest = sampler.latest()
    const load = provider.load()
    const parts = [`CPU ${percent(latest ? latest.total : null)}`]
    const memory = sampler.memory()
    if (memory) parts.push(`MEM ${percent(memoryPercent(memory))}`)
    if (load) parts.push(`Load ${loadAverage(load)}`)
    orca.log(`OS Vitals could not open its panel: ${reason}`)
    try {
      await orca.host.call('notifications.show', { title: 'OS Vitals', body: parts.join(' · ') })
    } catch (error) {
      orca.log(`OS Vitals could not show a notification: ${message(error)}`)
    }
  }

  const openPanel = async () => {
    const program = deps.locateCli()
    const result = await openOwnPanel(program ? cliRunner(program) : null, deps.workerFile)
    if (!result.opened) await notifyNumbers(result.reason)
    return result
  }

  subscriptions.push(orca.commands.register(OPEN_COMMAND, openPanel))

  return {
    stop() {
      stopped = true
      sampler.stop()
      provider.dispose()
      for (const controller of controllers) controller.abort()
      controllers.clear()
      for (const subscription of subscriptions.splice(0)) subscription.dispose()
    }
  }
}

function ownFile(): string | null {
  try {
    return fileURLToPath(import.meta.url)
  } catch {
    return null
  }
}

export function realDeps(): VitalsDeps {
  return {
    clock: realClock,
    provider: createProvider(process.platform),
    locateCli: () => locateCli({ platform: process.platform, execPath: process.execPath }),
    runCli: (program, args, signal) =>
      new Promise((resolve) => {
        runOrcaCli(program, args, signal, resolve)
      }),
    workerFile: ownFile(),
    quit: {
      uid: currentUid(),
      selfPid: process.pid,
      parentPid: process.ppid,
      bundle: appBundle(process.platform, process.execPath)
    },
    kill: (pid, signal) => {
      process.kill(pid, signal)
    }
  }
}

function currentUid(): number {
  try {
    return userInfo().uid
  } catch {
    return -1
  }
}

export function appBundle(platform: string, execPath: string): string | null {
  if (platform === 'darwin') return outermostApp(execPath)
  if (platform === 'linux' && posix.isAbsolute(execPath)) return posix.dirname(execPath)
  return null
}

let current: Vitals | null = null

export default async function activate(orca: OrcaWorkerApi): Promise<void> {
  current?.stop()
  current = null
  current = await startVitals(orca, realDeps())
}

export function deactivate(): void {
  current?.stop()
  current = null
}
