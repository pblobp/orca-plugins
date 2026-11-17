import {
  assert,
  hostError,
  mockHost,
  mountWorker,
  test,
  type MockHost,
  type TestWorker
} from 'orca/testing'
import type { OrcaWorkerApi } from 'orca/worker'
import type { CliResult } from './cli.ts'
import type { Clock, TimerHandle } from './clock.ts'
import type { CpuTimes } from './cpu.ts'
import { processName, type Identity, type RawProcess } from './parse/ps.ts'
import { nodeOsProvider } from './platform/fallback.ts'
import type { Provider } from './platform/types.ts'
import type {
  DetailResult,
  HelloResult,
  MemoryReading,
  PollResult,
  ProcessQuery
} from './protocol.ts'
import { startVitals, type Vitals, type VitalsDeps } from './worker.ts'

type Timer = { at: number; callback: () => void }

const START = 1_700_000_000_000
const GB = 1024 ** 3
const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

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
    async advance(ms: number) {
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
        await settle()
        await settle()
      }
      now = end
      await settle()
    }
  }
}

const MEMORY: MemoryReading = {
  total: 16 * GB,
  used: 8 * GB,
  app: 5 * GB,
  wired: 2 * GB,
  compressed: 1 * GB,
  cached: 3 * GB,
  free: 5 * GB,
  swapUsed: 0,
  swapTotal: 0,
  pressure: 'normal'
}

function fakeSystem(extra: RawProcess[] = []) {
  const step = { user: 250, nice: 0, sys: 50, idle: 700, irq: 0 }
  const totals: CpuTimes[] = Array.from({ length: 4 }, () => ({
    user: 1000,
    nice: 0,
    sys: 1000,
    idle: 10000,
    irq: 0
  }))
  const calls = {
    processes: 0,
    detail: [] as number[],
    disposed: 0,
    identify: [] as number[],
    kills: [] as [number, string][]
  }
  const identities = new Map<number, Identity | null>()
  let killError: string | null = null
  let cpuTime = 10
  const base = nodeOsProvider(
    {
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
      totalmem: () => 16 * GB,
      freemem: () => 4 * GB
    },
    'darwin'
  )
  const rows = (): RawProcess[] => [
    {
      pid: 1,
      ppid: 0,
      uid: 0,
      pcpu: 0.1,
      rss: 20 * 1024 ** 2,
      cpuTime: 100,
      startedAt: 1000,
      start: 'Sat Nov 14 20:37:20 2026',
      user: 'root',
      comm: '/sbin/launchd'
    },
    {
      pid: 300,
      ppid: 1,
      uid: 501,
      pcpu: 12,
      rss: 2 * GB,
      cpuTime,
      startedAt: 2000,
      start: 'Sun Nov 15 08:01:02 2026',
      user: 'user',
      comm: '/Applications/Example App.app/Contents/MacOS/Example App'
    },
    {
      pid: 42,
      ppid: 300,
      uid: 501,
      pcpu: 3,
      rss: 300 * 1024 ** 2,
      cpuTime: 5,
      startedAt: 3000,
      start: 'Mon Nov 16 12:56:29 2026',
      user: 'user',
      comm: 'node'
    },
    ...extra
  ]
  const listing = (): RawProcess[] => {
    cpuTime += 1
    return rows()
  }
  const provider: Provider = {
    ...base,
    sections: () => ({ ...base.sections(), memory: true, processes: true }),
    memory: async () => MEMORY,
    async processes() {
      calls.processes += 1
      return listing()
    },
    async processDetail(pid) {
      calls.detail.push(pid)
      if (pid !== 42) return null
      return {
        pid: 42,
        ppid: 300,
        uid: 501,
        pcpu: 3,
        rss: 300 * 1024 ** 2,
        cpuTime: 5,
        startedAt: 3000,
        start: 'Mon Nov 16 12:56:29 2026',
        user: 'user',
        comm: 'node /Users/user/project/server.js --port 5173',
        command: 'node /Users/user/project/server.js --port 5173',
        threads: 12
      }
    },
    async identify(pid) {
      calls.identify.push(pid)
      if (identities.has(pid)) return identities.get(pid) ?? null
      const row = rows().find((entry) => entry.pid === pid)
      return row
        ? { start: row.start, uid: row.uid, path: row.comm, name: processName(row.comm) }
        : null
    },
    dispose() {
      calls.disposed += 1
    }
  }
  return {
    provider,
    calls,
    identities,
    kill(pid: number, signal: string) {
      calls.kills.push([pid, signal])
      if (killError) throw Object.assign(new Error(killError), { code: killError })
    },
    failKill(code: string | null) {
      killError = code
    },
    setStep(next: CpuTimes) {
      Object.assign(step, next)
    }
  }
}

