import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createStatusBar,
  statusView,
  type StatusBarUpdate,
  type StatusInput
} from '../../plugins/os-vitals/src/status.ts'
import { fakeClock } from './helpers.ts'

const input = (cpu: number | null, memory: number | null = null): StatusInput => ({
  cpu,
  memory,
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

test('the tooltip names the plugin and the load', () => {
  assert.equal(statusView('cpu', input(5))?.tooltip, 'OS Vitals\nLoad 1.50 · 1.25 · 1.00')
  assert.equal(statusView('cpu', { cpu: 5, memory: null, load: null })?.tooltip, 'OS Vitals')
})

function bar() {
  const time = fakeClock()
  const updates: StatusBarUpdate[] = []
  const statusBar = createStatusBar({ clock: time.clock, update: (params) => updates.push(params) })
  return { time, updates, statusBar }
}

test('updates are sent at most every 5 s', () => {
  const { time, updates, statusBar } = bar()
  statusBar.show('cpu', input(10))
  time.advance(2000)
  statusBar.show('cpu', input(20))
  time.advance(2999)
  statusBar.show('cpu', input(30))
  assert.deepEqual(
    updates.map((update) => update.text),
    ['CPU 10%']
  )
  time.advance(1)
  statusBar.show('cpu', input(30))
  assert.deepEqual(
    updates.map((update) => update.text),
    ['CPU 10%', 'CPU 30%']
  )
})

test('an unchanged reading sends nothing, and force skips the wait', () => {
  const { time, updates, statusBar } = bar()
  statusBar.show('cpu', input(10.2))
  time.advance(10000)
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
