import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cpuUsage, round1, type CpuTimes } from '../../plugins/os-vitals/src/cpu.ts'

const times = (user: number, nice: number, sys: number, idle: number, irq: number): CpuTimes => ({
  user,
  nice,
  sys,
  idle,
  irq
})

test('usage is the busy share of the time that passed, per core and in total', () => {
  const before = [times(100, 0, 100, 1000, 0), times(100, 0, 100, 1000, 0)]
  const after = [times(400, 0, 200, 1600, 0), times(150, 0, 150, 1900, 0)]
  assert.deepEqual(cpuUsage(before, after), {
    total: 25,
    user: 17.5,
    system: 7.5,
    cores: [40, 10]
  })
})

test('nice time counts as user time and interrupt time as system time', () => {
  const before = [times(0, 0, 0, 0, 0)]
  const after = [times(100, 100, 50, 700, 50)]
  assert.deepEqual(cpuUsage(before, after), { total: 30, user: 20, system: 10, cores: [30] })
})

test('a counter that went backwards counts as zero instead of a negative share', () => {
  const before = [times(500, 0, 500, 1000, 0)]
  const after = [times(400, 0, 600, 1900, 0)]
  assert.deepEqual(cpuUsage(before, after), { total: 10, user: 0, system: 10, cores: [10] })
})

test('a core whose counters did not move reads as idle', () => {
  const before = [times(0, 0, 0, 0, 0), times(0, 0, 0, 0, 0)]
  const after = [times(50, 0, 50, 100, 0), times(0, 0, 0, 0, 0)]
  assert.deepEqual(cpuUsage(before, after)?.cores, [50, 0])
})

test('no usage can be computed when no time passed or the core count changed', () => {
  const one = [times(10, 0, 10, 10, 0)]
  assert.equal(cpuUsage(one, one), null)
  assert.equal(cpuUsage([], one), null)
  assert.equal(cpuUsage(one, [...one, ...one]), null)
})

test('shares are rounded to one decimal and stay within 0 to 100', () => {
  const before = [times(0, 0, 0, 0, 0)]
  const after = [times(1, 0, 0, 2, 0)]
  assert.equal(cpuUsage(before, after)?.total, 33.3)
  assert.equal(round1(12.345), 12.3)
  const odd = cpuUsage([times(0, 0, 0, 0, 0)], [times(Number.NaN, 0, 10, 10, 0)])
  assert.deepEqual(odd, { total: 50, user: 0, system: 50, cores: [50] })
})
