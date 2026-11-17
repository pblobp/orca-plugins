import { fileURLToPath } from 'node:url'
import type { OrcaWorkerApi } from 'orca/worker'
import { locateCli, runOrcaCli, type CliResult } from './cli.ts'
import { realClock, type Clock } from './clock.ts'
import { openOwnPanel, type RunCli } from './open-panel.ts'
import { createProvider, type Provider } from './platform/index.ts'
import type { HelloResult, PollInput, PollResult, Sample } from './protocol.ts'
import { createSampler, type SamplerConfig } from './sampler.ts'
import {
  backgroundEnabled,
  DEFAULT_SETTINGS,
  readSettings,
  type VitalsSettings
} from './settings.ts'
import { createStatusBar, loadText, percentText, type StatusBarUpdate } from './status.ts'

export const OPEN_COMMAND = 'os-vitals.open'
export const CORE_HISTORY_LIMIT = 120

export type VitalsDeps = {
  clock: Clock
  provider: Provider
  locateCli: () => string | null
  runCli: (program: string, args: readonly string[], signal: AbortSignal) => Promise<CliResult>
  workerFile: string | null
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
  if (typeof raw.view === 'string' && raw.view.length <= 32) out.view = raw.view
  return out
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

  const updateStatusBar = (params: StatusBarUpdate): void => {
    orca.host.call('statusBar.update', params).catch((error: unknown) => {
      orca.log(`OS Vitals could not update its status bar item: ${message(error)}`)
    })
  }
  const statusBar = createStatusBar({ clock, update: updateStatusBar })

  const showStatus = (sample: Sample | null, force: boolean): void => {
    if (!sample) return
    statusBar.show(
      settings.statusBar,
      { cpu: sample.total, memory: null, load: provider.load() },
      force
    )
  }

  const sampler = createSampler(
    {
      clock,
      provider,
      onSample: (sample) => showStatus(sample, false),
      onError: (error) => orca.log(`OS Vitals could not read the CPU: ${message(error)}`)
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
    orca.panels.handle('os-vitals.poll', (rawInput): PollResult => {
      const input = readInput(rawInput)
      sampler.notePoll()
      const reset = input.run !== run
      const since = reset ? 0 : (input.since ?? 0)
      const samples = sampler.since(since)
      return {
        run,
        reset,
        seq: sampler.seq(),
        samples: reset ? trimCores(samples) : samples,
        current: { load: provider.load(), uptime: provider.uptime() },
        intervalMs: settings.refreshSeconds * 1000,
        historyMs: settings.historyMinutes * 60 * 1000
      }
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
    const parts = [`CPU ${percentText(latest ? latest.total : null)}`]
    if (load) parts.push(`Load ${loadText(load)}`)
    orca.log(`OS Vitals could not open its panel: ${reason}`)
    try {
      await orca.host.call('notifications.show', { title: 'OS Vitals', body: parts.join(' · ') })
    } catch (error) {
      orca.log(`OS Vitals could not show a notification: ${message(error)}`)
    }
  }

  subscriptions.push(
    orca.commands.register(OPEN_COMMAND, async () => {
      const program = deps.locateCli()
      const result = await openOwnPanel(program ? cliRunner(program) : null, deps.workerFile)
      if (!result.opened) await notifyNumbers(result.reason)
    })
  )

  return {
    stop() {
      stopped = true
      sampler.stop()
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
    workerFile: ownFile()
  }
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
