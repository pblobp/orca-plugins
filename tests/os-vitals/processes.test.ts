import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parsePs } from '../../plugins/os-vitals/src/parse/ps.ts'
import {
  createProcessTracker,
  matches,
  PAGE_SIZE,
  queryProcesses,
  readQuery,
  type ProcessSnapshot
} from '../../plugins/os-vitals/src/processes.ts'
import type { ProcessQuery, ProcessRow } from '../../plugins/os-vitals/src/protocol.ts'
import { fixture } from './helpers.ts'

const T = 1_700_000_000_000

function snapshots() {
  const tracker = createProcessTracker()
  const first = tracker.update(parsePs(fixture('darwin/ps.txt')), T)
  const later = tracker.update(parsePs(fixture('darwin/ps-later.txt')), T + 2000)
  return { first, later }
}

const cpuOf = (snapshot: ProcessSnapshot, pid: number) =>
  snapshot.rows.find((row) => row.pid === pid)?.cpu

test('the first reading uses ps %cpu', () => {
  const { first } = snapshots()
  assert.equal(cpuOf(first, 397), 32.2)
  assert.equal(cpuOf(first, 2291), 12.5)
  assert.equal(first.rows.find((row) => row.pid === 1)?.name, 'launchd')
})

test('later readings use the CPU time used since the last reading', () => {
  const { later } = snapshots()
  assert.equal(cpuOf(later, 1), 1)
  assert.equal(cpuOf(later, 325), 10)
  assert.equal(cpuOf(later, 397), 40)
  assert.equal(cpuOf(later, 401), 0)
  assert.equal(cpuOf(later, 2291), 120)
})

test('a process that exits leaves, and a new one starts from ps %cpu', () => {
  const { later } = snapshots()
  assert.equal(
    later.rows.some((row) => row.pid === 879),
    false
  )
  assert.equal(cpuOf(later, 50001), 80)
})

test('a reused PID is a new process, not a jump in CPU time', () => {
  const { later } = snapshots()
  const node = later.rows.find((row) => row.pid === 25251)
  assert.equal(node?.cpu, 45)
  assert.equal(node?.cpuTime, 1.2)
})

test('after a long gap, ps %cpu is used again', () => {
  const tracker = createProcessTracker()
  tracker.update(parsePs(fixture('darwin/ps.txt')), T)
  const late = tracker.update(parsePs(fixture('darwin/ps-later.txt')), T + 60000)
  assert.equal(cpuOf(late, 397), 31)
})

test('a query is read defensively', () => {
  assert.equal(readQuery(null), null)
  assert.equal(readQuery([]), null)
  assert.deepEqual(readQuery({}), {
    sort: 'cpu',
    direction: 'desc',
    filter: '',
    limit: PAGE_SIZE,
    offset: 0
  })
  assert.deepEqual(readQuery({ sort: 'name' }), {
    sort: 'name',
    direction: 'asc',
    filter: '',
    limit: PAGE_SIZE,
    offset: 0
  })
  assert.deepEqual(
    readQuery({
      sort: 'evil',
      direction: 'up',
      filter: `  ${'x'.repeat(300)} `,
      limit: 99999,
      offset: -5
    }),
    { sort: 'cpu', direction: 'desc', filter: 'x'.repeat(128), limit: 1000, offset: 0 }
  )
  assert.equal(readQuery({ limit: 2.5 })?.limit, PAGE_SIZE)
})

const row = (pid: number, name: string, cpu: number, memory: number): ProcessRow => ({
  pid,
  ppid: 1,
  uid: 501,
  user: 'user',
  name,
  path: `/opt/tools/${name}`,
  cpu,
  memory,
  cpuTime: 0,
  startedAt: 0,
  start: 'Tue Nov 17 10:00:00 2026'
})

const SNAPSHOT: ProcessSnapshot = {
  t: T,
  rows: [
    row(300, 'node', 5, 400),
    row(42, 'Finder', 1, 200),
    row(7, 'zsh', 5, 10),
    row(3001, 'node', 0.5, 900),
    row(18, 'example', 30, 50)
  ]
}

const query = (overrides: Partial<ProcessQuery> = {}): ProcessQuery => ({
  sort: 'cpu',
  direction: 'desc',
  filter: '',
  limit: 100,
  offset: 0,
  ...overrides
})

const pids = (q: ProcessQuery) => queryProcesses(SNAPSHOT, q).rows.map((entry) => entry.pid)

test('sorting by each column, with ties broken by PID', () => {
  assert.deepEqual(pids(query()), [18, 7, 300, 42, 3001])
  assert.deepEqual(pids(query({ direction: 'asc' })), [3001, 42, 7, 300, 18])
  assert.deepEqual(pids(query({ sort: 'memory' })), [3001, 300, 42, 18, 7])
  assert.deepEqual(pids(query({ sort: 'pid', direction: 'asc' })), [7, 18, 42, 300, 3001])
  assert.deepEqual(pids(query({ sort: 'name', direction: 'asc' })), [18, 42, 300, 3001, 7])
  assert.deepEqual(pids(query({ sort: 'name', direction: 'desc' })), [7, 300, 3001, 42, 18])
})

test('the filter matches names without case, and PIDs from their start', () => {
  assert.deepEqual(pids(query({ filter: 'NODE' })), [300, 3001])
  assert.deepEqual(pids(query({ filter: '30' })), [300, 3001])
  assert.deepEqual(pids(query({ filter: '4' })), [42])
  assert.equal(matches(row(1, 'x', 0, 0), ''), true)
  const none = queryProcesses(SNAPSHOT, query({ filter: 'nothing' }))
  assert.deepEqual(none.rows, [])
  assert.equal(none.matched, 0)
  assert.equal(none.total, 5)
})

test('paging returns the slice, the total and how many matched', () => {
  const page = queryProcesses(SNAPSHOT, query({ limit: 2, offset: 1 }))
  assert.deepEqual(
    page.rows.map((entry) => entry.pid),
    [7, 300]
  )
  assert.equal(page.total, 5)
  assert.equal(page.matched, 5)
  assert.equal(page.offset, 1)
  assert.equal(page.sampledAt, T)
  assert.deepEqual(queryProcesses(SNAPSHOT, query({ offset: 10 })).rows, [])
})
