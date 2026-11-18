import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  calibrateTicks,
  DEFAULT_TICKS,
  isKernelThread,
  parsePasswd,
  parseProcStat,
  parseProcStatus,
  parseUptime,
  procName
} from '../../plugins/os-vitals/src/parse/linux-proc.ts'
import { fixturePath } from './linux-files.ts'

const file = (tree: string, path: string) =>
  readFileSync(fixturePath(tree, path), 'utf8').replace(/\\0/g, '\0')

test('stat is read by the last closing parenthesis, so a name with ") (" does not shift fields', () => {
  const stat = parseProcStat(file('host', 'proc/2500/stat'))
  assert.ok(stat)
  assert.equal(stat.comm, 'weird) (name')
  assert.equal(stat.ppid, 1500)
  assert.equal(stat.utime, 10)
  assert.equal(stat.stime, 5)
  assert.equal(stat.starttime, 8100000)
  assert.equal(stat.state, 'S')
})

test('a real container stat line gives its start time and threads', () => {
  const stat = parseProcStat(file('container', 'proc/1/stat'))
  assert.ok(stat)
  assert.equal(stat.comm, 'MainThread')
  assert.equal(stat.pid, 1)
  assert.equal(stat.ppid, 0)
  assert.equal(stat.starttime, 8783)
  assert.equal(stat.rssPages, 11696)
  assert.equal(isKernelThread(stat), false)
})

test('kernel threads are recognised by their flag', () => {
  const kthreadd = parseProcStat(file('host', 'proc/2/stat'))
  const worker = parseProcStat(file('host', 'proc/45/stat'))
  assert.ok(kthreadd && worker)
  assert.equal(isKernelThread(kthreadd), true)
  assert.equal(isKernelThread(worker), true)
  assert.equal(worker.comm, 'kworker/u8:3-events_unbound')
})

test('broken stat lines are rejected', () => {
  assert.equal(parseProcStat(''), null)
  assert.equal(parseProcStat('12 (sh S 1 2'), null)
  assert.equal(parseProcStat('abc (sh) S 1 2 3'), null)
  assert.equal(parseProcStat('12 (sh) S 1 2 3'), null)
})

test('status gives the real uid, the resident size and the thread count', () => {
  assert.deepEqual(parseProcStatus(file('host', 'proc/2400/status')), {
    name: 'MainThread',
    uid: 1000,
    rssBytes: 210000 * 1024,
    threads: 11
  })
  const kernel = parseProcStatus(file('host', 'proc/2/status'))
  assert.equal(kernel.rssBytes, null)
  assert.equal(kernel.uid, 0)
})

test('the name is the base name of the first argument, not MainThread or a cut comm', () => {
  assert.deepEqual(procName(file('host', 'proc/2400/cmdline'), 'MainThread'), {
    name: 'node',
    path: '',
    command: 'node server.js --port 5173'
  })
  assert.equal(
    procName(file('host', 'proc/2600/cmdline'), 'chromium-browse').name,
    'chromium-browser'
  )
  assert.equal(procName(file('host', 'proc/812/cmdline'), 'sshd').path, '/usr/sbin/sshd')
  assert.equal(procName(file('host', 'proc/2500/cmdline'), 'weird) (name').name, 'weird) (name')
  assert.equal(
    procName(file('host', 'proc/2700/cmdline'), 'postgres').name,
    'postgres: checkpointer'
  )
})

test('a kernel thread or zombie with no command line keeps its comm', () => {
  assert.deepEqual(procName('', 'kworker/u8:3-events_unbound'), {
    name: 'kworker/u8:3-events_unbound',
    path: '',
    command: '[kworker/u8:3-events_unbound]'
  })
})

test('BusyBox applets under Alpine are named by the applet, not by busybox', () => {
  assert.equal(procName(file('alpine', 'proc/7/cmdline'), 'sh').name, 'sh')
  assert.equal(procName(file('alpine', 'proc/7/cmdline'), 'sh').command, '/bin/sh -c sleep 3600')
  assert.equal(procName(file('alpine', 'proc/8/cmdline'), 'sleep').name, 'sleep')
})

test('the clock tick rate is calibrated from the start time and the uptime', () => {
  assert.equal(calibrateTicks(8783, 87.87, 0.1), 100)
  assert.equal(calibrateTicks(11282, 112.86, 0.05), 100)
  assert.equal(calibrateTicks(9178421, 93784.21, 2000), 100)
  assert.equal(calibrateTicks(250 * 5000, 5010, 10), 250)
  assert.equal(calibrateTicks(1000 * 4000, 4002, 2), 1000)
})

test('a rate that matches nothing, or a machine that just booted, falls back to 100', () => {
  assert.equal(calibrateTicks(700 * 100, 101, 1), DEFAULT_TICKS)
  assert.equal(calibrateTicks(50, 1.2, 0.1), DEFAULT_TICKS)
  assert.equal(calibrateTicks(0, 500, 1), DEFAULT_TICKS)
  assert.equal(calibrateTicks(9000, 100, 200), DEFAULT_TICKS)
})

test('uptime and passwd', () => {
  assert.equal(parseUptime(file('host', 'proc/uptime')), 93784.21)
  assert.equal(parseUptime('garbage'), null)
  const users = parsePasswd(file('host', 'etc/passwd'))
  assert.equal(users.get(0), 'root')
  assert.equal(users.get(1000), 'user')
  assert.equal(users.get(70), 'postgres')
  assert.equal(users.get(5), undefined)
})
