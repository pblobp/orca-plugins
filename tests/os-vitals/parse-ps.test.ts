import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  START_TOKEN,
  countThreads,
  parseCpuTime,
  parseDetail,
  parseIdentity,
  parseLstart,
  parsePs,
  parsePsLine,
  normalizeStart,
  processName
} from '../../plugins/os-vitals/src/parse/ps.ts'
import { fixture } from './helpers.ts'

const local = (year: number, month: number, day: number, h: number, m: number, s: number) =>
  new Date(year, month, day, h, m, s).getTime()

test('CPU time reads with and without hours and days', () => {
  assert.equal(parseCpuTime('20:32.51'), 1232.51)
  assert.equal(parseCpuTime('204:47.11'), 12287.11)
  assert.equal(parseCpuTime('0:00.10'), 0.1)
  assert.equal(parseCpuTime('01:02:03'), 3723)
  assert.equal(parseCpuTime('1:02:03.50'), 3723.5)
  assert.equal(parseCpuTime('2-01:02:03'), 2 * 86400 + 3723)
  assert.equal(parseCpuTime('45'), 45)
  assert.equal(parseCpuTime('1:2:3:4'), null)
  assert.equal(parseCpuTime('abc'), null)
  assert.equal(parseCpuTime(''), null)
})

test('the start time is five tokens, read as local time', () => {
  assert.equal(parseLstart('Sat Nov 14 20:37:20 2026'), local(2026, 10, 14, 20, 37, 20))
  assert.equal(parseLstart('Mon Nov  2 09:05:07 2026'), local(2026, 10, 2, 9, 5, 7))
  assert.equal(parseLstart('Sat Nov 14 20:37:20'), null)
  assert.equal(parseLstart('Sat Foo 14 20:37:20 2026'), null)
})

test('a process name is the last part of an executable path, spaces kept', () => {
  assert.equal(processName('/sbin/launchd'), 'launchd')
  assert.equal(
    processName('/Applications/Example App.app/Contents/MacOS/Example App Helper (Renderer)'),
    'Example App Helper (Renderer)'
  )
  assert.equal(processName('cloudphotod'), 'cloudphotod')
  assert.equal(processName('(sh)'), '(sh)')
})

test('ps output parses every complete line and skips the rest', () => {
  const processes = parsePs(fixture('darwin/ps.txt'))
  assert.equal(processes.length, 11)
  assert.deepEqual(processes[0], {
    pid: 1,
    ppid: 0,
    uid: 0,
    pcpu: 0.1,
    rss: 26512 * 1024,
    cpuTime: 1232.51,
    startedAt: local(2026, 10, 14, 20, 37, 20),
    start: 'Sat Nov 14 20:37:20 2026',
    user: 'root',
    comm: '/sbin/launchd'
  })
  assert.equal(processes.find((p) => p.pid === 397)?.cpuTime, 12287.11)
  assert.equal(processes.find((p) => p.pid === 879)?.comm, 'cloudphotod')
  assert.equal(
    processes.some((p) => p.pid === 41000),
    false
  )
})

test('a command name with spaces and parentheses is kept whole', () => {
  const helper = parsePs(fixture('darwin/ps.txt')).find((p) => p.pid === 2291)
  assert.equal(
    helper?.comm,
    '/Applications/Example App.app/Contents/Frameworks/Example App Helper (Renderer).app/Contents/MacOS/Example App Helper (Renderer)'
  )
  assert.equal(helper?.ppid, 36701)
  assert.equal(helper?.pcpu, 12.5)
})

test('a deleted user shows as a number, and a one-digit day keeps its padding', () => {
  const agent = parsePs(fixture('darwin/ps.txt')).find((p) => p.pid === 990)
  assert.equal(agent?.user, '502')
  assert.equal(agent?.uid, 502)
  assert.equal(agent?.startedAt, local(2026, 10, 2, 9, 5, 7))
})

test('lines with missing or broken columns are skipped', () => {
  assert.equal(parsePsLine('41000     1   501'), null)
  assert.equal(parsePsLine(''), null)
  assert.equal(
    parsePsLine('  1  0  0  0.1  26512  bad-time Sat Nov 14 20:37:20 2026  root  /sbin/launchd'),
    null
  )
  assert.equal(parsePsLine('  1  0  0  0.1  26512  0:01.00 Sat Nov 14 20:37:20 2026  root'), null)
})

test('details carry the whole command line and the thread count', () => {
  const detail = parseDetail(fixture('darwin/ps-detail.txt'), fixture('darwin/ps-threads.txt'))
  assert.ok(detail)
  assert.equal(detail.pid, 25251)
  assert.equal(
    detail.command,
    '/Users/user/.nvm/versions/node/v24.22.1/bin/node /Users/user/project/node_modules/.bin/vite --port 5173'
  )
  assert.equal(detail.threads, 4)
  assert.equal(parseDetail(fixture('darwin/ps-detail.txt'), null)?.threads, null)
  assert.equal(parseDetail('', null), null)
  assert.equal(countThreads('no header\nline'), null)
  assert.equal(countThreads(''), null)
})

test('the start token is the ps start time with single spaces, and only that form is accepted', () => {
  assert.equal(normalizeStart(' Mon Nov  2 09:05:07 2026 '), 'Mon Nov 2 09:05:07 2026')
  assert.equal(
    parsePs(fixture('darwin/ps.txt')).find((p) => p.pid === 990)?.start,
    'Mon Nov 2 09:05:07 2026'
  )
  assert.ok(START_TOKEN.test('Mon Nov 2 09:05:07 2026'))
  assert.ok(START_TOKEN.test('Sat Nov 14 20:37:20 2026'))
  assert.equal(START_TOKEN.test('Mon Nov  2 09:05:07 2026'), false)
  assert.equal(START_TOKEN.test('2026-11-02T09:05:07Z'), false)
  assert.equal(START_TOKEN.test('Mon Nov 2 09:05:07 2026; rm -rf /'), false)
})

test('re-identification reads one start time, owner and command', () => {
  assert.deepEqual(parseIdentity(fixture('darwin/ps-identity.txt')), {
    start: 'Tue Nov 17 10:00:00 2026',
    uid: 501,
    path: '/Applications/Example App.app/Contents/MacOS/Example App',
    name: 'Example App'
  })
  assert.equal(parseIdentity(''), null)
  assert.equal(parseIdentity('Tue Nov 17 10:00:00 2026'), null)
  assert.equal(parseIdentity('Tue Foo 17 10:00:00 2026   501 /bin/sleep'), null)
})
