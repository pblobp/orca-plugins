import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseGpu } from '../../plugins/os-vitals/src/parse/ioreg-gpu.ts'
import { fixture } from './helpers.ts'

test('the accelerator gives its utilization, renderer, memory and model', () => {
  assert.deepEqual(parseGpu(fixture('darwin/ioreg-gpu.txt')), {
    model: 'Apple M4 Pro',
    utilization: 22,
    renderer: 22,
    inUse: 845266944,
    allocated: 5785731072,
    dedicated: false
  })
})

test('with two GPUs the busier one is shown, and a quoted data model is read', () => {
  assert.deepEqual(parseGpu(fixture('darwin/ioreg-gpu-two.txt')), {
    model: 'AMD Radeon Pro 5500M',
    utilization: 41,
    renderer: null,
    inUse: null,
    allocated: null,
    dedicated: false
  })
})

test('an accelerator without performance statistics gives no reading', () => {
  assert.equal(parseGpu(fixture('darwin/ioreg-gpu-idle.txt')), null)
  assert.equal(parseGpu(''), null)
})
