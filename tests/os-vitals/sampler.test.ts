import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Sample } from '../../plugins/os-vitals/src/protocol.ts'
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

test('the background tier samples total CPU every 5 s, without per-core history', () => {
  const { time, samples, sampler } = start()
  assert.equal(sampler.scheduled(), 'background')
  assert.equal(time.nextDelay(), BACKGROUND_INTERVAL_MS)
  time.advance(BACKGROUND_INTERVAL_MS)
  assert.equal(samples.length, 1)
  assert.deepEqual(samples[0], {
    seq: 1,
    t: time.now(),
    total: 30,
    user: 25,
    system: 5,
    cores: null
  })
  time.advance(BACKGROUND_INTERVAL_MS * 2)
  assert.deepEqual(
    samples.map((sample) => sample.seq),
    [1, 2, 3]
  )
})

test('a poll samples at once and switches to the active interval with per-core history', () => {
  const { time, samples, sampler } = start()
  time.advance(3000)
  sampler.notePoll()
  assert.equal(samples.length, 1)
  assert.deepEqual(samples[0].cores, [30, 30])
  assert.equal(sampler.scheduled(), 'active')
  assert.equal(time.nextDelay(), 2000)
  time.advance(2000)
  assert.equal(samples.length, 2)
  assert.deepEqual(samples[1].cores, [30, 30])
})

test('polls during the active tier do not sample out of turn', () => {
  const { time, cpus, sampler } = start()
  sampler.notePoll()
  const reads = cpus.reads()
  time.advance(500)
  sampler.notePoll()
  time.advance(500)
  sampler.notePoll()
  assert.equal(cpus.reads(), reads)
  assert.equal(time.nextDelay(), 1000)
})

test('the active tier ends three intervals after the last poll', () => {
  const { time, samples, sampler } = start()
  time.advance(1000)
  sampler.notePoll()
  time.advance(6000)
  assert.equal(sampler.scheduled(), 'active')
  time.advance(2000)
  assert.equal(sampler.scheduled(), 'background')
  const activeSamples = samples.filter((sample) => sample.cores)
  assert.equal(activeSamples.length, 4)
  assert.equal(samples[samples.length - 1].cores, null)
})

test('with background sampling off, nothing runs until a poll, and it stops again after', () => {
  const { time, cpus, samples, sampler } = start({ backgroundEnabled: false })
  assert.equal(sampler.scheduled(), null)
  assert.equal(time.pending(), 0)
  time.advance(60000)
  assert.equal(samples.length, 0)
  const reads = cpus.reads()
  sampler.notePoll()
  assert.equal(cpus.reads(), reads + 1)
  assert.equal(samples.length, 0)
  time.advance(2000)
  assert.equal(samples.length, 1)
  time.advance(6000)
  assert.equal(sampler.scheduled(), null)
  assert.equal(time.pending(), 0)
})

test('a baseline older than 15 s is replaced instead of averaging over the gap', () => {
  const { time, samples, sampler } = start({ backgroundEnabled: false })
  time.advance(20000)
  sampler.notePoll()
  assert.equal(samples.length, 0)
  time.advance(2000)
  assert.equal(samples.length, 1)
  assert.equal(samples[0].t, time.now())
})

test('since() answers newer samples inside the history window', () => {
  const { time, sampler } = start({ historyMs: 12000 })
  time.advance(BACKGROUND_INTERVAL_MS * 4)
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

test('configure applies a new interval and history length', () => {
  const { time, sampler } = start()
  sampler.notePoll()
  sampler.configure(config({ activeIntervalMs: 5000 }))
  assert.equal(sampler.scheduled(), 'active')
  assert.equal(time.nextDelay(), 5000)
  sampler.configure(config({ activeIntervalMs: 5000, backgroundEnabled: false }))
  time.advance(15000)
  assert.equal(sampler.scheduled(), 'active')
  time.advance(5000)
  assert.equal(sampler.scheduled(), null)
})

test('a failing reader is reported and the schedule carries on', () => {
  const { time, cpus, samples, errors, sampler } = start()
  cpus.fail(new Error('no cpu'))
  time.advance(BACKGROUND_INTERVAL_MS)
  assert.equal(errors.length, 1)
  assert.equal(samples.length, 0)
  assert.equal(sampler.scheduled(), 'background')
  cpus.fail(null)
  time.advance(BACKGROUND_INTERVAL_MS)
  assert.equal(samples.length, 1)
  assert.equal(samples[0].t, time.now())
})

test('stop clears the timer and later polls do nothing', () => {
  const { time, cpus, sampler } = start()
  sampler.stop()
  assert.equal(time.pending(), 0)
  const reads = cpus.reads()
  sampler.notePoll()
  time.advance(60000)
  assert.equal(cpus.reads(), reads)
})
