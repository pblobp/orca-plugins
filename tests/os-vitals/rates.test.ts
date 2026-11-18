import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DiskDriver } from '../../plugins/os-vitals/src/parse/ioreg-disk.ts'
import type { InterfaceCounters } from '../../plugins/os-vitals/src/parse/netstat.ts'
import { parseNetstat } from '../../plugins/os-vitals/src/parse/netstat.ts'
import { diskReading, grew, networkReading } from '../../plugins/os-vitals/src/rates.ts'
import { fixture } from './helpers.ts'

const nic = (name: string, rx: number, tx: number, rxp = 0, txp = 0): InterfaceCounters => ({
  name,
  rxBytes: rx,
  txBytes: tx,
  rxPackets: rxp,
  txPackets: txp
})

const drive = (id: string, read: number, write: number, image = false): DiskDriver => ({
  id,
  readBytes: read,
  writeBytes: write,
  reads: read / 1000,
  writes: write / 1000,
  image
})

test('a counter that went down counts as no traffic, never as negative', () => {
  assert.equal(grew(100, 250), 150)
  assert.equal(grew(250, 100), 0)
  assert.equal(grew(5, 5), 0)
  assert.equal(grew(Number.NaN, 5), 0)
})

test('network rates are per second, from counter deltas of counted interfaces', () => {
  const reading = networkReading(
    [nic('en0', 1000, 500, 10, 5), nic('lo0', 0, 0), nic('utun3', 0, 0)],
    [nic('en0', 5000, 2500, 30, 15), nic('lo0', 8000, 8000), nic('utun3', 400, 200)],
    2,
    1000,
    'en0'
  )
  assert.equal(reading.down, 2000)
  assert.equal(reading.up, 1000)
  assert.equal(reading.packetsIn, 10)
  assert.equal(reading.packetsOut, 5)
  assert.equal(reading.received, 5000)
  assert.equal(reading.sent, 2500)
  assert.equal(reading.defaultInterface, 'en0')
  assert.deepEqual(reading.interfaces, [
    { name: 'lo0', kind: 'loopback', counted: false, down: 4000, up: 4000 },
    { name: 'en0', kind: null, counted: true, down: 2000, up: 1000 },
    { name: 'utun3', kind: 'tunnel', counted: false, down: 200, up: 100 }
  ])
})

test('a reset interface counter gives zero for that interval, and the others still count', () => {
  const reading = networkReading(
    [nic('en0', 9_000_000, 9_000_000), nic('en5', 1000, 1000)],
    [nic('en0', 1000, 2000), nic('en5', 3000, 1000)],
    1,
    1000,
    null
  )
  assert.equal(reading.down, 2000)
  assert.equal(reading.up, 0)
  assert.deepEqual(
    reading.interfaces.map((row) => row.name),
    ['en5']
  )
})

test('an interface that appears between readings adds no spike', () => {
  const reading = networkReading(
    [nic('en0', 100, 100)],
    [nic('en0', 300, 100), nic('en7', 50_000_000_000, 1)],
    1,
    1000,
    null
  )
  assert.equal(reading.down, 200)
  assert.equal(reading.received, 50_000_000_300)
})

test('disk rates sum the drives, skip disk images, and clamp a reset', () => {
  const reading = diskReading(
    [drive('a', 1_000_000, 2_000_000), drive('b', 5_000_000, 0), drive('img', 0, 0, true)],
    [drive('a', 3_000_000, 2_500_000), drive('b', 1_000, 0), drive('img', 9_000_000, 0, true)],
    2,
    1000
  )
  assert.equal(reading.read, 1_000_000)
  assert.equal(reading.write, 250_000)
  assert.equal(reading.reads, 1000)
  assert.equal(reading.writes, 250)
  assert.equal(reading.readTotal, 3_001_000)
  assert.equal(reading.writeTotal, 2_500_000)
})

test('a drive that appears between readings adds no spike', () => {
  const reading = diskReading(
    [drive('a', 0, 0)],
    [drive('a', 1000, 0), drive('new', 9e12, 9e12)],
    1,
    1
  )
  assert.equal(reading.read, 1000)
  assert.equal(reading.write, 0)
})

test('two real netstat readings give rates, and an interface whose counter reset gives zero', () => {
  const before = parseNetstat(fixture('darwin/netstat.txt')) ?? []
  const after = parseNetstat(fixture('darwin/netstat-later.txt')) ?? []
  const reading = networkReading(before, after, 2, 1000, 'en0')
  assert.equal(reading.down, 2_500_000)
  assert.equal(reading.up, 500_000)
  assert.equal(reading.packetsIn, 1000)
  assert.equal(reading.packetsOut, 500)
  assert.deepEqual(
    reading.interfaces.map((row) => [row.name, row.counted, row.down, row.up]),
    [
      ['en0', true, 2_500_000, 500_000],
      ['lo0', false, 500_000, 500_000],
      ['awdl0', false, 500_000, 50_000],
      ['bridge0', false, 100_000, 200_000],
      ['utun4', false, 1000, 500],
      ['utun0', false, 0, 1000]
    ]
  )
  assert.ok(!reading.interfaces.some((row) => row.name === 'en10'))
})
