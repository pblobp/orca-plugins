import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RawProcess } from '../../plugins/os-vitals/src/parse/ps.ts'
import type { MemoryReading, Sample } from '../../plugins/os-vitals/src/protocol.ts'
import {
  BACKGROUND_INTERVAL_MS,
  createSampler,
  historyCapacity,
  type SamplerConfig
} from '../../plugins/os-vitals/src/sampler.ts'
import { fakeClock, fakeCpus } from './helpers.ts'

const config = (overrides: Partial<SamplerConfig> = {}): SamplerConfig => ({
  activeIntervalMs: 2000,
  backgroundEnabled: true,
  historyMs: 5 * 60 * 1000,
  ...overrides
})

const MEMORY: MemoryReading = {
  total: 8 * 1024 ** 3,
  used: 4 * 1024 ** 3,
  app: 3 * 1024 ** 3,
  wired: 512 * 1024 ** 2,
  compressed: 512 * 1024 ** 2,
  buffers: null,
  cached: 2 * 1024 ** 3,
  free: 2 * 1024 ** 3,
  swapUsed: 0,
  swapTotal: 0,
  pressure: 'normal'
}

const PROCESSES: RawProcess[] = [
  {
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
]

const OVERVIEW = { view: 'overview' as const, processes: true }
const PROCESS_VIEW = { view: 'processes' as const, processes: true }

function start(overrides: Partial<SamplerConfig> = {}) {
  const time = fakeClock()
  const cpus = fakeCpus(2)
  const samples: Sample[] = []
  const errors: unknown[] = []
  const sampler = createSampler(
    {
      clock: time.clock,
      provider: cpus.provider,
      onSample: (sample) => samples.push(sample),
      onError: (error) => errors.push(error)
    },
    config(overrides)
  )
  return { time, cpus, samples, errors, sampler }
}

test('the background tier samples total CPU every 5 s, without per-core history', async () => {
  const { time, samples, sampler } = start()
  assert.equal(sampler.scheduled(), 'background')
  assert.equal(time.nextDelay(), BACKGROUND_INTERVAL_MS)
  await time.advance(BACKGROUND_INTERVAL_MS)
  assert.deepEqual(samples, [
    {
      seq: 1,
      t: time.now(),
      total: 30,
      user: 25,
      system: 5,
      cores: null,
      memory: null,
      net: null,
      disk: null,
      gpu: null
    }
  ])
  await time.advance(BACKGROUND_INTERVAL_MS * 2)
  assert.deepEqual(
    samples.map((sample) => sample.seq),
    [1, 2, 3]
  )
})

test('memory is read in the background tier and the active tier', async () => {
  const { time, cpus, samples, sampler } = start()
  cpus.setMemory(MEMORY)
  await time.advance(BACKGROUND_INTERVAL_MS)
  assert.deepEqual(samples[0].memory, MEMORY)
  await sampler.notePoll()
  await time.advance(2000)
  assert.deepEqual(samples[samples.length - 1].memory, MEMORY)
  assert.ok(samples[samples.length - 1].cores)
  assert.deepEqual(sampler.memory(), MEMORY)
  assert.equal(cpus.memoryReads(), 3)
})

test('a poll samples at once and switches to the active interval with per-core history', async () => {
  const { time, samples, sampler } = start()
  await time.advance(3000)
  await sampler.notePoll()
  assert.equal(samples.length, 1)
  assert.deepEqual(samples[0].cores, [30, 30])
  assert.equal(sampler.scheduled(), 'active')
  assert.equal(time.nextDelay(), 2000)
  await time.advance(2000)
  assert.equal(samples.length, 2)
  assert.deepEqual(samples[1].cores, [30, 30])
})

test('polls during the active tier do not sample out of turn', async () => {
  const { time, cpus, sampler } = start()
  await sampler.notePoll()
  const reads = cpus.reads()
  await time.advance(500)
  await sampler.notePoll()
  await time.advance(500)
  await sampler.notePoll()
  assert.equal(cpus.reads(), reads)
  assert.equal(time.nextDelay(), 1000)
})

test('the active tier ends three intervals after the last poll', async () => {
  const { time, samples, sampler } = start()
  await time.advance(1000)
  await sampler.notePoll()
  await time.advance(6000)
  assert.equal(sampler.scheduled(), 'active')
  await time.advance(2000)
  assert.equal(sampler.scheduled(), 'background')
  assert.equal(samples.filter((sample) => sample.cores).length, 4)
  assert.equal(samples[samples.length - 1].cores, null)
})

test('with background sampling off, nothing runs until a poll, and it stops again after', async () => {
  const { time, cpus, samples, sampler } = start({ backgroundEnabled: false })
  assert.equal(sampler.scheduled(), null)
  assert.equal(time.pending(), 0)
  await time.advance(60000)
  assert.equal(samples.length, 0)
  const reads = cpus.reads()
  await sampler.notePoll()
  assert.equal(cpus.reads(), reads + 1)
  assert.equal(samples.length, 0)
  await time.advance(2000)
  assert.equal(samples.length, 1)
  await time.advance(6000)
  assert.equal(sampler.scheduled(), null)
  assert.equal(time.pending(), 0)
})

test('a baseline older than 15 s is replaced instead of averaging over the gap', async () => {
  const { time, samples, sampler } = start({ backgroundEnabled: false })
  await time.advance(20000)
  await sampler.notePoll()
  assert.equal(samples.length, 0)
  await time.advance(2000)
  assert.equal(samples.length, 1)
  assert.equal(samples[0].t, time.now())
})

test('processes are never read without a poll that asks for them', async () => {
  const { time, cpus, sampler } = start()
  cpus.setProcesses(PROCESSES)
  await time.advance(BACKGROUND_INTERVAL_MS * 4)
  await sampler.notePoll({ view: 'overview', processes: false })
  await time.advance(6000)
  assert.equal(cpus.processReads(), 0)
  assert.equal(sampler.processes(), null)
})

test('the first poll that asks for processes reads them at once', async () => {
  const { time, cpus, sampler } = start()
  cpus.setProcesses(PROCESSES)
  await time.advance(BACKGROUND_INTERVAL_MS)
  await sampler.notePoll(OVERVIEW)
  assert.equal(cpus.processReads(), 1)
  assert.equal(sampler.processes()?.rows[0].name, 'launchd')
  assert.equal(sampler.processes()?.t, time.now())
})

test('the Overview reads processes every second tick, the Processes view every tick', async () => {
  const { time, cpus, sampler } = start()
  cpus.setProcesses(PROCESSES)
  await sampler.notePoll(OVERVIEW)
  const first = cpus.processReads()
  for (let tick = 0; tick < 4; tick++) {
    await time.advance(2000)
    await sampler.notePoll(OVERVIEW)
  }
  assert.equal(cpus.processReads() - first, 2)
  const second = cpus.processReads()
  for (let tick = 0; tick < 3; tick++) {
    await time.advance(2000)
    await sampler.notePoll(PROCESS_VIEW)
  }
  assert.equal(cpus.processReads() - second, 3)
})

test('processes stop with the polls, and the background tier never reads them', async () => {
  const { time, cpus, sampler } = start()
  cpus.setProcesses(PROCESSES)
  await sampler.notePoll(PROCESS_VIEW)
  await time.advance(6000)
  const reads = cpus.processReads()
  await time.advance(BACKGROUND_INTERVAL_MS * 6)
  assert.equal(sampler.scheduled(), 'background')
  assert.equal(cpus.processReads(), reads)
})

test('a stale process list is read again when the panel comes back', async () => {
  const { time, cpus, sampler } = start()
  cpus.setProcesses(PROCESSES)
  await sampler.notePoll(OVERVIEW)
  await time.advance(60000)
  const reads = cpus.processReads()
  await sampler.notePoll(OVERVIEW)
  assert.equal(cpus.processReads(), reads + 1)
  assert.equal(sampler.processes()?.t, time.now())
})

test('since() answers newer samples inside the history window', async () => {
  const { time, sampler } = start({ historyMs: 12000 })
  await time.advance(BACKGROUND_INTERVAL_MS * 4)
  assert.deepEqual(
    sampler.since(0).map((sample) => sample.seq),
    [2, 3, 4]
  )
  assert.deepEqual(
    sampler.since(3).map((sample) => sample.seq),
    [4]
  )
  assert.equal(sampler.latest()?.seq, 4)
  assert.equal(sampler.seq(), 4)
})

test('history capacity covers the window at the shortest interval', () => {
  assert.equal(historyCapacity(config({ activeIntervalMs: 1000, historyMs: 15 * 60000 })), 901)
  assert.equal(historyCapacity(config({ activeIntervalMs: 5000, historyMs: 60000 })), 13)
})

test('configure applies a new interval and history length', async () => {
  const { time, sampler } = start()
  await sampler.notePoll()
  sampler.configure(config({ activeIntervalMs: 5000 }))
  assert.equal(sampler.scheduled(), 'active')
  assert.equal(time.nextDelay(), 5000)
  sampler.configure(config({ activeIntervalMs: 5000, backgroundEnabled: false }))
  await time.advance(15000)
  assert.equal(sampler.scheduled(), 'active')
  await time.advance(5000)
  assert.equal(sampler.scheduled(), null)
})

test('a failing reader is reported and the schedule carries on', async () => {
  const { time, cpus, samples, errors, sampler } = start()
  cpus.fail(new Error('no cpu'))
  await time.advance(BACKGROUND_INTERVAL_MS)
  assert.equal(errors.length, 1)
  assert.equal(samples.length, 0)
  assert.equal(sampler.scheduled(), 'background')
  cpus.fail(null)
  await time.advance(BACKGROUND_INTERVAL_MS)
  assert.equal(samples.length, 1)
  assert.equal(samples[0].t, time.now())
})

test('stop clears the timer and later polls do nothing', async () => {
  const { time, cpus, sampler } = start()
  sampler.stop()
  assert.equal(time.pending(), 0)
  const reads = cpus.reads()
  await sampler.notePoll(PROCESS_VIEW)
  await time.advance(60000)
  assert.equal(cpus.reads(), reads)
  assert.equal(cpus.processReads(), 0)
})
