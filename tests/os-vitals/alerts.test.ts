import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ALERT_TITLE,
  alertBody,
  createAlerts,
  CPU_HOLD_MS,
  MEMORY_HOLD_MS,
  MEMORY_QUIET_MS,
  type AlertNotice
} from '../../plugins/os-vitals/src/alerts.ts'
import type { MemoryReading, Sample } from '../../plugins/os-vitals/src/protocol.ts'
import { DEFAULT_SETTINGS } from '../../plugins/os-vitals/src/settings.ts'
import { statusView } from '../../plugins/os-vitals/src/status.ts'

const GB = 1024 ** 3

function memory(share: number, pressure: MemoryReading['pressure'] = 'normal'): MemoryReading {
  const total = 48 * GB
  return {
    total,
    used: (total * share) / 100,
    app: null,
    wired: null,
    compressed: null,
    buffers: null,
    cached: null,
    free: total * (1 - share / 100),
    swapUsed: null,
    swapTotal: null,
    pressure
  }
}

function sample(
  t: number,
  share: number,
  cpu = 10,
  pressure: MemoryReading['pressure'] = 'normal'
): Sample {
  return {
    seq: t,
    t,
    total: cpu,
    user: cpu,
    system: 0,
    cores: null,
    memory: memory(share, pressure),
    net: null,
    disk: null,
    gpu: null
  }
}

function setup(options: { failNotify?: boolean; failTop?: boolean } = {}) {
  const notices: AlertNotice[] = []
  let tops = 0
  let changes = 0
  const alerts = createAlerts({
    async topProcess() {
      tops += 1
      if (options.failTop) throw new Error('ps failed')
      return { name: 'qemu-system-aarch64', memory: 9.65 * GB }
    },
    async notify(notice) {
      notices.push(notice)
      if (options.failNotify) throw new Error('not enabled with current consent')
    },
    onChange: () => {
      changes += 1
    }
  })
  return { alerts, notices, tops: () => tops, changes: () => changes }
}

const settings = DEFAULT_SETTINGS

async function feed(
  alerts: ReturnType<typeof setup>['alerts'],
  from: number,
  to: number,
  share: number,
  step = 5000,
  cpu = 10,
  given = settings
) {
  for (let t = from; t <= to; t += step) alerts.observe(sample(t, share, cpu), given)
  await alerts.idle()
}

test('memory above the limit for 30 s sends one notification naming the top process', async () => {
  const { alerts, notices, tops } = setup()
  await feed(alerts, 0, MEMORY_HOLD_MS - 5000, 96)
  assert.deepEqual(notices, [])
  assert.equal(alerts.status().tone, 'warning')
  await feed(alerts, MEMORY_HOLD_MS, MEMORY_HOLD_MS, 96)
  assert.deepEqual(notices, [
    { title: ALERT_TITLE, body: '96% of memory is in use. qemu-system-aarch64 is using 9.65 GB.' }
  ])
  assert.equal(tops(), 1)
  assert.equal(alerts.status().tone, 'danger')
  assert.match(alerts.status().reasons[0], /96% for over 30 seconds/)
})

test('after a notification the memory alert stays silent for 10 minutes', async () => {
  const { alerts, notices } = setup()
  await feed(alerts, 0, MEMORY_HOLD_MS, 96)
  await feed(alerts, MEMORY_HOLD_MS + 5000, MEMORY_HOLD_MS + 60_000, 50)
  await feed(alerts, MEMORY_HOLD_MS + 65_000, MEMORY_QUIET_MS, 97)
  assert.equal(notices.length, 1)
  await feed(alerts, MEMORY_QUIET_MS + 5000, MEMORY_QUIET_MS + MEMORY_HOLD_MS + 10_000, 97)
  assert.equal(notices.length, 2)
})

