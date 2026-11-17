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
const notes: string[] = []

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

await provider.init()
assert.equal(provider.platform, platform)
assert.ok(coreCount > 0, 'os.cpus() lists no cores')
const cores = provider.cores()
assert.equal(cores.length, coreCount)
const kinds = cores.filter((core) => core.kind !== null).length
assert.ok(kinds === 0 || kinds === coreCount, 'either every core has a kind or none does')
if (kinds > 0) {
  const performance = cores.filter((core) => core.kind === 'performance').length
  notes.push(`${performance} performance and ${coreCount - performance} efficiency cores`)
}
const sections = provider.sections()
assert.equal(sections.cpu, true)
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

if (sections.memory) {
  const memory = await provider.memory()
  assert.ok(memory, 'memory is supported but gave no reading')
  assert.ok(memory.total > 0, 'total memory is not positive')
  const share = (100 * memory.used) / memory.total
  assert.ok(share >= 1 && share <= 100, `memory used is ${share.toFixed(1)}% of the total`)
  assert.ok(memory.free >= 0 && memory.free <= memory.total, 'free memory is out of range')
  notes.push(`memory ${share.toFixed(1)}% used, pressure ${memory.pressure ?? 'not reported'}`)
} else {
  notes.push('memory not supported here yet')
}

if (sections.processes) {
  const list = await provider.processes()
  assert.ok(list && list.length > 0, 'the process list is empty')
  const self = list.find((entry) => entry.pid === process.pid)
  assert.ok(self, `the process list does not contain this smoke test (pid ${process.pid})`)
  assert.ok(self.rss > 0, 'this process uses no memory')
  const detail = await provider.processDetail(process.pid)
  assert.ok(detail, 'no details for this smoke test')
  assert.ok(detail.command.includes('smoke'), `unexpected command line: ${detail.command}`)
  assert.ok(detail.threads === null || detail.threads > 0)
  notes.push(`${list.length} processes, own details with ${detail.threads ?? '?'} threads`)
} else {
  notes.push('processes not supported here yet')
}

const first = provider.cpuTimes()
await sleep(1000)
const second = provider.cpuTimes()
assert.equal(first.length, coreCount)
const usage = cpuUsage(first, second)
assert.ok(usage, 'two readings one second apart gave no usage')
checkSample({ seq: 0, t: Date.now(), memory: null, ...usage }, true)

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
await sampler.notePoll({ view: 'processes', processes: sections.processes })
await sleep(1300)
await sampler.idle()
sampler.stop()
provider.dispose()
assert.deepEqual(errors, [])
assert.ok(samples.length >= 2, `the sampler took ${samples.length} sample(s) in 1.7 s`)
samples.forEach((sample) => checkSample(sample, true))
if (sections.memory) assert.ok(samples.every((sample) => sample.memory !== null))
if (sections.processes) assert.ok((sampler.processes()?.rows.length ?? 0) > 0)
assert.deepEqual(
  sampler.since(0).map((sample) => sample.seq),
  samples.map((sample) => sample.seq)
)

const latest = samples[samples.length - 1]
const loadText = load ? load.map((value) => value.toFixed(2)).join(' ') : 'none'
console.log(
  `smoke: ${platform}, ${coreCount} cores (${model ?? 'unknown model'}), ` +
    `CPU ${latest.total}% (user ${latest.user}%, system ${latest.system}%), load ${loadText}, ` +
    `${samples.length} samples; ${notes.join('; ')}; ok`
)
