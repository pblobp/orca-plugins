import assert from 'node:assert/strict'
import { test } from 'node:test'
import { linuxBattery } from '../../plugins/os-vitals/src/parse/linux-battery.ts'
import { amdGpu, parseNvidiaSmi } from '../../plugins/os-vitals/src/parse/linux-gpu.ts'

const MIB = 1024 * 1024

test('nvidia-smi: the busiest GPU, with its memory in MiB and a name that may contain commas', () => {
  const text =
    '12, 512, 8192, NVIDIA GeForce RTX 3070\n67, 20480, 24576, NVIDIA RTX A5000, Example Edition\n'
  assert.deepEqual(parseNvidiaSmi(text), {
    model: 'NVIDIA RTX A5000, Example Edition',
    utilization: 67,
    renderer: null,
    inUse: 20480 * MIB,
    allocated: 24576 * MIB,
    dedicated: true
  })
})

test('nvidia-smi values it cannot report are left out', () => {
  const reading = parseNvidiaSmi('5, [N/A], [N/A], NVIDIA T400\n')
  assert.equal(reading?.inUse, null)
  assert.equal(reading?.allocated, null)
  assert.equal(parseNvidiaSmi('[Not Supported], 1, 2, Example\n'), null)
  assert.equal(parseNvidiaSmi(''), null)
})

test('AMD from sysfs, and no reading without a busy percentage', () => {
  assert.deepEqual(amdGpu('37\n', '805306368\n', '4294967296\n', 'Example Radeon\n'), {
    model: 'Example Radeon',
    utilization: 37,
    renderer: null,
    inUse: 805306368,
    allocated: 4294967296,
    dedicated: true
  })
  assert.equal(amdGpu('37', null, null, null)?.model, 'AMD GPU')
  assert.equal(amdGpu('', null, null, null), null)
})

const files = {
  capacity: null,
  status: null,
  powerNow: null,
  currentNow: null,
  voltageNow: null,
  energyNow: null,
  energyFull: null,
  chargeNow: null,
  chargeFull: null
}

test('a discharging battery with power_now gives the draw and the time left', () => {
  assert.deepEqual(
    linuxBattery({
      ...files,
      capacity: '64\n',
      status: 'Discharging\n',
      powerNow: '11240000\n',
      energyNow: '36400000\n',
      energyFull: '56800000\n'
    }),
    { percent: 64, onBattery: true, state: 'discharging', minutesLeft: 194, watts: 11.24 }
  )
})

test('a battery that reports current and voltage instead of power', () => {
  const reading = linuxBattery({
    ...files,
    capacity: '80',
    status: 'Charging',
    currentNow: '1500000',
    voltageNow: '12000000',
    chargeNow: '3000000',
    chargeFull: '4500000'
  })
  assert.deepEqual(reading, {
    percent: 80,
    onBattery: false,
    state: 'charging',
    minutesLeft: 60,
    watts: 18
  })
})

test('full, not charging, and unknown states, and a missing capacity', () => {
  assert.equal(linuxBattery({ ...files, capacity: '100', status: 'Full' })?.state, 'charged')
  assert.equal(
    linuxBattery({ ...files, capacity: '60', status: 'Not charging' })?.state,
    'not-charging'
  )
  assert.deepEqual(linuxBattery({ ...files, capacity: '60', status: 'Unknown' }), {
    percent: 60,
    onBattery: false,
    state: null,
    minutesLeft: null,
    watts: null
  })
  assert.equal(linuxBattery(files), null)
  assert.equal(linuxBattery({ ...files, capacity: '140' }), null)
})
