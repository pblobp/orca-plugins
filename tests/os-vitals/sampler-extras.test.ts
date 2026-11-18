import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RawProcess } from '../../plugins/os-vitals/src/parse/ps.ts'
import type { Sample, ViewName } from '../../plugins/os-vitals/src/protocol.ts'
import {
  createSampler,
  ENERGY_INTERVAL_MS,
  energyReading,
  SLOW_INTERVAL_MS,
  type SamplerConfig
} from '../../plugins/os-vitals/src/sampler.ts'
import { EXTRA_STEP, FAKE_BATTERY, FAKE_VOLUMES, fakeClock, fakeCpus } from './helpers.ts'

const config = (overrides: Partial<SamplerConfig> = {}): SamplerConfig => ({
  activeIntervalMs: 2000,
  backgroundEnabled: true,
  historyMs: 5 * 60 * 1000,
  ...overrides
})

const LAUNCHD: RawProcess = {
  pid: 1,
  ppid: 0,
  uid: 0,
  pcpu: 0,
  rss: 1024,
  cpuTime: 1,
  startedAt: 1,
  start: 'Sat Nov 14 20:37:20 2026',
  user: 'root',
  comm: '/sbin/launchd'
}

const view = (name: ViewName) => ({ view: name, processes: false })

function start(overrides: Partial<SamplerConfig> = {}) {
  const time = fakeClock()
  const cpus = fakeCpus(2)
  cpus.setExtras(true)
  cpus.setProcesses([LAUNCHD])
  const samples: Sample[] = []
  const sampler = createSampler(
    { clock: time.clock, provider: cpus.provider, onSample: (sample) => samples.push(sample) },
    config(overrides)
  )
  return { time, cpus, samples, sampler }
}

async function keepPolling(
  sampler: ReturnType<typeof start>['sampler'],
  time: ReturnType<typeof start>['time'],
  name: ViewName,
  ms: number
) {
  const end = time.now() + ms
  while (time.now() < end) {
    await sampler.notePoll(view(name))
    await time.advance(2000)
  }
}

test('the background tier reads no network, disk or GPU, so their history starts empty', async () => {
  const { time, cpus, samples, sampler } = start()
  await time.advance(30_000)
  assert.ok(samples.length >= 5)
  assert.equal(cpus.calls('network'), 0)
  assert.equal(cpus.calls('disk'), 0)
  assert.equal(cpus.calls('gpu'), 0)
  assert.equal(cpus.calls('battery'), 0)
  assert.ok(samples.every((sample) => !sample.net && !sample.disk && sample.gpu === null))
  sampler.stop()
})

test('the active tier adds network and disk rates and GPU use to each sample', async () => {
  const { time, samples, sampler } = start()
  await keepPolling(sampler, time, 'overview', 10_000)
  const withRates = samples.filter((sample) => sample.net)
  assert.ok(withRates.length >= 3)
  const last = withRates[withRates.length - 1]
  assert.deepEqual(last.net, { down: EXTRA_STEP.rx / 2, up: EXTRA_STEP.tx / 2 })
  assert.deepEqual(last.disk, { read: EXTRA_STEP.read / 2, write: EXTRA_STEP.write / 2 })
  assert.equal(last.gpu, 25)
  const network = sampler.network()
  assert.ok(network)
  assert.equal(network.defaultInterface, 'en0')
  assert.equal(network.packetsIn, 50)
  assert.deepEqual(sampler.gpu()?.model, 'Test GPU')
  assert.equal(sampler.disk()?.reads, 5)
  sampler.stop()
})

test('the first active reading sets a baseline and gives no rate', async () => {
  const { time, samples, sampler } = start()
  await time.advance(21_000)
  const before = samples.length
  await sampler.notePoll(view('overview'))
  const fresh = samples.slice(before)
  assert.equal(fresh.length, 1)
  assert.equal(fresh[0].net, null)
  assert.equal(fresh[0].disk, null)
  assert.equal(fresh[0].gpu, 25)
  sampler.stop()
})

test('the slow tier reads volumes, battery and the default route every 30 s while active', async () => {
  const { time, cpus, sampler } = start()
  await sampler.notePoll(view('overview'))
  assert.equal(cpus.calls('volumes'), 1)
  assert.equal(cpus.calls('battery'), 1)
  assert.equal(cpus.calls('defaultInterface'), 1)
  assert.deepEqual(sampler.volumes(), FAKE_VOLUMES)
  assert.deepEqual(sampler.battery(), FAKE_BATTERY)
  await keepPolling(sampler, time, 'overview', SLOW_INTERVAL_MS - 2000)
  assert.equal(cpus.calls('battery'), 1)
  await keepPolling(sampler, time, 'overview', 4000)
  assert.equal(cpus.calls('battery'), 2)
  assert.equal(cpus.calls('volumes'), 2)
  sampler.stop()
})

test('readings older than 15 s are not answered as current', async () => {
  const { time, sampler } = start({ backgroundEnabled: false })
  await keepPolling(sampler, time, 'overview', 6000)
  assert.ok(sampler.network())
  await time.advance(20_000)
  assert.equal(sampler.network(), null)
  assert.equal(sampler.disk(), null)
  assert.equal(sampler.gpu(), null)
  assert.deepEqual(sampler.battery(), FAKE_BATTERY)
  sampler.stop()
})

