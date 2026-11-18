import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ASSERTION_ARGS,
  BATTERY_ARGS,
  darwinProvider,
  detailArgs,
  DF_ARGS,
  identityArgs,
  IOREG_CPU_ARGS,
  IOREG_DISK_ARGS,
  IOREG_GPU_ARGS,
  MEMORY_KEYS,
  NETSTAT_ARGS,
  PROCESS_LIST_ARGS,
  ROUTE_ARGS,
  threadArgs,
  TOP_ARGS,
  TOP_TIMEOUT_MS,
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
      if (args.includes('IOAccelerator')) return fixture('darwin/ioreg-gpu.txt')
      if (args.includes('IOBlockStorageDriver')) return fixture('darwin/ioreg-disk.txt')
      return fixture('darwin/ioreg-cpus.txt')
    },
    async netstat(args) {
      calls.push(['netstat', ...args])
      return fixture('darwin/netstat.txt')
    },
    async route(args) {
      calls.push(['route', ...args])
      return fixture('darwin/route.txt')
    },
    async df(args) {
      calls.push(['df', ...args])
      return fixture('darwin/df.txt')
    },
    async pmset(args) {
      calls.push(['pmset', ...args])
      return fixture(
        args.includes('assertions') ? 'darwin/pmset-assertions.txt' : 'darwin/pmset-batt.txt'
      )
    },
    async top(args) {
      calls.push(['top', ...args])
      return fixture('darwin/top.txt')
    },
    async space(path) {
      calls.push(['statfs', path])
      return { total: 494e9, available: 119e9 }
    },
    async startupName() {
      calls.push(['startup name'])
      return 'Macintosh HD'
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
  const cpuReads = calls.filter((call) => call[0] === 'ioreg' && call.includes('IOPlatformDevice'))
  assert.equal(cpuReads.length, 1)
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

test('the new macOS commands are the ones the plan names', () => {
  assert.deepEqual(NETSTAT_ARGS, ['-ibn'])
  assert.deepEqual(ROUTE_ARGS, ['-n', 'get', 'default'])
  assert.deepEqual(IOREG_DISK_ARGS, ['-r', '-d', '2', '-w', '0', '-c', 'IOBlockStorageDriver'])
  assert.deepEqual(IOREG_GPU_ARGS, ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'])
  assert.deepEqual(DF_ARGS, ['-kPl'])
  assert.deepEqual(BATTERY_ARGS, ['-g', 'batt'])
  assert.deepEqual(ASSERTION_ARGS, ['-g', 'assertions'])
  assert.deepEqual(TOP_ARGS.slice(0, 4), ['-l', '2', '-s', '1'])
  assert.equal(TOP_ARGS.at(-1), 'pid,power')
  assert.equal(TOP_TIMEOUT_MS, 4000)
})

test('network, disk, GPU, volumes, battery and energy come from their commands', async () => {
  const { calls, commands } = fakeCommands()
  const provider = darwinProvider(fakeOs(14), commands)
  await provider.init()
  const network = await provider.network()
  assert.equal(network?.find((row) => row.name === 'en0')?.rxBytes, 15580487486)
  assert.equal(await provider.defaultInterface(), 'en0')
  const disk = await provider.disk()
  assert.equal(disk?.length, 3)
  assert.equal((await provider.gpu())?.utilization, 22)
  assert.deepEqual(await provider.volumes(), [
    { name: 'Macintosh HD', mount: '/', startup: true, total: 494e9, available: 119e9 },
    {
      name: 'Backup Drive',
      mount: '/Volumes/Backup Drive',
      startup: false,
      total: 1953104896 * 1024,
      available: 781241960 * 1024
    },
    {
      name: 'USB 2 0',
      mount: '/Volumes/USB 2 0',
      startup: false,
      total: 30703616 * 1024,
      available: 29655040 * 1024
    }
  ])
  assert.equal((await provider.battery())?.percent, 69)
  assert.equal((await provider.energy())?.[0].pid, 1650)
  assert.equal((await provider.assertions())?.length, 12)
  assert.deepEqual(
    calls.find((call) => call[0] === 'statfs'),
    ['statfs', '/System/Volumes/Data']
  )
  assert.deepEqual(
    calls.find((call) => call[0] === 'top'),
    ['top', ...TOP_ARGS]
  )
  assert.deepEqual(provider.sections(), {
    cpu: true,
    load: true,
    memory: true,
    processes: true,
    network: true,
    disk: true,
    gpu: true,
    battery: true,
    energy: true
  })
})

test('a desktop has no battery section, and pmset is not asked again', async () => {
  const { calls, commands } = fakeCommands({
    pmset: async (args) => {
      calls.push(['pmset', ...args])
      return fixture('darwin/pmset-batt-desktop.txt')
    }
  })
  const provider = darwinProvider(fakeOs(14), commands)
  await provider.init()
  assert.equal(provider.sections().battery, false)
  assert.equal(await provider.battery(), null)
  assert.equal(await provider.battery(), null)
  assert.equal(calls.filter((call) => call[0] === 'pmset').length, 1)
})

test('a Mac without GPU statistics has no GPU section, and ioreg is not asked again', async () => {
  const { calls, commands } = fakeCommands({
    ioreg: async (args) => {
      calls.push(['ioreg', ...args])
      return args.includes('IOAccelerator')
        ? fixture('darwin/ioreg-gpu-idle.txt')
        : fixture('darwin/ioreg-cpus.txt')
    }
  })
  const provider = darwinProvider(fakeOs(14), commands)
  await provider.init()
  assert.equal(provider.sections().gpu, false)
  assert.equal(await provider.gpu(), null)
  assert.equal(calls.filter((call) => call.includes('IOAccelerator')).length, 1)
})

test('each new section turns off after repeated failures, and the others carry on', async () => {
  const fail = async () => {
    throw new Error('failed')
  }
  const provider = darwinProvider(
    fakeOs(14),
    fakeCommands({ netstat: fail, top: fail, df: fail, pmset: fail }).commands
  )
  await provider.init()
  for (let i = 0; i < FAILURE_LIMIT; i++) {
    assert.equal(await provider.network(), null)
    assert.equal(await provider.energy(), null)
    assert.equal(await provider.battery(), null)
  }
  const volumes = await provider.volumes()
  assert.equal(volumes?.length, 1)
  assert.equal(volumes?.[0].startup, true)
  const sections = provider.sections()
  assert.equal(sections.network, false)
  assert.equal(sections.energy, false)
  assert.equal(sections.battery, false)
  assert.equal(sections.disk, true)
  assert.equal(sections.gpu, true)
})

test('the startup volume falls back to / and to a plain name', async () => {
  const asked: string[] = []
  const provider = darwinProvider(
    fakeOs(14),
    fakeCommands({
      space: async (path) => {
        asked.push(path)
        return path === '/' ? { total: 100, available: 40 } : null
      },
      startupName: async () => null
    }).commands
  )
  const volumes = await provider.volumes()
  assert.deepEqual(asked, ['/System/Volumes/Data', '/'])
  assert.deepEqual(volumes?.[0], {
    name: 'Startup disk',
    mount: '/',
    startup: true,
    total: 100,
    available: 40
  })
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

test('re-identification reads one pid with lstart, uid and comm', async () => {
  const calls: string[][] = []
  const provider = darwinProvider(
    fakeOs(14),
    fakeCommands({
      ps: async (args) => {
        calls.push([...args])
        return fixture('darwin/ps-identity.txt')
      }
    }).commands
  )
  assert.deepEqual(await provider.identify(800), {
    start: 'Tue Nov 17 10:00:00 2026',
    uid: 501,
    path: '/Applications/Example App.app/Contents/MacOS/Example App',
    name: 'Example App'
  })
  assert.deepEqual(calls, [['-p', '800', '-o', 'lstart=', '-o', 'uid=', '-o', 'comm=']])
  assert.deepEqual(identityArgs(800), calls[0])
})

test('ps exiting with status 1 means the process is gone; other failures are errors', async () => {
  const failing = (error: Error) =>
    darwinProvider(
      fakeOs(14),
      fakeCommands({
        ps: async () => {
          throw error
        }
      }).commands
    )
  assert.equal(await failing(Object.assign(new Error('exit 1'), { code: 1 })).identify(4242), null)
  await assert.rejects(
    failing(Object.assign(new Error('timed out'), { killed: true })).identify(4242),
    /timed out/
  )
  const garbled = darwinProvider(fakeOs(14), fakeCommands({ ps: async () => 'garbage' }).commands)
  await assert.rejects(garbled.identify(4242), /no identity/)
})
