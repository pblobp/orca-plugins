import assert from 'node:assert/strict'
import os from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
import { realClock } from '../../plugins/os-vitals/src/clock.ts'
import { cpuUsage } from '../../plugins/os-vitals/src/cpu.ts'
import { createProvider } from '../../plugins/os-vitals/src/platform/index.ts'
import type { Sample } from '../../plugins/os-vitals/src/protocol.ts'
import { createSampler } from '../../plugins/os-vitals/src/sampler.ts'

const platform = process.platform
const provider = createProvider(platform)
const coreCount = os.cpus().length

function inRange(value: number, label: string): void {
  assert.ok(
    Number.isFinite(value) && value >= 0 && value <= 100,
    `${label} is ${value}, not 0 to 100`
  )
}

function checkSample(sample: Sample, withCores: boolean): void {
  inRange(sample.total, 'total CPU')
  inRange(sample.user, 'user CPU')
  inRange(sample.system, 'system CPU')
  assert.ok(
    Math.abs(sample.user + sample.system - sample.total) <= 0.2,
    'user + system is not the total'
  )
  if (withCores) {
    assert.ok(sample.cores, 'an active sample has per-core usage')
    assert.equal(sample.cores.length, coreCount)
    sample.cores.forEach((core, index) => inRange(core, `core ${index + 1}`))
  }
}

assert.equal(provider.platform, platform)
assert.ok(coreCount > 0, 'os.cpus() lists no cores')
assert.equal(provider.cores().length, coreCount)
assert.equal(provider.sections().cpu, true)
const model = provider.cpuModel()
assert.ok(model === null || model.length > 0)
assert.ok(provider.uptime() > 0, 'uptime is not positive')
assert.ok(provider.totalMemory() > 0, 'total memory is not positive')

const load = provider.load()
if (platform === 'win32') {
  assert.equal(load, null, 'Windows reports no load average')
} else {
  assert.ok(load, 'no load average')
  load.forEach((value) => assert.ok(Number.isFinite(value) && value >= 0, `load ${value}`))
}

const first = provider.cpuTimes()
await sleep(1000)
const second = provider.cpuTimes()
assert.equal(first.length, coreCount)
const usage = cpuUsage(first, second)
assert.ok(usage, 'two readings one second apart gave no usage')
checkSample({ seq: 0, t: Date.now(), ...usage }, true)

const samples: Sample[] = []
const errors: unknown[] = []
const sampler = createSampler(
  {
    clock: realClock,
    provider,
    onSample: (sample) => samples.push(sample),
    onError: (error) => errors.push(error)
  },
  { activeIntervalMs: 500, backgroundEnabled: false, historyMs: 60000 }
)
await sleep(400)
sampler.notePoll()
await sleep(1300)
sampler.stop()
assert.deepEqual(errors, [])
assert.ok(samples.length >= 2, `the sampler took ${samples.length} sample(s) in 1.7 s`)
samples.forEach((sample) => checkSample(sample, true))
assert.deepEqual(
  sampler.since(0).map((sample) => sample.seq),
  samples.map((sample) => sample.seq)
)

const latest = samples[samples.length - 1]
const loadText = load ? load.map((value) => value.toFixed(2)).join(' ') : 'none'
console.log(
  `smoke: ${platform}, ${coreCount} cores (${model ?? 'unknown model'}), ` +
    `CPU ${latest.total}% (user ${latest.user}%, system ${latest.system}%), load ${loadText}, ` +
    `${samples.length} samples, ok`
)
