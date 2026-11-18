import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  linuxProvider,
  mapLimit,
  NVIDIA_ARGS,
  NVIDIA_PATHS,
  PROCESS_CONCURRENCY,
  type LinuxCommands
} from '../../plugins/os-vitals/src/platform/linux.ts'
import { FAILURE_LIMIT } from '../../plugins/os-vitals/src/platform/types.ts'
import { createProcessTracker } from '../../plugins/os-vitals/src/processes.ts'
import { createOfferer, quitProcess } from '../../plugins/os-vitals/src/quit.ts'
import { appBundle } from '../../plugins/os-vitals/src/worker.ts'
import { fixtureFiles } from './linux-files.ts'

const KB = 1024
const NOW = 1_800_000_000_000

function fakeOs(model = 'Example CPU @ 3.00GHz') {
  return {
    cpus: () =>
      Array.from({ length: 4 }, () => ({
        model,
        times: { user: 1, nice: 0, sys: 1, idle: 1, irq: 0 }
      })),
    loadavg: () => [0.5, 0.4, 0.3],
    uptime: () => 93784.21,
    totalmem: () => 16303088 * KB,
    freemem: () => 1402316 * KB
  }
}

function noNvidia(calls: number[] = []): LinuxCommands {
  return {
    async nvidiaSmi(index) {
      calls.push(index)
      throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
    },
    dispose() {}
  }
}

async function host(options: { age?: number; commands?: LinuxCommands; tree?: string } = {}) {
  const files = fixtureFiles(options.tree ?? 'host')
  const provider = linuxProvider(fakeOs(), files, options.commands ?? noNvidia(), {
    now: () => NOW,
    age: () => options.age ?? 2000
  })
  await provider.init()
  return { provider, files }
}

test('the Linux provider reports what a laptop has, and no energy impact', async () => {
  const { provider } = await host()
  assert.deepEqual(provider.sections(), {
    cpu: true,
    load: true,
    memory: true,
    processes: true,
    network: true,
    disk: true,
    gpu: true,
    battery: true,
    energy: false
  })
  assert.equal(provider.platform, 'linux')
  assert.equal(provider.cpuModel(), 'Example CPU @ 3.00GHz')
})

test('a container reports CPU model "unknown" as no model', async () => {
  const provider = linuxProvider(fakeOs('unknown'), fixtureFiles('container'), noNvidia(), {
    now: () => NOW,
    age: () => 0.1
  })
  await provider.init()
  assert.equal(provider.cpuModel(), null)
  assert.equal(provider.sections().battery, false)
  assert.equal(provider.sections().gpu, false)
})

test('memory comes from meminfo with pressure, and without /proc/pressure it has none', async () => {
  const { provider } = await host()
  const memory = await provider.memory()
  assert.equal(memory?.used, (16303088 - 9208764) * KB)
  assert.equal(memory?.pressure, 'warning')
  const files = fixtureFiles('host', {
    read: async (path) => {
      if (path === '/proc/pressure/memory') throw Object.assign(new Error('no'), { code: 'ENOENT' })
      return fixtureFiles('host').read(path)
    }
  })
  const plain = linuxProvider(fakeOs(), files, noNvidia(), { now: () => NOW, age: () => 2000 })
  assert.equal((await plain.memory())?.pressure, null)
})

test('processes are read from /proc with names, users, kernel threads and start times', async () => {
  const { provider } = await host()
  const list = (await provider.processes()) ?? []
  const byPid = new Map(list.map((row) => [row.pid, row]))
  assert.equal(list.length, 10)
  const node = byPid.get(2400)
  assert.ok(node)
  assert.equal(node.name, 'node')
  assert.equal(node.user, 'user')
  assert.equal(node.uid, 1000)
  assert.equal(node.rss, 210000 * KB)
  assert.equal(node.cpuTime, 48)
  assert.equal(node.start, '8000000')
  assert.equal(node.startedAt, Math.round(NOW - 93784.21 * 1000 + 80000 * 1000))
  assert.equal(byPid.get(2500)?.name, 'weird) (name')
  assert.equal(byPid.get(2600)?.name, 'chromium-browser')
  assert.equal(byPid.get(812)?.comm, '/usr/sbin/sshd')
  assert.equal(byPid.get(2700)?.user, 'postgres')
  assert.equal(byPid.get(45)?.kernel, true)
  assert.equal(byPid.get(45)?.rss, 0)
  assert.equal(byPid.get(2400)?.kernel, undefined)
})

