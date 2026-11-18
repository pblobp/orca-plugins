import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  hasPowerSource,
  parseAssertions,
  parseBattery,
  sleepBlockers
} from '../../plugins/os-vitals/src/parse/pmset.ts'
import { fixture } from './helpers.ts'

test('a laptop on AC that is not charging', () => {
  assert.deepEqual(parseBattery(fixture('darwin/pmset-batt.txt')), {
    percent: 69,
    onBattery: false,
    state: 'not-charging',
    minutesLeft: null
  })
})

test('on battery, the time left is read', () => {
  assert.deepEqual(parseBattery(fixture('darwin/pmset-batt-discharging.txt')), {
    percent: 82,
    onBattery: true,
    state: 'discharging',
    minutesLeft: 222
  })
})

test('charging without an estimate, and charged', () => {
  assert.deepEqual(parseBattery(fixture('darwin/pmset-batt-charging.txt')), {
    percent: 45,
    onBattery: false,
    state: 'charging',
    minutesLeft: null
  })
  assert.deepEqual(parseBattery(fixture('darwin/pmset-batt-charged.txt')), {
    percent: 100,
    onBattery: false,
    state: 'charged',
    minutesLeft: null
  })
})

test('a desktop has a power source and no battery line', () => {
  const text = fixture('darwin/pmset-batt-desktop.txt')
  assert.equal(parseBattery(text), null)
  assert.equal(hasPowerSource(text), true)
  assert.equal(hasPowerSource(''), false)
})

test('a battery line with only two fields is still read', () => {
  const text =
    "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t95%; charging present: true\n"
  assert.deepEqual(parseBattery(text), {
    percent: 95,
    onBattery: false,
    state: 'charging',
    minutesLeft: null
  })
})

test('assertions are listed per owner, and the kernel section is not read', () => {
  const list = parseAssertions(fixture('darwin/pmset-assertions.txt'))
  assert.equal(list.length, 12)
  assert.deepEqual(list[0], { pid: 511, name: 'coreaudiod', type: 'PreventUserIdleSystemSleep' })
  assert.deepEqual(list[7], {
    pid: 1637,
    name: 'Example Browser Helper (Renderer)',
    type: 'NoIdleSleepAssertion'
  })
  assert.ok(!list.some((entry) => entry.name.includes('Cable')))
})

test('sleep blockers group each owner, drop powerd and activity notices, and keep every kind', () => {
  const blockers = sleepBlockers(parseAssertions(fixture('darwin/pmset-assertions.txt')))
  assert.deepEqual(blockers, [
    { pid: 511, name: 'coreaudiod', kinds: ['system'] },
    { pid: 69806, name: 'caffeinate', kinds: ['system'] },
    { pid: 36800, name: 'caffeinate', kinds: ['system'] },
    { pid: 73362, name: 'Example App', kinds: ['system'] },
    { pid: 1637, name: 'Example Browser Helper (Renderer)', kinds: ['system', 'display'] },
    { pid: 2075, name: 'Example Keeper', kinds: ['display'] }
  ])
  assert.deepEqual(sleepBlockers(parseAssertions(fixture('darwin/pmset-assertions-none.txt'))), [])
})
