import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseTopEnergy } from '../../plugins/os-vitals/src/parse/top.ts'
import { fixture } from './helpers.ts'

test('only the second sample is read, because the first reports zero for every process', () => {
  const samples = parseTopEnergy(fixture('darwin/top.txt'))
  assert.ok(samples)
  assert.equal(samples.length, 11)
  assert.deepEqual(samples[0], { pid: 1650, impact: 11 })
  assert.deepEqual(samples[1], { pid: 27260, impact: 10.1 })
  assert.ok(!samples.some((sample) => sample.pid === 94888))
  assert.ok(samples.every((sample) => sample.impact > 0))
})

test('idle wakeups marked with a plus do not break a row', () => {
  const samples = parseTopEnergy(fixture('darwin/top.txt')) ?? []
  assert.deepEqual(
    samples.find((sample) => sample.pid === 397),
    { pid: 397, impact: 9.9 }
  )
})

test('one sample alone is not trusted', () => {
  const first = fixture('darwin/top.txt').split('Processes:').slice(0, 2).join('Processes:')
  assert.equal(parseTopEnergy(first), null)
  assert.equal(parseTopEnergy(''), null)
})

test('top with only pid and power columns', () => {
  const text = 'PID POWER\n1 0.0\n\nPID POWER\n10 3.5\n20 0.0\n'
  assert.deepEqual(parseTopEnergy(text), [
    { pid: 10, impact: 3.5 },
    { pid: 20, impact: 0 }
  ])
})