test('a pid that vanishes between listing and reading is skipped silently', async () => {
  const base = fixtureFiles('host')
  const files = fixtureFiles('host', {
    list: async (path) => [
      ...(await base.list(path)),
      ...(path === '/proc' ? ['31337', 'self', 'net'] : [])
    ]
  })
  const provider = linuxProvider(fakeOs(), files, noNvidia(), { now: () => NOW, age: () => 2000 })
  await provider.init()
  const list = (await provider.processes()) ?? []
  assert.equal(list.length, 10)
  assert.ok(!list.some((row) => row.pid === 31337))
  assert.equal(provider.sections().processes, true)
})

test('process files are read with bounded concurrency', async () => {
  let open = 0
  let peak = 0
  const items = Array.from({ length: 500 }, (_, index) => index)
  const out = await mapLimit(items, PROCESS_CONCURRENCY, async (item) => {
    open += 1
    peak = Math.max(peak, open)
    await new Promise((resolve) => setImmediate(resolve))
    open -= 1
    return item * 2
  })
  assert.equal(peak, PROCESS_CONCURRENCY)
  assert.deepEqual(out.slice(0, 3), [0, 2, 4])
  assert.equal(out.length, 500)
})

test('CPU percent comes from tick deltas through the tracker', async () => {
  const tracker = createProcessTracker()
  const { provider } = await host()
  const first = tracker.update((await provider.processes()) ?? [], NOW)
  assert.equal(first.rows.find((row) => row.pid === 2400)?.cpu, 0)
  const later = ((await provider.processes()) ?? []).map((row) =>
    row.pid === 2400 ? { ...row, cpuTime: row.cpuTime + 1 } : row
  )
  const second = tracker.update(later, NOW + 2000)
  assert.equal(second.rows.find((row) => row.pid === 2400)?.cpu, 50)
  assert.equal(second.rows.find((row) => row.pid === 45)?.kernel, true)
})

test('details carry the whole command line and the thread count', async () => {
  const { provider } = await host()
  const detail = await provider.processDetail(2400)
  assert.equal(detail?.command, 'node server.js --port 5173')
  assert.equal(detail?.threads, 11)
  assert.equal((await provider.processDetail(45))?.command, '[kworker/u8:3-events_unbound]')
  assert.equal(await provider.processDetail(31337), null)
})

test('identity for a quit uses the start time from stat, and a gone pid is null', async () => {
  const { provider } = await host()
  assert.deepEqual(await provider.identify(2400), {
    start: '8000000',
    uid: 1000,
    path: '',
    name: 'node'
  })
  assert.deepEqual(await provider.identify(45), {
    start: '40',
    uid: 0,
    path: '',
    name: 'kworker/u8:3-events_unbound',
    kernel: true
  })
  assert.equal(await provider.identify(31337), null)
})

test('a quit on Linux goes through the same guards: start time, kernel threads, the Orca folder', async () => {
  const { provider } = await host()
  const tracker = createProcessTracker()
  const rows = tracker.update((await provider.processes()) ?? [], NOW).rows
  const kills: [number, string][] = []
  const context = {
    uid: 1000,
    selfPid: 4242,
    parentPid: 1500,
    bundle: appBundle('linux', '/opt/Orca/orca')
  }
  assert.equal(context.bundle, '/opt/Orca')
  const deps = {
    ...context,
    listed: () => rows,
    identify: (pid: number) => provider.identify(pid),
    kill: (pid: number, signal: string) => {
      kills.push([pid, signal])
    }
  }
  const ask = (pid: number, startedAt: string) => ({ pid, startedAt, force: false })
  assert.deepEqual(await quitProcess(ask(2400, '8000001'), deps), { ok: false, reason: 'changed' })
  assert.deepEqual(
    await quitProcess(ask(4242, rows.find((r) => r.pid === 4242)?.start ?? ''), deps),
    {
      ok: false,
      reason: 'protected'
    }
  )
  assert.deepEqual(await quitProcess(ask(2400, '8000000'), deps), { ok: true })
  assert.deepEqual(kills, [[2400, 'SIGTERM']])
  const offer = createOfferer(context, rows)
  const row = (pid: number) => rows.find((entry) => entry.pid === pid)
  assert.equal(offer(row(2400)!), 'allowed')
  assert.equal(offer(row(812)!), 'not_owner')
  assert.equal(offer(row(1500)!), 'orca')
  const rootContext = { ...context, uid: 0 }
  const rootOffer = createOfferer(rootContext, rows)
  assert.equal(rootOffer(row(45)!), 'system')
  assert.equal(rootOffer(row(812)!), 'system')
  const rootDeps = { ...deps, uid: 0 }
  assert.deepEqual(await quitProcess(ask(45, '40'), rootDeps), { ok: false, reason: 'protected' })
  assert.deepEqual(kills, [[2400, 'SIGTERM']])
})

