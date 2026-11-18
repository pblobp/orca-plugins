import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  linuxMemory,
  parseMeminfo,
  parsePressure
} from '../../plugins/os-vitals/src/parse/linux-memory.ts'
import { fixturePath } from './linux-files.ts'

const KB = 1024
const file = (tree: string, path: string) => readFileSync(fixturePath(tree, path), 'utf8')

test('meminfo values are read in bytes, and counts without kB stay counts', () => {
  const info = parseMeminfo(file('host', 'proc/meminfo'))
  assert.equal(info.get('MemTotal'), 16303088 * KB)
  assert.equal(info.get('HugePages_Total'), 0)
  assert.equal(info.get('Hugepagesize'), 2048 * KB)
})

test('Linux memory: used is total minus available, cached counts reclaimable slab and not shmem', () => {
  const reading = linuxMemory(parseMeminfo(file('host', 'proc/meminfo')), 'normal')
  assert.deepEqual(reading, {
    total: 16303088 * KB,
    used: (16303088 - 9208764) * KB,
    app: null,
    wired: null,
    compressed: null,
    buffers: 412560 * KB,
    cached: (7612340 + 604800 - 902100) * KB,
    free: 1402316 * KB,
    swapUsed: (8388604 - 7340028) * KB,
    swapTotal: 8388604 * KB,
    pressure: 'normal'
  })
})

test('an old kernel without MemAvailable uses total minus free, buffers and cache', () => {
  const text = 'MemTotal: 1000 kB\nMemFree: 200 kB\nBuffers: 100 kB\nCached: 300 kB\nShmem: 50 kB\n'
  const reading = linuxMemory(parseMeminfo(text), null)
  assert.ok(reading)
  assert.equal(reading.used, (1000 - 200 - 100 - 250) * KB)
  assert.equal(reading.cached, 250 * KB)
  assert.equal(reading.swapUsed, null)
  assert.equal(reading.pressure, null)
})

test('a container reads the host meminfo the same way', () => {
  const reading = linuxMemory(parseMeminfo(file('container', 'proc/meminfo')), null)
  assert.ok(reading)
  assert.equal(reading.used, (16393640 - 15483484) * KB)
  assert.equal(reading.swapUsed, 0)
})

test('meminfo without a total is not a reading', () => {
  assert.equal(linuxMemory(parseMeminfo('MemFree: 10 kB\n'), null), null)
  assert.equal(linuxMemory(parseMeminfo(''), null), null)
})

test('memory pressure maps the ten-second stall average onto three levels', () => {
  assert.equal(parsePressure(file('container', 'proc/pressure/memory')), 'normal')
  assert.equal(parsePressure(file('host', 'proc/pressure/memory')), 'warning')
  assert.equal(parsePressure('some avg10=45.00 avg60=1 avg300=1 total=1\n'), 'critical')
  assert.equal(
    parsePressure(
      'some avg10=12.00 avg60=1 avg300=1 total=1\nfull avg10=11.00 avg60=1 avg300=1 total=1\n'
    ),
    'critical'
  )
  assert.equal(parsePressure(''), null)
})