test('energy is read only while the Energy view is open, every 5 s', async () => {
  const { time, cpus, sampler } = start()
  await keepPolling(sampler, time, 'overview', 20_000)
  await keepPolling(sampler, time, 'network', 10_000)
  assert.equal(cpus.calls('energy'), 0)
  assert.equal(cpus.calls('assertions'), 0)
  assert.equal(sampler.energy(), null)

  await sampler.notePoll(view('energy'))
  await sampler.idle()
  assert.equal(cpus.calls('energy'), 1)
  assert.equal(cpus.calls('assertions'), 1)
  const reading = sampler.energy()
  assert.ok(reading)
  assert.deepEqual(reading.impact, [
    { pid: 77, name: 'PID 77', impact: 9 },
    { pid: 1, name: 'launchd', impact: 4.5 }
  ])
  assert.deepEqual(reading.blockers, [{ pid: 1, name: 'launchd', kinds: ['system'] }])

  await keepPolling(sampler, time, 'energy', 4 * ENERGY_INTERVAL_MS)
  const during = cpus.calls('energy')
  assert.ok(during >= 4 && during <= 6, `read ${during} times in 20 s`)
  sampler.stop()
})

test('energy reading stops when the Energy view closes, and its reading is dropped', async () => {
  const { time, cpus, sampler } = start()
  await keepPolling(sampler, time, 'energy', 12_000)
  assert.ok(sampler.energy())
  const before = cpus.calls('energy')
  await sampler.notePoll(view('overview'))
  assert.equal(sampler.energy(), null)
  await keepPolling(sampler, time, 'overview', 30_000)
  assert.equal(cpus.calls('energy'), before)
  assert.equal(cpus.calls('assertions'), before)
  sampler.stop()
})

test('energy reading stops when the polls stop', async () => {
  const { time, cpus, sampler } = start()
  await keepPolling(sampler, time, 'energy', 8000)
  const before = cpus.calls('energy')
  await time.advance(60_000)
  assert.ok(cpus.calls('energy') <= before + 1)
  const settled = cpus.calls('energy')
  await time.advance(60_000)
  assert.equal(cpus.calls('energy'), settled)
  assert.equal(sampler.energy(), null)
  sampler.stop()
})

test('energy is not read on a system that cannot report it', async () => {
  const { time, cpus, sampler } = start()
  cpus.setExtras(false)
  await keepPolling(sampler, time, 'energy', 20_000)
  assert.equal(cpus.calls('energy'), 0)
  assert.equal(sampler.energy(), null)
  sampler.stop()
})

test('energy rows name processes from the list and keep the ten highest', () => {
  const samples = Array.from({ length: 14 }, (_, index) => ({ pid: index + 1, impact: index }))
  const rows = [{ pid: 14, name: 'busy' }].map((row) => ({
    ...row,
    ppid: 1,
    uid: 501,
    user: 'user',
    path: '/opt/busy',
    cpu: 0,
    memory: 0,
    cpuTime: 0,
    startedAt: 0,
    start: 'Sat Nov 14 20:37:20 2026'
  }))
  const reading = energyReading(5, samples, null, rows)
  assert.equal(reading.impact.length, 10)
  assert.deepEqual(reading.impact[0], { pid: 14, name: 'busy', impact: 13 })
  assert.deepEqual(reading.impact[9], { pid: 5, name: 'PID 5', impact: 4 })
  assert.equal(reading.blockers, null)
})

test('an energy reading that outlasts the poll window is kept, and not read again', async () => {
  const time = fakeClock()
  const cpus = fakeCpus(2)
  cpus.setExtras(true)
  cpus.setProcesses([LAUNCHD])
  let finish: () => void = () => {}
  let calls = 0
  const provider = {
    ...cpus.provider,
    energy: () => {
      calls += 1
      return new Promise<{ pid: number; impact: number }[]>((resolve) => {
        finish = () => resolve([{ pid: 1, impact: 3 }])
      })
    }
  }
  const sampler = createSampler({ clock: time.clock, provider }, config({ activeIntervalMs: 500 }))
  await sampler.notePoll(view('energy'))
  await time.advance(1800)
  finish()
  await sampler.idle()
  assert.deepEqual(sampler.energy()?.impact, [{ pid: 1, name: 'launchd', impact: 3 }])
  await time.advance(ENERGY_INTERVAL_MS * 4)
  assert.equal(calls, 1)
  assert.equal(sampler.energy(), null)
  sampler.stop()
})

test("the worker's own helper programs, such as top itself, are left out of energy impact", () => {
  const row = (pid: number, ppid: number, name: string) => ({
    pid,
    ppid,
    uid: 501,
    user: 'user',
    name,
    path: `/usr/bin/${name}`,
    cpu: 0,
    memory: 0,
    cpuTime: 0,
    startedAt: 0,
    start: 'Sat Nov 14 20:37:20 2026'
  })
  const rows = [row(900, 1, 'worker'), row(901, 900, 'top'), row(950, 1, 'busy')]
  const samples = [
    { pid: 901, impact: 6.7 },
    { pid: 950, impact: 3 },
    { pid: 900, impact: 1 }
  ]
  assert.deepEqual(
    energyReading(1, samples, null, rows, 900).impact.map((entry) => entry.name),
    ['busy', 'worker']
  )
  assert.deepEqual(
    energyReading(1, samples, null, rows).impact.map((entry) => entry.name),
    ['top', 'busy', 'worker']
  )
})

test('a battery read that fails once keeps the last reading, and a battery that goes away clears it', async () => {
  const { time, cpus, sampler } = start()
  let failing = false
  const battery = cpus.provider.battery
  cpus.provider.battery = async () => (failing ? null : battery())
  await sampler.notePoll(view('overview'))
  assert.deepEqual(sampler.battery(), FAKE_BATTERY)
  failing = true
  await keepPolling(sampler, time, 'overview', SLOW_INTERVAL_MS + 2000)
  assert.deepEqual(sampler.battery(), FAKE_BATTERY)
  cpus.setExtras(false)
  await keepPolling(sampler, time, 'overview', SLOW_INTERVAL_MS + 2000)
  assert.equal(sampler.battery(), null)
  sampler.stop()
})
