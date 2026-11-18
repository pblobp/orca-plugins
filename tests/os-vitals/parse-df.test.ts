import assert from 'node:assert/strict'
import { test } from 'node:test'
import { otherVolumes, parseDf } from '../../plugins/os-vitals/src/parse/df.ts'
import { fixture } from './helpers.ts'

const KIB = 1024
const rows = () => parseDf(fixture('darwin/df.txt'))

test('df rows are anchored on the numeric columns, so names may contain spaces', () => {
  const list = rows()
  const backup = list.find((row) => row.mount === '/Volumes/Backup Drive')
  assert.deepEqual(backup, {
    device: '/dev/disk7s2',
    mount: '/Volumes/Backup Drive',
    total: 1953104896 * KIB,
    used: 1171862936 * KIB,
    available: 781241960 * KIB
  })
  const share = list.find((row) => row.mount === '/Volumes/Example Share')
  assert.equal(share?.device, 'Example Share 2')
  assert.equal(share?.total, 2000000 * KIB)
  assert.equal(
    list.find((row) => row.device === 'map auto_home')?.mount,
    '/System/Volumes/Data/home'
  )
  assert.equal(list.find((row) => row.mount === '/Volumes/USB 2 0')?.total, 30703616 * KIB)
  const device = list.find((row) => row.device.startsWith('devices -- file:'))
  assert.equal(device?.mount, '/Users/user/Library/Developer/CoreDevice/DeviceFS')
  assert.equal(list.length, 13)
})

test('other volumes are mounted under /Volumes and are not part of the startup disk', () => {
  const others = otherVolumes(rows(), ['/System/Volumes/Data', '/'])
  assert.deepEqual(
    others.map((row) => row.mount),
    ['/Volumes/Backup Drive', '/Volumes/USB 2 0']
  )
})

test('a line that is not a df row is skipped', () => {
  assert.deepEqual(parseDf(''), [])
  assert.deepEqual(
    parseDf('Filesystem 1024-blocks Used Available Capacity Mounted on\nnot a row'),
    []
  )
})