type Setup = {
  worker: TestWorker
  host: MockHost
  time: ReturnType<typeof fakeClock>
  system: ReturnType<typeof fakeSystem>
  cli: { calls: string[][]; program: string | null }
  orca: () => OrcaWorkerApi
}

function pluginList(): string {
  return JSON.stringify({
    ok: true,
    result: {
      plugins: [
        {
          pluginKey: 'local.os-vitals',
          status: 'running',
          isDev: true,
          panels: [
            {
              id: 'os-vitals',
              title: 'OS Vitals',
              icon: 'activity',
              tabKey: 'plugin:local.os-vitals/os-vitals'
            }
          ]
        }
      ]
    }
  })
}

async function setup(
  options: {
    settings?: Record<string, string | number | boolean>
    program?: string | null
    extra?: RawProcess[]
    refuseStatusBar?: boolean
  } = {}
): Promise<Setup> {
  const time = fakeClock(START)
  const system = fakeSystem(options.extra)
  const cli = {
    calls: [] as string[][],
    program: options.program === undefined ? '/Orca.app/orca' : options.program
  }
  const deps: VitalsDeps = {
    clock: time.clock,
    provider: system.provider,
    locateCli: () => cli.program,
    runCli: async (_program, args): Promise<CliResult> => {
      cli.calls.push([...args])
      const stdout = args[1] === 'list' ? pluginList() : JSON.stringify({ ok: true, result: {} })
      return { ok: true, stdout, stderr: '', error: null }
    },
    workerFile: '/dev/orca-plugins/plugins/os-vitals/src/worker.ts',
    quit: { uid: 501, selfPid: 900, parentPid: 700, bundle: '/Applications/Orca.app' },
    kill: (pid, signal) => system.kill(pid, signal)
  }
  let vitals: Vitals | null = null
  let api: OrcaWorkerApi | null = null
  const host = mockHost({
    settings: options.settings ?? {},
    results: options.refuseStatusBar
      ? { 'statusBar.update': hostError('consent_required', 'not enabled with current consent') }
      : {}
  })
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
  return { worker, host, time, system, cli, orca }
}

function statusCalls(host: MockHost): Record<string, unknown>[] {
  return host.callsOf('statusBar.update') as Record<string, unknown>[]
}

const TOOLTIP = 'OS Vitals\nLoad 1.50 · 1.25 · 1.00\nMemory 8 of 16 GB, pressure normal'
const query = (overrides: Partial<ProcessQuery> = {}): ProcessQuery => ({
  sort: 'cpu',
  direction: 'desc',
  filter: '',
  limit: 100,
  offset: 0,
  ...overrides
})

