import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  parseDiskstats,
  parseMounts,
  realMounts,
  SECTOR_BYTES,
  sysBlockName,
  unescapeMount
} from '../../plugins/os-vitals/src/parse/linux-disk.ts'
import { diskReading } from '../../plugins/os-vitals/src/rates.ts'
import { fixturePath } from './linux-files.ts'

const file = (tree: string, path: string) => readFileSync(fixturePath(tree, path), 'utf8')

test('diskstats gives reads, writes and bytes in 512-byte sectors', () => {
  const rows = parseDiskstats(file('host', 'proc/diskstats'))
  assert.equal(rows.length, 9)
  assert.deepEqual(
    rows.find((row) => row.id === 'nvme0n1'),
    {
      id: 'nvme0n1',
      readBytes: 41203456 * SECTOR_BYTES,
      writeBytes: 82034512 * SECTOR_BYTES,
      reads: 812034,
      writes: 412034,
      image: false
    }
  )
  assert.ok(rows.some((row) => row.id === 'loop0'))
  assert.ok(rows.some((row) => row.id === 'dm-0'))
  assert.deepEqual(parseDiskstats('garbage line\n'), [])
})

test('a reset disk counter gives zero for that interval', () => {
  const before = parseDiskstats(' 8 0 sda 100 0 2000 0 50 0 1000 0 0 0 0 0 0 0\n')
  const after = parseDiskstats(' 8 0 sda 10 0 200 0 60 0 1200 0 0 0 0 0 0 0\n')
  const reading = diskReading(before, after, 1, 1)
  assert.equal(reading.read, 0)
  assert.equal(reading.write, 200 * SECTOR_BYTES)
})

test('sysfs names replace slashes and refuse path tricks', () => {
  assert.equal(sysBlockName('cciss/c0d0'), 'cciss!c0d0')
  assert.equal(sysBlockName('nvme0n1'), 'nvme0n1')
  assert.equal(sysBlockName('../etc'), null)
  assert.equal(sysBlockName(''), null)
})

test('mount points with escaped spaces are decoded', () => {
  assert.equal(unescapeMount('/run/media/user/USB\\040Drive'), '/run/media/user/USB Drive')
  assert.equal(unescapeMount('/mnt/a\\011b'), '/mnt/a\tb')
})

test('real mounts: the root, real devices once each, no pseudo, snap, Docker or network mounts', () => {
  const rows = parseMounts(file('host', 'proc/mounts'))
  assert.deepEqual(realMounts(rows), ['/', '/boot/efi', '/home', '/mnt/usb'])
})

test('in a container, only the root is a real mount, whatever bind mounts list', () => {
  assert.deepEqual(realMounts(parseMounts(file('container', 'proc/mounts'))), ['/'])
})
