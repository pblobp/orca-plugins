import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MemoryReading } from '../../plugins/os-vitals/src/protocol.ts'
import {
  createStatusBar,
  memoryLine,
  memoryPercent,
  statusView,
  type StatusBarUpdate,
  type StatusInput
} from '../../plugins/os-vitals/src/status.ts'
import { fakeClock } from './helpers.ts'

const GB = 1024 ** 3

const memoryAt = (percent: number, pressure: MemoryReading['pressure'] = null): MemoryReading => ({
  total: 48 * GB,
  used: (48 * GB * percent) / 100,
  app: null,
  wired: null,
  compressed: null,
  buffers: null,
  cached: null,
  free: 48 * GB * (1 - percent / 100),
  swapUsed: null,
  swapTotal: null,
  pressure
})

const input = (cpu: number | null, memory: number | null = null): StatusInput => ({
  cpu,
  memory: memory === null ? null : memoryAt(memory),
  load: [1.5, 1.25, 1]
})

test('the text follows the status bar setting', () => {
  assert.equal(statusView('cpu-memory', input(23.4, 61.2))?.text, 'CPU 23% · MEM 61%')
  assert.equal(statusView('cpu-memory', input(23.4))?.text, 'CPU 23%')
  assert.equal(statusView('cpu', input(23.6, 61))?.text, 'CPU 24%')
  assert.equal(statusView('memory', input(23, 61))?.text, 'MEM 61%')
  assert.equal(statusView('memory', input(23))?.text, 'MEM –')
  assert.equal(statusView('cpu', input(null))?.text, 'CPU –')
  assert.equal(statusView('hidden', input(23, 61)), null)
})

test('the tooltip names the plugin, the load and the memory', () => {
  assert.equal(statusView('cpu', input(5))?.tooltip, 'OS Vitals\nLoad 1.50 · 1.25 · 1.00')
  assert.equal(statusView('cpu', { cpu: 5, memory: null, load: null })?.tooltip, 'OS Vitals')
  assert.equal(
    statusView('cpu', { cpu: 5, memory: memoryAt(51.5, 'normal'), load: null })?.tooltip,
    'OS Vitals\nMemory 24.7 of 48 GB, pressure normal'
  )
})

test('memory percent and line come from used and total', () => {
  assert.equal(memoryPercent(memoryAt(25)), 25)
  assert.equal(memoryPercent(null), null)
  assert.equal(memoryPercent({ ...memoryAt(25), total: 0 }), null)
  assert.equal(memoryLine(memoryAt(50)), 'Memory 24 of 48 GB')
  assert.equal(memoryLine(memoryAt(50, 'critical')), 'Memory 24 of 48 GB, pressure critical')
})

function bar() {
  const time = fakeClock()
  const updates: StatusBarUpdate[] = []
  const statusBar = createStatusBar({ clock: time.clock, update: (params) => updates.push(params) })
  return { time, updates, statusBar }
}

test('updates are sent at most every 5 s', async () => {
  const { time, updates, statusBar } = bar()
  statusBar.show('cpu', input(10))
  await time.advance(2000)
  statusBar.show('cpu', input(20))
  await time.advance(2999)
  statusBar.show('cpu', input(30))
  assert.deepEqual(
    updates.map((update) => update.text),
    ['CPU 10%']
  )
  await time.advance(1)
  statusBar.show('cpu', input(30))
  assert.deepEqual(
    updates.map((update) => update.text),
    ['CPU 10%', 'CPU 30%']
  )
})

test('an unchanged reading sends nothing, and force skips the wait', async () => {
  const { time, updates, statusBar } = bar()
  statusBar.show('cpu', input(10.2))
  await time.advance(10000)
  statusBar.show('cpu', input(9.8))
  assert.equal(updates.length, 1)
  statusBar.show('cpu-memory', input(40), true)
  assert.equal(updates.length, 2)
  statusBar.show('cpu-memory', input(40), true)
  assert.equal(updates.length, 2)
})

test('visibility is sent on its own, and hiding forgets the last text', () => {
  const { updates, statusBar } = bar()
  statusBar.applyVisibility('cpu')
  statusBar.show('cpu', input(10))
  statusBar.applyVisibility('hidden')
  statusBar.show('hidden', input(10))
  statusBar.applyVisibility('cpu')
  statusBar.show('cpu', input(10), true)
  assert.deepEqual(updates, [
    { id: 'os-vitals', visible: true },
    {
      id: 'os-vitals',
      text: 'CPU 10%',
      tone: 'neutral',
      tooltip: 'OS Vitals\nLoad 1.50 · 1.25 · 1.00'
    },
    { id: 'os-vitals', visible: false },
    { id: 'os-vitals', visible: true },
    {
      id: 'os-vitals',
      text: 'CPU 10%',
      tone: 'neutral',
      tooltip: 'OS Vitals\nLoad 1.50 · 1.25 · 1.00'
    }
  ])
})

test('after a refused update, visibility and text are sent again with the next reading', async () => {
  const { time, updates, statusBar } = bar()
  statusBar.applyVisibility('hidden')
  statusBar.failed({ id: 'os-vitals', visible: false })
  statusBar.show('hidden', input(10))
  assert.deepEqual(updates.at(-1), { id: 'os-vitals', visible: false })
  statusBar.applyVisibility('cpu')
  statusBar.show('cpu', input(10))
  statusBar.failed({ id: 'os-vitals', text: 'CPU 10%' })
  await time.advance(5000)
  statusBar.show('cpu', input(10))
  assert.deepEqual(
    updates.map((update) => update.text ?? `visible:${update.visible}`),
    ['visible:false', 'visible:false', 'visible:true', 'CPU 10%', 'CPU 10%']
  )
})