test('hello describes the platform, the CPU and what this system supports', async () => {
  const { worker } = await setup()
  const hello = (await worker.request('os-vitals.hello')) as HelloResult
  assert.equal(hello.protocol, 1)
  assert.equal(hello.platform, 'darwin')
  assert.equal(hello.cpuModel, 'Test CPU 9000')
  assert.equal(hello.cores.length, 4)
  assert.equal(hello.totalMemory, 16 * GB)
  assert.equal(hello.sections.cpu, true)
  assert.equal(hello.sections.memory, true)
  assert.equal(hello.sections.processes, true)
  assert.equal(hello.sections.network, false)
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
  assert.deepEqual(first.memory, MEMORY)
  assert.equal(first.processes, null)

  await time.advance(2000)
  const second = (await worker.request('os-vitals.poll', {
    since: first.seq,
    run: first.run
  })) as PollResult
  assert.equal(second.reset, false)
  assert.deepEqual(second.samples, [
    {
      seq: 1,
      t: START + 2000,
      total: 30,
      user: 25,
      system: 5,
      cores: [30, 30, 30, 30],
      memory: MEMORY
    }
  ])

  await time.advance(2000)
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

test('the status bar shows CPU and memory, at most every 5 s and only when the text changes', async () => {
  const { worker, host, time, system } = await setup()
  assert.deepEqual(statusCalls(host), [{ id: 'os-vitals', visible: true }])

  await time.advance(5000)
  assert.deepEqual(statusCalls(host).slice(1), [
    { id: 'os-vitals', text: 'CPU 30% · MEM 50%', tone: 'neutral', tooltip: TOOLTIP }
  ])

  await time.advance(5000)
  assert.equal(statusCalls(host).length, 2)

  system.setStep({ user: 400, nice: 0, sys: 100, idle: 500, irq: 0 })
  await worker.request('os-vitals.poll', {})
  await time.advance(2000)
  assert.equal(statusCalls(host).length, 3)
  assert.equal(statusCalls(host)[2].text, 'CPU 50% · MEM 50%')

  system.setStep({ user: 250, nice: 0, sys: 50, idle: 700, irq: 0 })
  await time.advance(4000)
  assert.equal(statusCalls(host).length, 3)
  await time.advance(2000)
  assert.equal(statusCalls(host).length, 4)
  assert.equal(statusCalls(host)[3].text, 'CPU 30% · MEM 50%')
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('the status bar setting picks CPU, memory or both', async () => {
  const { worker, host, time } = await setup({ settings: { statusBar: 'memory' } })
  await time.advance(5000)
  assert.equal(statusCalls(host).at(-1)?.text, 'MEM 50%')
  await worker.deactivate()
})

test('a hidden status bar item is hidden again on every start, and nothing samples without a panel', async () => {
  const { worker, host, time, system } = await setup({
    settings: { statusBar: 'hidden', memoryAlert: false, cpuAlert: false }
  })
  assert.deepEqual(statusCalls(host), [{ id: 'os-vitals', visible: false }])
  assert.equal(time.pending(), 0)
  await time.advance(60000)
  assert.equal(statusCalls(host).length, 1)
  assert.equal(system.calls.processes, 0)
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('processes are read only when a poll asks for them, then sorted, filtered and paged', async () => {
  const { worker, time, system } = await setup()
  await time.advance(10000)
  await worker.request('os-vitals.poll', {})
  await time.advance(4000)
  assert.equal(system.calls.processes, 0)

  const page = (await worker.request('os-vitals.poll', {
    view: 'processes',
    processes: query()
  })) as PollResult
  assert.equal(system.calls.processes, 1)
  assert.ok(page.processes)
  assert.equal(page.processes.total, 3)
  assert.equal(page.processes.matched, 3)
  assert.deepEqual(
    page.processes.rows.map((row) => [row.name, row.cpu]),
    [
      ['Example App', 12],
      ['node', 3],
      ['launchd', 0.1]
    ]
  )

  const named = (await worker.request('os-vitals.poll', {
    view: 'processes',
    processes: query({ sort: 'name', direction: 'asc', filter: 'e', limit: 1, offset: 1 })
  })) as PollResult
  assert.deepEqual(
    named.processes?.rows.map((row) => row.name),
    ['node']
  )
  assert.equal(named.processes?.matched, 2)
  assert.equal(named.processes?.offset, 1)

  const byPid = (await worker.request('os-vitals.poll', {
    view: 'processes',
    processes: query({ filter: '30' })
  })) as PollResult
  assert.deepEqual(
    byPid.processes?.rows.map((row) => row.pid),
    [300]
  )
  const none = (await worker.request('os-vitals.poll', {
    view: 'processes',
    processes: query({ filter: 'nothing like this' })
  })) as PollResult
  assert.deepEqual(none.processes?.rows, [])
  assert.equal(none.processes?.matched, 0)
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('the Processes view reads processes every tick, the Overview every second tick', async () => {
  const { worker, time, system } = await setup()
  await worker.request('os-vitals.poll', { view: 'processes', processes: query() })
  const start = system.calls.processes
  for (let i = 0; i < 2; i++) {
    await time.advance(2000)
    await worker.request('os-vitals.poll', { view: 'processes', processes: query() })
  }
  assert.equal(system.calls.processes - start, 2)

  const before = system.calls.processes
  for (let i = 0; i < 4; i++) {
    await time.advance(2000)
    await worker.request('os-vitals.poll', { view: 'overview', processes: query({ limit: 5 }) })
  }
  assert.equal(system.calls.processes - before, 2)
  await worker.deactivate()
})

test('process CPU comes from the CPU time used between two readings', async () => {
  const { worker, time } = await setup()
  await worker.request('os-vitals.poll', { view: 'processes', processes: query() })
  await time.advance(2000)
  const page = (await worker.request('os-vitals.poll', {
    view: 'processes',
    processes: query()
  })) as PollResult
  const app = page.processes?.rows.find((row) => row.pid === 300)
  assert.equal(app?.cpu, 50)
  await worker.deactivate()
})

test('details name the command, parent, user, threads and memory of one process', async () => {
  const { worker, system } = await setup()
  await worker.request('os-vitals.poll', { view: 'processes', processes: query() })
  const detail = (await worker.request('os-vitals.process.detail', { pid: 42 })) as DetailResult
  assert.deepEqual(detail, {
    found: true,
    process: {
      pid: 42,
      ppid: 300,
      parentName: 'Example App',
      uid: 501,
      user: 'user',
      name: 'node',
      command: 'node /Users/user/project/server.js --port 5173',
      startedAt: 3000,
      start: 'Mon Nov 16 12:56:29 2026',
      quit: 'allowed',
      cpuTime: 5,
      memory: 300 * 1024 ** 2,
      cpu: 3,
      threads: 12
    }
  })
  assert.deepEqual(await worker.request('os-vitals.process.detail', { pid: 7 }), { found: false })
  await assert.rejects(
    worker.request('os-vitals.process.detail', { pid: -1 }),
    (error: unknown) => (error as { code?: string }).code === 'invalid_params'
  )
  assert.deepEqual(system.calls.detail, [42, 7])
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

const user = (pid: number, comm: string, start: string, ppid = 1, uid = 501): RawProcess => ({
  pid,
  ppid,
  uid,
  pcpu: 0,
  rss: 1024 ** 2,
  cpuTime: 1,
  startedAt: pid * 1000,
  start,
  user: uid === 0 ? 'root' : 'user',
  comm
})

const SLEEP_START = 'Tue Nov 17 10:00:00 2026'
const EXTRA: RawProcess[] = [
  user(
    600,
    '/Users/user/Library/Application Support/orca/daemon-host/a1/orca-terminal-host',
    'Mon Nov 16 14:27:40 2026'
  ),
  user(700, '/Applications/Orca.app/Contents/MacOS/Orca', 'Mon Nov 16 14:27:32 2026'),
  user(
    900,
    '/Applications/Orca.app/Contents/Frameworks/Orca Helper.app/Contents/MacOS/Orca Helper',
    'Tue Nov 17 09:00:00 2026',
    700
  ),
  user(800, '/bin/sleep', SLEEP_START),
  user(810, '/usr/local/bin/backup-agent', 'Tue Nov 17 09:30:00 2026', 1, 0)
]

async function quitSetup() {
  const setup = await setupWith()
  await setup.worker.request('os-vitals.poll', { view: 'processes', processes: query() })
  return setup
}

function setupWith() {
  return setup({ extra: EXTRA })
}

const quit = (worker: TestWorker, data: Record<string, unknown>) =>
  worker.request('os-vitals.process.quit', data as never) as Promise<unknown>

test('each listed row says whether quitting it is offered', async () => {
  const { worker } = await setupWith()
  const page = (await worker.request('os-vitals.poll', {
    view: 'processes',
    processes: query({ sort: 'pid', direction: 'asc' })
  })) as PollResult
  assert.deepEqual(
    page.processes?.rows.map((row) => [row.pid, row.quit]),
    [
      [1, 'system'],
      [42, 'allowed'],
      [300, 'allowed'],
      [600, 'orca'],
      [700, 'orca'],
      [800, 'allowed'],
      [810, 'not_owner'],
      [900, 'orca']
    ]
  )
  await worker.deactivate()
})

test('a quit sends SIGTERM to the listed process, and the next poll reads the list again', async () => {
  const { worker, system } = await quitSetup()
  const reads = system.calls.processes
  assert.deepEqual(await quit(worker, { pid: 800, startedAt: SLEEP_START, force: false }), {
    ok: true
  })
  assert.deepEqual(system.calls.kills, [[800, 'SIGTERM']])
  assert.deepEqual(system.calls.identify, [800])
  await worker.request('os-vitals.poll', { view: 'processes', processes: query() })
  assert.equal(system.calls.processes, reads + 1)
  assert.deepEqual(await quit(worker, { pid: 800, startedAt: SLEEP_START, force: true }), {
    ok: true
  })
  assert.deepEqual(system.calls.kills.at(-1), [800, 'SIGKILL'])
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('refusals answer a reason and send nothing', async () => {
  const { worker, system } = await quitSetup()
  const cases: [Record<string, unknown>, string][] = [
    [{ pid: 1, startedAt: 'Sat Nov 14 20:37:20 2026', force: false }, 'protected'],
    [{ pid: 600, startedAt: 'Mon Nov 16 14:27:40 2026', force: true }, 'protected'],
    [{ pid: 700, startedAt: 'Mon Nov 16 14:27:32 2026', force: false }, 'protected'],
    [{ pid: 900, startedAt: 'Tue Nov 17 09:00:00 2026', force: false }, 'protected'],
    [{ pid: 810, startedAt: 'Tue Nov 17 09:30:00 2026', force: false }, 'not_owner'],
    [{ pid: 800, startedAt: 'Tue Nov 17 10:00:01 2026', force: false }, 'changed'],
    [{ pid: 4242, startedAt: SLEEP_START, force: false }, 'gone']
  ]
  for (const [input, reason] of cases) {
    assert.deepEqual(await quit(worker, input), { ok: false, reason }, JSON.stringify(input))
  }
  system.identities.set(800, { start: SLEEP_START, uid: 501, path: '/bin/zsh', name: 'zsh' })
  assert.deepEqual(await quit(worker, { pid: 800, startedAt: SLEEP_START, force: false }), {
    ok: false,
    reason: 'changed'
  })
  assert.deepEqual(system.calls.kills, [])
  system.identities.delete(800)
  system.failKill('ESRCH')
  assert.deepEqual(await quit(worker, { pid: 800, startedAt: SLEEP_START, force: false }), {
    ok: false,
    reason: 'gone'
  })
  system.failKill('EPERM')
  assert.deepEqual(await quit(worker, { pid: 800, startedAt: SLEEP_START, force: false }), {
    ok: false,
    reason: 'not_permitted'
  })
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('quit input is checked strictly', async () => {
  const { worker, system } = await quitSetup()
  const bad: unknown[] = [
    null,
    {},
    { pid: 800, startedAt: SLEEP_START },
    { pid: '800', startedAt: SLEEP_START, force: false },
    { pid: 800.5, startedAt: SLEEP_START, force: false },
    { pid: 0, startedAt: SLEEP_START, force: false },
    { pid: -1, startedAt: SLEEP_START, force: false },
    { pid: 800, startedAt: 1700000000000, force: false },
    { pid: 800, startedAt: '2026-11-17T10:00:00Z', force: false },
    { pid: 800, startedAt: SLEEP_START, force: 'yes' },
    { pid: 800, startedAt: SLEEP_START, force: false, signal: 'SIGKILL' }
  ]
  for (const input of bad) {
    await assert.rejects(
      quit(worker, input as Record<string, unknown>),
      (error: unknown) => (error as { code?: string }).code === 'invalid_params'
    )
  }
  assert.deepEqual(system.calls.identify, [])
  assert.deepEqual(system.calls.kills, [])
  await worker.deactivate()
})

test('a refused status bar update is sent again with the next reading', async () => {
  const { worker, host, time } = await setup({ refuseStatusBar: true })
  await time.advance(5000)
  const calls = statusCalls(host)
  assert.deepEqual(calls.slice(0, 2), [
    { id: 'os-vitals', visible: true },
    { id: 'os-vitals', visible: true }
  ])
  assert.ok(worker.logs.some((line) => line.includes('could not update its status bar item')))
  await worker.deactivate()
})

test('a changed setting applies at once', async () => {
  const { worker, host, time, orca } = await setup()
  await time.advance(5000)
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
  await time.advance(5000)
  await worker.command('os-vitals.open')
  assert.deepEqual(cli.calls, [])
  assert.deepEqual(host.callsOf('notifications.show'), [
    { title: 'OS Vitals', body: 'CPU 30% · MEM 50% · Load 1.50 · 1.25 · 1.00' }
  ])
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('deactivate stops every timer and the provider', async () => {
  const { worker, time, system } = await setup()
  await worker.request('os-vitals.poll', {})
  assert.equal(time.pending(), 1)
  await worker.deactivate()
  assert.equal(time.pending(), 0)
  assert.equal(system.calls.disposed, 1)
})