test('a dip below the limit restarts the 30 s count', async () => {
  const { alerts, notices } = setup()
  await feed(alerts, 0, 20_000, 96)
  alerts.observe(sample(25_000, 60), settings)
  await feed(alerts, 30_000, 50_000, 96)
  assert.deepEqual(notices, [])
  await feed(alerts, 55_000, 60_000, 96)
  assert.equal(notices.length, 1)
})

test('critical pressure alerts even below the percentage limit', async () => {
  const { alerts, notices } = setup()
  for (let t = 0; t <= MEMORY_HOLD_MS; t += 5000) {
    alerts.observe(sample(t, 70, 10, 'critical'), settings)
  }
  await alerts.idle()
  assert.equal(notices.length, 1)
  assert.match(alerts.status().reasons[0], /pressure is critical/)
})

test('elevated pressure only tints the status bar', async () => {
  const { alerts, notices } = setup()
  for (let t = 0; t <= 60_000; t += 5000) alerts.observe(sample(t, 60, 10, 'warning'), settings)
  await alerts.idle()
  assert.deepEqual(notices, [])
  assert.deepEqual(alerts.status(), { tone: 'warning', reasons: ['Memory pressure is elevated'] })
})

test('with the memory alert off nothing is sent and the tone stays neutral', async () => {
  const { alerts, notices } = setup()
  await feed(alerts, 0, 120_000, 99, 5000, 10, { ...settings, memoryAlert: false })
  assert.deepEqual(notices, [])
  assert.deepEqual(alerts.status(), { tone: 'neutral', reasons: [] })
})

test('a refused notification is not retried, and the alerts keep working', async () => {
  const { alerts, notices } = setup({ failNotify: true })
  await feed(alerts, 0, MEMORY_QUIET_MS - 5000, 96)
  assert.equal(notices.length, 1)
  assert.equal(alerts.status().tone, 'danger')
  await feed(alerts, MEMORY_QUIET_MS, MEMORY_QUIET_MS + 60_000, 50)
  assert.equal(alerts.status().tone, 'neutral')
})

test('without a process list the notification gives only the percentage', async () => {
  const { alerts, notices } = setup({ failTop: true })
  await feed(alerts, 0, MEMORY_HOLD_MS, 93)
  assert.deepEqual(notices, [{ title: ALERT_TITLE, body: '93% of memory is in use.' }])
})

test('the CPU alert is off by default, and when on it only tints the status bar after a minute', async () => {
  const off = setup()
  await feed(off.alerts, 0, 120_000, 40, 5000, 99)
  assert.equal(off.alerts.status().tone, 'neutral')
  const on = setup()
  const cpuOn = { ...settings, cpuAlert: true, cpuAlertPercent: 90 }
  await feed(on.alerts, 0, CPU_HOLD_MS - 5000, 40, 5000, 95, cpuOn)
  assert.equal(on.alerts.status().tone, 'neutral')
  await feed(on.alerts, CPU_HOLD_MS, CPU_HOLD_MS, 40, 5000, 95, cpuOn)
  assert.deepEqual(on.alerts.status(), {
    tone: 'warning',
    reasons: ['CPU has been above 90% for a minute']
  })
  assert.deepEqual(on.notices, [])
  assert.equal(on.changes(), 1)
})

test('a gap in the readings restarts the counts', async () => {
  const { alerts, notices } = setup()
  await feed(alerts, 0, 25_000, 96)
  await feed(alerts, 60_000, 80_000, 96)
  assert.deepEqual(notices, [])
})

test('the status bar keeps its text and takes the tone and reasons of the alert', () => {
  const view = statusView('cpu-memory', {
    cpu: 41,
    memory: memory(96),
    load: null,
    alert: { tone: 'danger', reasons: ['Memory has been at 96% for over 30 seconds'] }
  })
  assert.deepEqual(view, {
    text: 'CPU 41% · MEM 96%',
    tone: 'danger',
    tooltip:
      'OS Vitals\nMemory has been at 96% for over 30 seconds\nMemory 46.1 of 48 GB, pressure normal'
  })
  assert.equal(alertBody(memory(95.6), null), '96% of memory is in use.')
})
