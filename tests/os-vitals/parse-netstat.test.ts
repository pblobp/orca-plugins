import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  countsInTotals,
  interfaceKind,
  parseDefaultRoute,
  parseNetstat
} from '../../plugins/os-vitals/src/parse/netstat.ts'
import { fixture } from './helpers.ts'

const byName = (text: string) => new Map((parseNetstat(text) ?? []).map((row) => [row.name, row]))

test('netstat gives each interface its counters from the link row', () => {
  const rows = byName(fixture('darwin/netstat.txt'))
  assert.deepEqual(rows.get('en0'), {
    name: 'en0',
    rxBytes: 15580487486,
    txBytes: 3283919346,
    rxPackets: 14453444,
    txPackets: 10707759
  })
  assert.deepEqual(rows.get('lo0'), {
    name: 'lo0',
    rxBytes: 10437912037,
    txBytes: 10437912037,
    rxPackets: 11270390,
    txPackets: 11270390
  })
})

test('a link row with no Address column is read from the right', () => {
  const rows = byName(fixture('darwin/netstat.txt'))
  assert.equal(rows.get('utun0')?.txBytes, 40401)
  assert.equal(rows.get('utun0')?.txPackets, 219)
  assert.equal(rows.get('utun4')?.rxBytes, 12264)
  assert.equal(rows.get('utun4')?.txBytes, 5170)
})

test('a trailing star, which marks an interface that is down, is not part of its name', () => {
  const rows = byName(fixture('darwin/netstat.txt'))
  assert.ok(rows.has('gif0'))
  assert.ok(rows.has('nan0'))
  assert.ok(rows.has('en9'))
  assert.equal(rows.get('nan0')?.txBytes, 4140)
  assert.ok(![...rows.keys()].some((name) => name.includes('*')))
})

test('the rows each address family repeats are not counted again', () => {
  const list = parseNetstat(fixture('darwin/netstat.txt')) ?? []
  assert.equal(list.filter((row) => row.name === 'en0').length, 1)
  assert.equal(list.filter((row) => row.name === 'lo0').length, 1)
  assert.equal(list.length, new Set(list.map((row) => row.name)).size)
  assert.equal(list.length, 15)
})

test('output without the byte columns is not netstat -ibn', () => {
  assert.equal(parseNetstat(''), null)
  assert.equal(parseNetstat('Name Mtu Network Address Ipkts Ierrs Opkts Oerrs Coll\n'), null)
  assert.deepEqual(parseNetstat(fixture('darwin/netstat.txt').split('\n')[0]), [])
})

test('loopback, bridges, tunnels and Apple wireless helpers stay out of the totals', () => {
  for (const name of ['lo0', 'bridge0', 'bridge100', 'utun3', 'gif0', 'stf0', 'awdl0', 'llw0']) {
    assert.equal(countsInTotals(name), false, name)
  }
  for (const name of ['anpi0', 'ap1']) assert.equal(countsInTotals(name), false, name)
  for (const name of ['en0', 'en10', 'nan0', 'anri0'])
    assert.equal(countsInTotals(name), true, name)
  assert.equal(interfaceKind('lo0'), 'loopback')
  assert.equal(interfaceKind('utun3'), 'tunnel')
  assert.equal(interfaceKind('bridge100'), 'bridge')
  assert.equal(interfaceKind('awdl0'), 'wireless-helper')
  assert.equal(interfaceKind('en0'), null)
  assert.equal(interfaceKind('apple0'), null)
})

test('route names the default interface, and no route gives none', () => {
  assert.equal(parseDefaultRoute(fixture('darwin/route.txt')), 'en0')
  assert.equal(parseDefaultRoute(fixture('darwin/route-none.txt')), null)
  assert.equal(parseDefaultRoute(''), null)
})
