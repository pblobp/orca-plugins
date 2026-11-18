import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ago,
  bytes,
  clockTime,
  cpuTime,
  duration,
  gigabytes,
  loadAverage,
  percent,
  perSecond,
  portion,
  rate,
  rateScale,
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

test('rates use binary units, whole numbers below a megabyte and one decimal above', () => {
  assert.equal(rate(0), '0 B/s')
  assert.equal(rate(900), '900 B/s')
  assert.equal(rate(310 * KB), '310 KB/s')
  assert.equal(rate(12.4 * KB), '12 KB/s')
  assert.equal(rate(2.4 * MB), '2.4 MB/s')
  assert.equal(rate(12.44 * MB), '12.4 MB/s')
  assert.equal(rate(150 * MB), '150 MB/s')
  assert.equal(rate(1.5 * GB), '1.5 GB/s')
  assert.equal(rate(-1), '–')
  assert.equal(rate(null), '–')
})

test('bytes reach terabytes', () => {
  assert.equal(bytes(2 * 1024 * GB), '2 TB')
  assert.equal(bytes(1.25 * 1024 * GB), '1.25 TB')
})

test('a rate scale is the next nice value above the visible peak, and labels it', () => {
  assert.deepEqual(rateScale(5.2 * MB), { max: 6 * MB, top: '6 MB/s', mid: '3' })
  assert.deepEqual(rateScale(2.9 * MB), { max: 4 * MB, top: '4 MB/s', mid: '2' })
  assert.deepEqual(rateScale(700 * KB), { max: 800 * KB, top: '800 KB/s', mid: '400' })
  assert.deepEqual(rateScale(790 * KB), { max: 1 * MB, top: '1 MB/s', mid: '0.5' })
  assert.deepEqual(rateScale(0), { max: KB, top: '1 KB/s', mid: '0.5' })
  assert.deepEqual(rateScale(Number.NaN), { max: KB, top: '1 KB/s', mid: '0.5' })
  assert.deepEqual(rateScale(45 * MB), { max: 50 * MB, top: '50 MB/s', mid: '25' })
})

test('a spike raises the scale instead of being cut off', () => {
  const quiet = rateScale(200 * KB)
  const spiked = rateScale(80 * MB)
  assert.ok(quiet.max >= 200 * KB)
  assert.ok(spiked.max >= 80 * MB)
  assert.equal(spiked.top, '100 MB/s')
})

test('clock time is hours, minutes and seconds', () => {
  assert.equal(clockTime(new Date(2026, 10, 17, 14, 32, 10).getTime()), '14:32:10')
  assert.equal(clockTime(new Date(2026, 10, 17, 9, 5, 0).getTime()), '09:05:00')
})

test('a portion shares the unit of the whole', () => {
  assert.equal(portion(375 * GB, 494 * GB), '375 of 494 GB')
  assert.equal(portion(1.2 * 1024 * GB, 2 * 1024 * GB), '1.2 of 2 TB')
  assert.equal(portion(300 * MB, 900 * MB), '300 of 900 MB')
  assert.equal(portion(1, 0), '–')
  assert.equal(perSecond(1240.4), '1,240 /s')
  assert.equal(perSecond(null), '–')
})
