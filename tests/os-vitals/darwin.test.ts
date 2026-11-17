import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  darwinProvider,
  detailArgs,
  IOREG_CPU_ARGS,
  MEMORY_KEYS,
  PROCESS_LIST_ARGS,
  threadArgs,
  type DarwinCommands
} from '../../plugins/os-vitals/src/platform/darwin.ts'
import { FAILURE_LIMIT } from '../../plugins/os-vitals/src/platform/types.ts'
import { fixture } from './helpers.ts'

function fakeOs(cores: number) {
  return {
    cpus: () =>
      Array.from({ length: cores }, () => ({
        model: 'Apple M4 Pro',
        times: { user: 1, nice: 0, sys: 1, idle: 1, irq: 0 }
      })),
    loadavg: () => [1, 1, 1],
    uptime: () => 10,
    totalmem: () => 51539607552,
    freemem: () => 1
  }
}

function fakeCommands(overrides: Partial<DarwinCommands> = {}) {
  const calls: string[][] = []
  const commands: DarwinCommands = {
    async ps(args) {
      calls.push(['ps', ...args])
      if (args[0] === '-A') return fixture('darwin/ps.txt')
      if (args[0] === '-M') return fixture('darwin/ps-threads.txt')
      return fixture('darwin/ps-detail.txt')
    },
    async vmStat() {
      calls.push(['vm_stat'])
      return fixture('darwin/vm_stat.txt')
    },
    async sysctl(args) {
      calls.push(['sysctl', ...args])
      return fixture('darwin/sysctl.txt')
    },
    async ioreg(args) {
      calls.push(['ioreg', ...args])
      return fixture('darwin/ioreg-cpus.txt')
    },
    dispose() {
      calls.push(['dispose'])
    },
    ...overrides
  }
  return { calls, commands }
}

test('the commands are the ones the plan names, with their exact columns', () => {
  assert.deepEqual(PROCESS_LIST_ARGS, [
    '-A',
    ...['-o', 'pid=', '-o', 'ppid=', '-o', 'uid=', '-o', 'pcpu=', '-o', 'rss=', '-o', 'time='],
    ...['-o', 'lstart=', '-o', 'user=', '-o', 'comm=']
  ])
  assert.deepEqual(MEMORY_KEYS, [
    'hw.memsize',
    'vm.swapusage',
    'kern.memorystatus_vm_pressure_level'
  ])
  assert.deepEqual(IOREG_CPU_ARGS, ['-p', 'IODeviceTree', '-c', 'IOPlatformDevice'])
  assert.deepEqual(detailArgs(42).slice(0, 2), ['-p', '42'])
  assert.equal(detailArgs(42).at(-1), 'command=')
  assert.deepEqual(threadArgs(42), ['-M', '-p', '42'])
})

test('core kinds are read once at start and matched to os.cpus()', async () => {
  const { calls, commands } = fakeCommands()
  const provider = darwinProvider(fakeOs(14), commands)
  assert.deepEqual(provider.cores()[0], { kind: null })
  await provider.init()
  const cores = provider.cores()
  assert.equal(cores.filter((core) => core.kind === 'efficiency').length, 4)
  assert.equal(cores.filter((core) => core.kind === 'performance').length, 10)
  assert.deepEqual(cores[0], { kind: 'efficiency' })
  assert.deepEqual(cores[4], { kind: 'performance' })
  assert.equal(calls.filter((call) => call[0] === 'ioreg').length, 1)
})

test('core kinds are dropped when their count does not match os.cpus(), or ioreg fails', async () => {
  const mismatch = darwinProvider(fakeOs(8), fakeCommands().commands)
  await mismatch.init()
  assert.ok(mismatch.cores().every((core) => core.kind === null))
  const failing = darwinProvider(
    fakeOs(14),
    fakeCommands({
      ioreg: async () => {
        throw new Error('ioreg failed')
      }
    }).commands
  )
  await failing.init()
  assert.ok(failing.cores().every((core) => core.kind === null))
})

test('memory, processes and details come from the commands', async () => {
  const { calls, commands } = fakeCommands()
  const provider = darwinProvider(fakeOs(14), commands)
  assert.equal((await provider.memory())?.pressure, 'normal')
  assert.equal((await provider.processes())?.length, 11)
  const detail = await provider.processDetail(25251)
  assert.equal(detail?.threads, 4)
  assert.deepEqual(calls.slice(0, 2), [['vm_stat'], ['sysctl', ...MEMORY_KEYS]])
  assert.deepEqual(calls[2], ['ps', ...PROCESS_LIST_ARGS])
  assert.deepEqual(calls.slice(3), [
    ['ps', ...detailArgs(25251)],
    ['ps', ...threadArgs(25251)]
  ])
  assert.deepEqual(provider.sections().memory, true)
  assert.deepEqual(provider.sections().processes, true)
  provider.dispose()
  assert.deepEqual(calls.at(-1), ['dispose'])
})

test('a failing command turns its section off after repeated failures', async () => {
  let vmStatWorks = false
  const provider = darwinProvider(
    fakeOs(14),
    fakeCommands({
      vmStat: async () => {
        if (vmStatWorks) return fixture('darwin/vm_stat.txt')
        throw new Error('vm_stat timed out')
      },
      ps: async () => 'garbage'
    }).commands
  )
  assert.equal(await provider.memory(), null)
  vmStatWorks = true
  assert.ok(await provider.memory())
  vmStatWorks = false
  for (let i = 0; i < FAILURE_LIMIT; i++) assert.equal(await provider.memory(), null)
  assert.equal(provider.sections().memory, false)
  assert.equal(await provider.memory(), null)

  for (let i = 0; i < FAILURE_LIMIT; i++) assert.equal(await provider.processes(), null)
  assert.equal(provider.sections().processes, false)
  assert.equal(provider.sections().cpu, true)
})

test('a process that is gone has no details', async () => {
  const provider = darwinProvider(
    fakeOs(14),
    fakeCommands({
      ps: async () => {
        throw new Error('exit 1')
      }
    }).commands
  )
  assert.equal(await provider.processDetail(99999), null)
})
