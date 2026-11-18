import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseDictionary, parseDiskDrivers } from '../../plugins/os-vitals/src/parse/ioreg-disk.ts'
import { fixture } from './helpers.ts'

test('each block storage driver gives its bytes and operations', () => {
  const drivers = parseDiskDrivers(fixture('darwin/ioreg-disk.txt'))
  assert.equal(drivers.length, 3)
  assert.deepEqual(drivers[1], {
    id: '0x100000a55',
    readBytes: 312344535040,
    writeBytes: 159386615808,
    reads: 9506420,
    writes: 9299847,
    image: false
  })
  assert.equal(drivers[0].readBytes, 0)
  assert.equal(drivers[0].image, false)
})

test('a driver that sits on a disk image is marked, so its bytes are not counted twice', () => {
  const drivers = parseDiskDrivers(fixture('darwin/ioreg-disk.txt'))
  const image = drivers.find((driver) => driver.id === '0x100003d74')
  assert.ok(image)
  assert.equal(image.image, true)
  assert.equal(image.readBytes, 7640706048)
  assert.equal(drivers.filter((driver) => driver.image).length, 1)
})

test('a driver without statistics is left out', () => {
  const text = [
    '+-o IOBlockStorageDriver  <class IOBlockStorageDriver, id 0x100000001, registered>',
    '    {',
    '      "IOClass" = "IOBlockStorageDriver"',
    '    }'
  ].join('\n')
  assert.deepEqual(parseDiskDrivers(text), [])
  assert.deepEqual(parseDiskDrivers(''), [])
})

test('a statistics dictionary is read by key', () => {
  const stats = parseDictionary('"Bytes (Read)"=12,"Errors (Write)"=0,"Operations (Read)"=3')
  assert.equal(stats.get('Bytes (Read)'), 12)
  assert.equal(stats.get('Operations (Read)'), 3)
  assert.equal(stats.get('Bytes (Write)'), undefined)
})
