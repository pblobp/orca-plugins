import { assert, mockHost, mountWorker, test, type MockHost, type TestWorker } from 'orca/testing'
import type { OrcaWorkerApi } from 'orca/worker'
import type { CliResult } from './cli.ts'
import type { Clock, TimerHandle } from './clock.ts'
import type { CpuTimes } from './cpu.ts'
import { nodeOsProvider } from './platform/fallback.ts'
import type { HelloResult, PollResult } from './protocol.ts'
import { startVitals, type Vitals, type VitalsDeps } from './worker.ts'

type Timer = { at: number; callback: () => void }

function fakeClock(start: number) {
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
    pending: () => timers.size,
    advance(ms: number) {
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

function fakeCpus(cores: number) {
  const step = { user: 250, nice: 0, sys: 50, idle: 700, irq: 0 }
  const totals: CpuTimes[] = Array.from({ length: cores }, () => ({
    user: 1000,
    nice: 0,
    sys: 1000,
    idle: 10000,
    irq: 0
  }))
  return {
    setStep(next: CpuTimes) {
      Object.assign(step, next)
    },
    source: {
      cpus() {
        for (const times of totals) {
          times.user += step.user
          times.nice += step.nice
          times.sys += step.sys
          times.idle += step.idle
          times.irq += step.irq
        }
        return totals.map((times) => ({ model: 'Test CPU   9000', times: { ...times } }))
      },
      loadavg: () => [1.5, 1.25, 1],
      uptime: () => 93784,
      totalmem: () => 16 * 1024 ** 3
    }
  }
}

type Setup = {
  worker: TestWorker
  host: MockHost
  time: ReturnType<typeof fakeClock>
  cpus: ReturnType<typeof fakeCpus>
  cli: { calls: string[][]; program: string | null }
  orca: () => OrcaWorkerApi
}

const START = 1_700_000_000_000
const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

function pluginList(): string {
  return JSON.stringify({
    ok: true,
    result: {
      plugins: [
        {
          pluginKey: 'local.os-vitals',
          status: 'running',
          isDev: true,
          panels: [{ id: 'os-vitals', title: 'OS Vitals' }]
        }
      ]
    }
  })
}

async function setup(
  options: { settings?: Record<string, string | number | boolean>; program?: string | null } = {}
): Promise<Setup> {
  const time = fakeClock(START)
  const cpus = fakeCpus(4)
  const cli = {
    calls: [] as string[][],
    program: options.program === undefined ? '/Orca.app/orca' : options.program
  }
  const deps: VitalsDeps = {
    clock: time.clock,
    provider: nodeOsProvider(cpus.source, 'darwin'),
    locateCli: () => cli.program,
    runCli: async (_program, args): Promise<CliResult> => {
      cli.calls.push([...args])
      const stdout = args[1] === 'list' ? pluginList() : JSON.stringify({ ok: true, result: {} })
      return { ok: true, stdout, stderr: '', error: null }
    },
    workerFile: '/dev/orca-plugins/plugins/os-vitals/src/worker.ts'
  }
  let vitals: Vitals | null = null
  let api: OrcaWorkerApi | null = null
  const host = mockHost({ settings: options.settings ?? {} })
  const worker = await mountWorker(
    {
      default: async (orca: OrcaWorkerApi) => {
        api = orca
        vitals = await startVitals(orca, deps)
      },
      deactivate: () => vitals?.stop()
    },
    { host }
  )
  const orca = () => {
    if (!api) throw new Error('the worker did not start')
    return api
  }
  return { worker, host, time, cpus, cli, orca }
}

function statusCalls(host: MockHost): Record<string, unknown>[] {
  return host.callsOf('statusBar.update') as Record<string, unknown>[]
}

test('hello describes the platform, the CPU and what this system supports', async () => {
  const { worker } = await setup()
  const hello = (await worker.request('os-vitals.hello')) as HelloResult
  assert.equal(hello.protocol, 1)
  assert.equal(hello.platform, 'darwin')
  assert.equal(hello.cpuModel, 'Test CPU 9000')
  assert.equal(hello.cores.length, 4)
  assert.equal(hello.totalMemory, 16 * 1024 ** 3)
  assert.equal(hello.sections.cpu, true)
  assert.equal(hello.sections.load, true)
  assert.equal(hello.sections.processes, false)
  assert.equal(hello.intervalMs, 2000)
  assert.equal(hello.historyMs, 300000)
  assert.equal(hello.defaultView, 'last')
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('poll answers the whole history first, then only new samples', async () => {
  const { worker, time } = await setup()
  const first = (await worker.request('os-vitals.poll', {})) as PollResult
  assert.equal(first.reset, true)
  assert.deepEqual(first.samples, [])
  assert.deepEqual(first.current, { load: [1.5, 1.25, 1], uptime: 93784 })

  time.advance(2000)
  const second = (await worker.request('os-vitals.poll', {
    since: first.seq,
    run: first.run
  })) as PollResult
  assert.equal(second.reset, false)
  assert.equal(second.samples.length, 1)
  assert.deepEqual(second.samples[0], {
    seq: 1,
    t: START + 2000,
    total: 30,
    user: 25,
    system: 5,
    cores: [30, 30, 30, 30]
  })

  time.advance(2000)
  const third = (await worker.request('os-vitals.poll', {
    since: second.seq,
    run: second.run
  })) as PollResult
  assert.deepEqual(
    third.samples.map((sample) => sample.seq),
    [2]
  )

  const restarted = (await worker.request('os-vitals.poll', {
    since: 99,
    run: 'another-run'
  })) as PollResult
  assert.equal(restarted.reset, true)
  assert.deepEqual(
    restarted.samples.map((sample) => sample.seq),
    [1, 2]
  )
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('the status bar item shows CPU, at most every 5 s and only when the text changes', async () => {
  const { worker, host, time, cpus } = await setup()
  assert.deepEqual(statusCalls(host), [{ id: 'os-vitals', visible: true }])

  time.advance(5000)
  await settle()
  assert.deepEqual(statusCalls(host).slice(1), [
    {
      id: 'os-vitals',
      text: 'CPU 30%',
      tone: 'neutral',
      tooltip: 'OS Vitals\nLoad 1.50 · 1.25 · 1.00'
    }
  ])

  time.advance(5000)
  await settle()
  assert.equal(statusCalls(host).length, 2)

  cpus.setStep({ user: 400, nice: 0, sys: 100, idle: 500, irq: 0 })
  await worker.request('os-vitals.poll', {})
  time.advance(2000)
  await settle()
  assert.equal(statusCalls(host).length, 3)
  assert.equal(statusCalls(host)[2].text, 'CPU 50%')

  cpus.setStep({ user: 250, nice: 0, sys: 50, idle: 700, irq: 0 })
  time.advance(2000)
  await settle()
  time.advance(2000)
  await settle()
  assert.equal(statusCalls(host).length, 3)
  time.advance(2000)
  await settle()
  assert.equal(statusCalls(host).length, 4)
  assert.equal(statusCalls(host)[3].text, 'CPU 30%')
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('a hidden status bar item is hidden again on every start, and nothing samples without a panel', async () => {
  const { worker, host, time } = await setup({
    settings: { statusBar: 'hidden', memoryAlert: false, cpuAlert: false }
  })
  assert.deepEqual(statusCalls(host), [{ id: 'os-vitals', visible: false }])
  assert.equal(time.pending(), 0)
  time.advance(60000)
  await settle()
  assert.equal(statusCalls(host).length, 1)
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('a changed setting applies at once', async () => {
  const { worker, host, time, orca } = await setup()
  time.advance(5000)
  await settle()
  await orca().settings.set('statusBar', 'hidden')
  await settle()
  await settle()
  assert.deepEqual(statusCalls(host).at(-1), { id: 'os-vitals', visible: false })

  await orca().settings.set('refreshSeconds', 5)
  await settle()
  await settle()
  const hello = (await worker.request('os-vitals.hello')) as HelloResult
  assert.equal(hello.intervalMs, 5000)
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('the open command opens the panel through Orca CLI', async () => {
  const { worker, host, cli } = await setup()
  await worker.command('os-vitals.open')
  assert.deepEqual(cli.calls, [
    ['plugin', 'list', '--json'],
    ['plugin', 'open', 'local.os-vitals', '--panel', 'os-vitals', '--json']
  ])
  assert.equal(host.callsOf('notifications.show').length, 0)
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('without the CLI the open command shows the current numbers instead', async () => {
  const { worker, host, time, cli } = await setup({ program: null })
  time.advance(5000)
  await worker.command('os-vitals.open')
  assert.deepEqual(cli.calls, [])
  assert.deepEqual(host.callsOf('notifications.show'), [
    { title: 'OS Vitals', body: 'CPU 30% · Load 1.50 · 1.25 · 1.00' }
  ])
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('deactivate stops every timer', async () => {
  const { worker, time } = await setup()
  await worker.request('os-vitals.poll', {})
  assert.equal(time.pending(), 1)
  await worker.deactivate()
  assert.equal(time.pending(), 0)
})
