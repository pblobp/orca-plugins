import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCoreKinds } from '../../plugins/os-vitals/src/parse/ioreg-cpus.ts'
import { macMemory } from '../../plugins/os-vitals/src/parse/mac-memory.ts'
import {
  parseSwapUsage,
  parseSysctl,
  pressureLevel
} from '../../plugins/os-vitals/src/parse/sysctl.ts'
import { parseVmStat } from '../../plugins/os-vitals/src/parse/vm-stat.ts'
import { fixture } from './helpers.ts'

const PAGE = 16384

test('vm_stat gives the page size and every counter by name', () => {
  const vm = parseVmStat(fixture('darwin/vm_stat.txt'))
  assert.ok(vm)
  assert.equal(vm.pageSize, PAGE)
  assert.equal(vm.pages['anonymous pages'], 1564844)
  assert.equal(vm.pages['pages purgeable'], 59722)
  assert.equal(vm.pages['translation faults'], 1120027090)
  assert.equal(vm.pages['swapouts'], 0)
  assert.equal(parseVmStat('not vm_stat output'), null)
  assert.equal(parseVmStat(''), null)
})

test('sysctl output is read by key, and an unknown key does not shift the others', () => {
  assert.deepEqual(parseSysctl(fixture('darwin/sysctl.txt')), {
    'hw.memsize': '51539607552',
    'vm.swapusage': 'total = 0.00M  used = 0.00M  free = 0.00M  (encrypted)',
    'kern.memorystatus_vm_pressure_level': '1'
  })
  assert.deepEqual(parseSysctl(fixture('darwin/sysctl-partial.txt')), {
    'hw.memsize': '17179869184',
    'kern.memorystatus_vm_pressure_level': '2'
  })
})

test('swap usage reads its units', () => {
  assert.deepEqual(
    parseSwapUsage('total = 3072.00M  used = 1173.25M  free = 1898.75M  (encrypted)'),
    {
      total: 3072 * 1024 ** 2,
      used: 1173.25 * 1024 ** 2
    }
  )
  assert.deepEqual(parseSwapUsage('total = 2.00G  used = 512.00K  free = 2.00G'), {
    total: 2 * 1024 ** 3,
    used: 512 * 1024
  })
  assert.equal(parseSwapUsage(undefined), null)
  assert.equal(parseSwapUsage('nothing here'), null)
})

test('pressure levels 1, 2 and 4 are normal, warning and critical', () => {
  assert.equal(pressureLevel('1'), 'normal')
  assert.equal(pressureLevel('2'), 'warning')
  assert.equal(pressureLevel('4'), 'critical')
  assert.equal(pressureLevel('0'), null)
  assert.equal(pressureLevel(undefined), null)
})

test('memory used is app (anonymous less purgeable) plus wired plus compressed', () => {
  const memory = macMemory(fixture('darwin/vm_stat.txt'), fixture('darwin/sysctl.txt'))
  const app = (1564844 - 59722) * PAGE
  const wired = 227553 * PAGE
  const compressed = 360216 * PAGE
  const used = app + wired + compressed
  const cached = (874789 + 59722) * PAGE
  assert.deepEqual(memory, {
    total: 51539607552,
    used,
    app,
    wired,
    compressed,
    cached,
    free: 51539607552 - used - cached,
    swapUsed: 0,
    swapTotal: 0,
    pressure: 'normal'
  })
})

test('memory is clamped to the total, and missing sysctl values read as unknown', () => {
  const critical = macMemory(fixture('darwin/vm_stat.txt'), fixture('darwin/sysctl-critical.txt'))
  assert.ok(critical)
  assert.equal(critical.used, 16 * 1024 ** 3)
  assert.equal(critical.cached, 0)
  assert.equal(critical.free, 0)
  assert.equal(critical.pressure, 'critical')
  assert.equal(critical.swapUsed, 1173.25 * 1024 ** 2)

  const partial = macMemory(fixture('darwin/vm_stat.txt'), fixture('darwin/sysctl-partial.txt'))
  assert.ok(partial)
  assert.equal(partial.swapUsed, null)
  assert.equal(partial.swapTotal, null)
  assert.equal(partial.pressure, 'warning')
})

test('memory needs vm_stat, the anonymous and wired counters and the total', () => {
  const vmStat = fixture('darwin/vm_stat.txt')
  const sysctl = fixture('darwin/sysctl.txt')
  assert.equal(macMemory('', sysctl), null)
  assert.equal(macMemory(vmStat, 'kern.memorystatus_vm_pressure_level: 1\n'), null)
  assert.equal(macMemory(vmStat.replace(/Anonymous pages.*\n/, ''), sysctl), null)
})

test('core kinds come from cluster-type, keyed by logical CPU id', () => {
  const kinds = parseCoreKinds(fixture('darwin/ioreg-cpus.txt'))
  assert.equal(kinds.size, 14)
  assert.deepEqual(
    [...kinds.entries()].sort((a, b) => a[0] - b[0]).map(([, kind]) => kind[0]),
    ['e', 'e', 'e', 'e', 'p', 'p', 'p', 'p', 'p', 'p', 'p', 'p', 'p', 'p']
  )
})

test('only cpuN nodes count, whatever order their properties come in', () => {
  const text = [
    '+-o cpus  <class IOPlatformDevice>',
    '| +-o cpu1@1  <class IOPlatformDevice>',
    '|     "cluster-type" = <"P">',
    '|     "logical-cpu-id" = 1',
    '| +-o cpu0@0  <class IOPlatformDevice>',
    '|     "logical-cpu-id" = 0',
    '|     "cluster-type" = <"E">',
    '| +-o cpu-debug-interface  <class AppleARMIODevice>',
    '|     "logical-cpu-id" = 7',
    '|     "cluster-type" = <"P">',
    '+-o cpu9@9  <class IOPlatformDevice>',
    '|     "cluster-type" = <"X">',
    '|     "logical-cpu-id" = 9'
  ].join('\n')
  assert.deepEqual(
    parseCoreKinds(text),
    new Map([
      [1, 'performance'],
      [0, 'efficiency']
    ])
  )
  assert.equal(parseCoreKinds('').size, 0)
})