test('network, the default route and disk I/O from /proc, without loop, dm, ram or partitions', async () => {
  const { provider } = await host()
  const network = (await provider.network()) ?? []
  assert.equal(network.length, 9)
  assert.equal(await provider.defaultInterface(), 'wlp2s0')
  const drives = (await provider.disk()) ?? []
  assert.deepEqual(
    drives.map((drive) => drive.id),
    ['nvme0n1', 'sda', 'sr0']
  )
  const container = await host({ tree: 'container', age: 0.1 })
  assert.deepEqual(
    ((await container.provider.disk()) ?? []).map((drive) => drive.id),
    ['vda', 'vdb']
  )
})

test('volumes: the root first, then each real device once', async () => {
  const { provider } = await host()
  const volumes = (await provider.volumes()) ?? []
  assert.deepEqual(
    volumes.map((volume) => [volume.name, volume.startup]),
    [
      ['/', true],
      ['/boot/efi', false],
      ['/home', false],
      ['/mnt/usb', false]
    ]
  )
})

test('an AMD GPU is read from sysfs when there is no nvidia-smi, which was tried at both paths once', async () => {
  const calls: number[] = []
  const { provider } = await host({ commands: noNvidia(calls) })
  assert.deepEqual(calls, [0, 1])
  assert.deepEqual(await provider.gpu(), {
    model: 'Example Radeon',
    utilization: 37,
    renderer: null,
    inUse: 805306368,
    allocated: 4294967296,
    dedicated: true
  })
  await provider.gpu()
  assert.deepEqual(calls, [0, 1])
  assert.deepEqual(NVIDIA_PATHS, ['/usr/bin/nvidia-smi', '/usr/local/bin/nvidia-smi'])
  assert.equal(NVIDIA_ARGS[1], '--format=csv,noheader,nounits')
})

test('an NVIDIA GPU found at the second path is the one used from then on', async () => {
  const calls: number[] = []
  const commands: LinuxCommands = {
    async nvidiaSmi(index) {
      calls.push(index)
      if (index === 0) throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
      return '41, 2048, 8192, NVIDIA Example\n'
    },
    dispose() {}
  }
  const { provider } = await host({ commands })
  assert.equal((await provider.gpu())?.model, 'NVIDIA Example')
  assert.deepEqual(calls, [0, 1, 1])
})

test('the battery is BAT0 with its power draw; peripherals and the adapter are not batteries', async () => {
  const { provider } = await host()
  assert.deepEqual(await provider.battery(), {
    percent: 64,
    onBattery: true,
    state: 'discharging',
    minutesLeft: 194,
    watts: 11.24
  })
  assert.equal(await provider.energy(), null)
  assert.equal(await provider.assertions(), null)
})

test('a failing /proc file turns its section off after repeated failures', async () => {
  const broken = fixtureFiles('host', {
    read: async (path) => {
      if (path === '/proc/net/dev' || path === '/proc/meminfo') throw new Error('EIO')
      return fixtureFiles('host').read(path)
    }
  })
  const provider = linuxProvider(fakeOs(), broken, noNvidia(), { now: () => NOW, age: () => 2000 })
  await provider.init()
  for (let i = 0; i < FAILURE_LIMIT; i++) {
    assert.equal(await provider.network(), null)
    assert.equal(await provider.memory(), null)
  }
  assert.equal(provider.sections().network, false)
  assert.equal(provider.sections().memory, false)
  assert.equal(provider.sections().processes, true)
})
