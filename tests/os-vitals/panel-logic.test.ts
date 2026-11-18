import assert from 'node:assert/strict'
import { test } from 'node:test'
import { segmentShares } from '../../plugins/os-vitals/panel/cards/memory.ts'
import { stoppedSections, stoppedText } from '../../plugins/os-vitals/panel/views/overview.ts'
import type { Sections } from '../../plugins/os-vitals/src/protocol.ts'

const all: Sections = {
  cpu: true,
  load: true,
  memory: true,
  processes: true,
  network: true,
  disk: true,
  gpu: true,
  battery: false,
  energy: true
}

test('a section that turns itself off is named, and one that never existed is not', () => {
  assert.deepEqual(stoppedSections(all, all), [])
  assert.deepEqual(stoppedSections(all, { ...all, network: false, battery: false }), ['Network'])
  assert.deepEqual(stoppedSections(all, { ...all, network: false, disk: false, gpu: false }), [
    'Network',
    'Disk',
    'GPU'
  ])
  assert.equal(
    stoppedText(['Network']),
    'Network stopped answering after repeated failures, so it is hidden until Orca restarts the plugin.'
  )
  assert.match(
    stoppedText(['Network', 'Disk', 'GPU']),
    /^Network, Disk and GPU stopped.*they are hidden/
  )
})

test('memory segments never add up to more than the whole bar', () => {
  assert.deepEqual(segmentShares([50, 30, 40], 100), [50, 30, 20])
  assert.deepEqual(segmentShares([10, 20], 100), [10, 20])
  assert.deepEqual(segmentShares([10], 0), [0])
})
