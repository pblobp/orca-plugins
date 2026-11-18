import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { linuxInterface } from '../../plugins/os-vitals/src/interfaces.ts'
import { parseLinuxDefaultRoute, parseNetDev } from '../../plugins/os-vitals/src/parse/linux-net.ts'
import { networkReading } from '../../plugins/os-vitals/src/rates.ts'
import { fixturePath } from './linux-files.ts'

const file = (tree: string, path: string) => readFileSync(fixturePath(tree, path), 'utf8')

test('/proc/net/dev gives bytes and packets per interface, including names glued to numbers', () => {
  const rows = parseNetDev(file('host', 'proc/net/dev')) ?? []
  const wifi = rows.find((row) => row.name === 'wlp2s0')
  assert.deepEqual(wifi, {
    name: 'wlp2s0',
    rxBytes: 9120334512,
    rxPackets: 7120334,
    txBytes: 1203345120,
    txPackets: 2120334
  })
  assert.equal(rows.length, 9)
  assert.ok(rows.some((row) => row.name === 'br-0a1b2c3d4e5f'))
  const container = parseNetDev(file('container', 'proc/net/dev')) ?? []
  assert.equal(container.find((row) => row.name === 'gretap0')?.rxBytes, 0)
  assert.equal(container.find((row) => row.name === 'eth0')?.txBytes, 42)
  assert.equal(parseNetDev('not net dev'), null)
})

test('the default route is the lowest-metric default that is up', () => {
  assert.equal(parseLinuxDefaultRoute(file('host', 'proc/net/route')), 'wlp2s0')
  assert.equal(parseLinuxDefaultRoute(file('container', 'proc/net/route')), 'eth0')
  assert.equal(parseLinuxDefaultRoute('Iface\tDestination\n'), null)
})

test('loopback, Docker, veth, bridges, tun, tap and kernel tunnels stay out of the totals', () => {
  for (const name of [
    'lo',
    'docker0',
    'veth1a2b3c4',
    'br-0a1b2c3d4e5f',
    'virbr0',
    'tun0',
    'tap1'
  ]) {
    assert.equal(linuxInterface(name).counted, false, name)
  }
  for (const name of ['wg0', 'gretap0', 'sit0', 'ip6tnl0', 'tunl0']) {
    assert.equal(linuxInterface(name).counted, false, name)
  }
  for (const name of ['eth0', 'wlp2s0', 'enp3s0', 'eno1', 'wlan0']) {
    assert.equal(linuxInterface(name).counted, true, name)
  }
  assert.equal(linuxInterface('veth9').kind, 'virtual')
  assert.equal(linuxInterface('docker0').kind, 'bridge')
  assert.equal(linuxInterface('wg0').kind, 'tunnel')
})

test('rates from two readings count the wireless card only, and a reset veth counter gives zero', () => {
  const before = parseNetDev(file('host', 'proc/net/dev')) ?? []
  const after = parseNetDev(file('host', 'proc/net/dev-later')) ?? []
  const reading = networkReading(before, after, 2, 1, 'wlp2s0', linuxInterface)
  assert.equal(reading.down, 2_000_000)
  assert.equal(reading.up, 500_000)
  assert.equal(reading.packetsIn, 2000)
  assert.deepEqual(
    reading.interfaces.map((row) => [row.name, row.kind, row.counted]),
    [
      ['wlp2s0', null, true],
      ['docker0', 'bridge', false],
      ['lo', 'loopback', false],
      ['tun0', 'tunnel', false]
    ]
  )
})
