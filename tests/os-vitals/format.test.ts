import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ago,
  bytes,
  cpuTime,
  duration,
  gigabytes,
  loadAverage,
  percent,
  significant
} from '../../plugins/os-vitals/src/format.ts'

const KB = 1024
const MB = KB * 1024
const GB = MB * 1024

test('percent rounds and shows a dash when unknown', () => {
  assert.equal(percent(23.4), '23%')
  assert.equal(percent(23.5), '24%')
  assert.equal(percent(null), '–')
  assert.equal(percent(Number.NaN), '–')
})

test('sizes use three significant digits in GB and whole numbers below', () => {
  assert.equal(bytes(9.18 * GB), '9.18 GB')
  assert.equal(bytes(18.43 * GB), '18.4 GB')
  assert.equal(bytes(48 * GB), '48 GB')
  assert.equal(bytes(1.2 * GB), '1.2 GB')
  assert.equal(bytes(553 * MB), '553 MB')
  assert.equal(bytes(6.4 * MB), '6 MB')
  assert.equal(bytes(310 * KB), '310 KB')
  assert.equal(bytes(12), '12 B')
  assert.equal(bytes(null), '–')
  assert.equal(bytes(-1), '–')
  assert.equal(gigabytes(24.7 * GB), '24.7')
  assert.equal(significant(128.4), '128')
})

test('durations, CPU times and load averages', () => {
  assert.equal(duration(3 * 86400 + 4 * 3600 + 59), '3 d 4 h')
  assert.equal(duration(2 * 3600 + 14 * 60), '2 h 14 min')
  assert.equal(duration(59), '0 min')
  assert.equal(cpuTime(401), '6:41')
  assert.equal(cpuTime(59.9), '0:59')
  assert.equal(cpuTime(12287.11), '3:24:47')
  assert.equal(loadAverage([5.49, 4.791, 4.3]), '5.49 · 4.79 · 4.30')
  assert.equal(ago(0, 8040000), '2 h 14 min ago')
  assert.equal(ago(0, 30000), 'under a minute ago')
})
