import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  backgroundEnabled,
  DEFAULT_SETTINGS,
  readSettings
} from '../../plugins/os-vitals/src/settings.ts'

test('missing or malformed settings read as the defaults', () => {
  assert.deepEqual(readSettings(undefined), DEFAULT_SETTINGS)
  assert.deepEqual(readSettings(null), DEFAULT_SETTINGS)
  assert.deepEqual(readSettings([]), DEFAULT_SETTINGS)
  assert.deepEqual(readSettings({}), DEFAULT_SETTINGS)
})

test('valid values are kept', () => {
  const raw = {
    refreshSeconds: 5,
    historyMinutes: 15,
    statusBar: 'memory',
    backgroundSampling: false,
    memoryAlert: false,
    memoryAlertPercent: 70,
    cpuAlert: true,
    cpuAlertPercent: 100,
    defaultView: 'processes'
  }
  assert.deepEqual(readSettings(raw), raw)
})

test('values outside the declared choices and ranges fall back to the default', () => {
  const settings = readSettings({
    refreshSeconds: 3,
    historyMinutes: '5',
    statusBar: 'everything',
    backgroundSampling: 'yes',
    memoryAlertPercent: 69,
    cpuAlertPercent: 90.5,
    defaultView: 'cpu'
  })
  assert.deepEqual(settings, DEFAULT_SETTINGS)
  assert.equal(readSettings({ memoryAlertPercent: 100 }).memoryAlertPercent, 92)
  assert.equal(readSettings({ cpuAlertPercent: 49 }).cpuAlertPercent, 90)
})

test('background sampling runs only when it is on and something needs it', () => {
  assert.equal(backgroundEnabled(DEFAULT_SETTINGS), true)
  assert.equal(backgroundEnabled({ ...DEFAULT_SETTINGS, backgroundSampling: false }), false)
  const quiet = { ...DEFAULT_SETTINGS, statusBar: 'hidden' as const, memoryAlert: false }
  assert.equal(backgroundEnabled(quiet), false)
  assert.equal(backgroundEnabled({ ...quiet, cpuAlert: true }), true)
  assert.equal(backgroundEnabled({ ...quiet, memoryAlert: true }), true)
})
