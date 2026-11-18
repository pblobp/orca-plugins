import { queryProcesses, readQuery, withOffers } from '../../plugins/os-vitals/src/processes.ts'
import { createOfferer, readQuitInput } from '../../plugins/os-vitals/src/quit.ts'
import type {
  BatteryReading,
  CoreInfo,
  DetailResult,
  EnergyReading,
  GpuReading,
  HelloResult,
  LoadAverage,
  MemoryReading,
  NetworkReading,
  PollInput,
  PollResult,
  ProcessRow,
  QuitResult,
  Sample,
  Sections,
  Volume
} from '../../plugins/os-vitals/src/protocol.ts'

type Scenario =
  | 'normal'
  | 'loading'
  | 'error'
  | 'unsupported'
  | 'windows'
  | 'flaky'
  | 'empty'
  | 'pressure'
  | 'desktop'
  | 'nogpu'
  | 'fresh'
  | 'spike'
  | 'linux'
type Theme = 'dark' | 'light'
type Handler = (payload: unknown) => unknown

const SCENARIOS: readonly Scenario[] = [
  'normal',
  'loading',
  'error',
  'unsupported',
  'windows',
  'flaky',
  'empty',
  'pressure',
  'desktop',
  'nogpu',
  'fresh',
  'spike',
  'linux'
]
const VIEWS = ['overview', 'processes', 'cpu', 'memory', 'network', 'disk', 'gpu', 'energy']

const THEMES: Record<Theme, Record<string, string>> = {
  dark: {
    '--orca-background': '#0a0a0a',
    '--orca-foreground': '#f0f0f0',
    '--orca-card': '#171717',
    '--orca-card-foreground': '#f0f0f0',
    '--orca-popover': '#171717',
    '--orca-popover-foreground': '#f0f0f0',
    '--orca-primary': '#e5e5e5',
    '--orca-primary-foreground': '#171717',
    '--orca-secondary': '#262626',
    '--orca-secondary-foreground': '#f0f0f0',
    '--orca-muted': '#262626',
    '--orca-muted-foreground': '#acacac',
    '--orca-accent': '#404040',
    '--orca-accent-foreground': '#f0f0f0',
    '--orca-destructive': '#e05252',
    '--orca-destructive-foreground': '#ffffff',
    '--orca-border': '#ffffff12',
    '--orca-input': '#ffffff26',
    '--orca-ring': '#3987e5',
    '--orca-radius': '8px'
  },
  light: {
    '--orca-background': '#ffffff',
    '--orca-foreground': '#0a0a0a',
    '--orca-card': '#ffffff',
    '--orca-card-foreground': '#0a0a0a',
    '--orca-popover': '#ffffff',
    '--orca-popover-foreground': '#0a0a0a',
    '--orca-primary': '#171717',
    '--orca-primary-foreground': '#fafafa',
    '--orca-secondary': '#f5f5f5',
    '--orca-secondary-foreground': '#171717',
    '--orca-muted': '#f5f5f5',
    '--orca-muted-foreground': '#696969',
    '--orca-accent': '#f5f5f5',
    '--orca-accent-foreground': '#171717',
    '--orca-destructive': '#d03b3b',
    '--orca-destructive-foreground': '#ffffff',
    '--orca-border': '#e5e5e5',
    '--orca-input': '#e5e5e5',
    '--orca-ring': '#2a78d6',
    '--orca-radius': '8px'
  }
}

const params = new URLSearchParams(location.search)
const scenario: Scenario = SCENARIOS.find((name) => name === params.get('scenario')) ?? 'normal'
const requestedView = VIEWS.find((name) => name === params.get('view')) ?? null
const frameStorage = new Map<string, string>()
if (requestedView) frameStorage.set('os-vitals.view', requestedView)
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => frameStorage.get(key) ?? null,
    setItem: (key: string, value: string) => frameStorage.set(key, String(value)),
    removeItem: (key: string) => frameStorage.delete(key),
    clear: () => frameStorage.clear(),
    key: (index: number) => [...frameStorage.keys()][index] ?? null,
    get length() {
      return frameStorage.size
    }
  }
})
let theme: Theme = params.get('theme') === 'light' ? 'light' : 'dark'
const listeners = new Map<string, Set<Handler>>()

function applyTheme(next: Theme): void {
  theme = next
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(next)
  for (const [name, value] of Object.entries(THEMES[next])) root.style.setProperty(name, value)
}

function emit(event: string, payload: unknown): void {
  for (const handler of listeners.get(event) ?? []) handler(payload)
}

function hostError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code, retryable: code === 'timeout' })
}

function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

const windows = scenario === 'windows'
const linux = scenario === 'linux'
const CORE_COUNT = windows ? 8 : linux ? 16 : 14
const STEP_MS = 2000
const HISTORY_MS = 5 * 60 * 1000
const GB = 1024 ** 3
const MB = 1024 ** 2
const run = `harness-${Date.now().toString(36)}`
const startedAt = Date.now() - (scenario === 'empty' ? 0 : HISTORY_MS)
const next = random(11)
const samples: Sample[] = []
let user = 18
let system = 6
let down = 2.2 * MB
let up = 300 * 1024
let read = 9 * MB
let write = 3 * MB
let gpuUse = 24
const activeFrom = scenario === 'fresh' ? Date.now() - 40 * 1000 : startedAt
const hasGpu = scenario !== 'nogpu' && !windows
const hasBattery = scenario !== 'desktop' && !windows
const coreLoad = Array.from({ length: CORE_COUNT }, (_, index) => Math.max(4, 62 - index * 4))
let polls = 0

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const round1 = (value: number) => Math.round(value * 10) / 10

function memoryReading(): MemoryReading {
  const total = (windows ? 16 : linux ? 32 : 48) * GB
  if (linux) {
    const used = 11.6 * GB + next() * 0.2 * GB
    return {
      total,
      used,
      app: null,
      wired: null,
      compressed: null,
      buffers: 0.4 * GB,
      cached: 9.8 * GB,
      free: total - used - 10.2 * GB - 1.1 * GB,
      swapUsed: 1 * GB,
      swapTotal: 8 * GB,
      pressure: 'normal'
    }
  }
  if (windows) {
    const used = 9.7 * GB + next() * 0.2 * GB
    return {
      total,
      used,
      app: null,
      wired: null,
      compressed: null,
      buffers: null,
      cached: null,
      free: total - used,
      swapUsed: null,
      swapTotal: null,
      pressure: null
    }
  }
  const critical = scenario === 'pressure'
  const app = (critical ? 39.5 : 18.4) * GB + next() * 0.1 * GB
  const wired = 4.1 * GB
  const compressed = (critical ? 2.9 : 2.2) * GB
  const used = app + wired + compressed
  const cached = Math.min(total - used, 6.5 * GB)
  return {
    total,
    used,
    app,
    wired,
    compressed,
    buffers: null,
    cached,
    free: total - used - cached,
    swapUsed: (critical ? 3.4 : 1.2) * GB,
    swapTotal: 4 * GB,
    pressure: critical ? 'critical' : 'normal'
  }
}

const SYSTEM = '/System/Library/CoreServices'
const ORCA_APP = '/Applications/Orca.app/Contents'

const neutral = params.get('neutral') === '1'

const NEUTRAL_NAMES = [
  ['video-encoder', 115.6, 9.18 * GB, '/usr/local/bin/video-encoder'],
  ['window-compositor', 20.8, 1.02 * GB, '/usr/libexec/window-compositor'],
  ['audio-service', 10.4, 34 * MB, '/usr/sbin/audio-service'],
  ['vm-runner', 9.1, 9.65 * GB, '/usr/local/bin/vm-runner'],
  ['web-browser', 6.2, 553 * MB, '/Applications/Web Browser.app/Contents/MacOS/web-browser'],
  ['node', 5.4, 412 * MB, '/Users/user/.local/bin/node'],
  ['code-editor', 3.1, 388 * MB, '/Applications/Code Editor.app/Contents/MacOS/code-editor'],
  ['music-player', 2.8, 301 * MB, '/Applications/Music Player.app/Contents/MacOS/music-player'],
  ['agent', 2.4, 624 * MB, '/Users/user/.local/bin/agent'],
  ['container-backend', 1.9, 212 * MB, '/usr/local/bin/container-backend'],
  ['postgres', 1.2, 96 * MB, '/usr/local/bin/postgres'],
  ['search-indexer', 0.9, 148 * MB, '/usr/libexec/search-indexer'],
  ['photo-library', 0.8, 276 * MB, '/Applications/Photo Library.app/Contents/MacOS/photo-library'],
  ['tsc', 0.6, 512 * MB, '/Users/user/project/node_modules/.bin/tsc'],
  ['gpu-helper', 0.5, 164 * MB, '/usr/libexec/gpu-helper'],
  ['file-manager', 0.4, 187 * MB, '/usr/libexec/file-manager'],
  ['watchman', 0.2, 71 * MB, '/usr/local/bin/watchman'],
  ['zsh', 0.1, 6 * MB, '/bin/zsh'],
  ['launchd', 0.1, 22 * MB, '/sbin/launchd'],
  ['cfprefsd', 0, 9 * MB, '/usr/sbin/cfprefsd'],
  ['ssh-agent', 0, 4 * MB, '/usr/bin/ssh-agent'],
  ['dock', 0.3, 64 * MB, '/usr/libexec/dock'],
  ['loginwindow', 0.2, 80 * MB, '/usr/libexec/loginwindow'],
  ['vite', 1.4, 210 * MB, '/Users/user/project/node_modules/.bin/vite']
] as const

const SAMPLE_NAMES = [
  ['qemu-system-aarch64', 115.6, 9.18 * GB, '/opt/homebrew/bin/qemu-system-aarch64'],
  [
    'WindowServer',
    20.8,
    1.02 * GB,
    '/System/Library/PrivateFrameworks/SkyLight.framework/Resources/WindowServer'
  ],
  ['coreaudiod', 10.4, 34 * MB, '/usr/sbin/coreaudiod'],
  ['qemu-system-aarch64', 9.1, 9.65 * GB, '/opt/homebrew/bin/qemu-system-aarch64'],
  [
    'Orca Helper (Renderer)',
    6.2,
    553 * MB,
    `${ORCA_APP}/Frameworks/Orca Helper (Renderer).app/Contents/MacOS/Orca Helper (Renderer)`
  ],
  ['node', 5.4, 412 * MB, '/Users/user/.nvm/versions/node/v24.22.1/bin/node'],
  [
    'Example Browser Helper (Renderer)',
    3.1,
    388 * MB,
    '/Applications/Example Browser.app/Contents/MacOS/Example Browser Helper (Renderer)'
  ],
  ['Orca', 2.8, 301 * MB, `${ORCA_APP}/MacOS/Orca`],
  ['agent', 2.4, 624 * MB, '/Users/user/.local/bin/agent'],
  ['container-backend', 1.9, 212 * MB, '/usr/local/bin/container-backend'],
  ['postgres', 1.2, 96 * MB, '/opt/homebrew/bin/postgres'],
  ['mds_stores', 0.9, 148 * MB, '/System/Library/Frameworks/CoreServices.framework/mds_stores'],
  ['Simulator', 0.8, 276 * MB, '/Applications/Simulator.app/Contents/MacOS/Simulator'],
  ['tsc', 0.6, 512 * MB, '/Users/user/project/node_modules/.bin/tsc'],
  [
    'Orca Helper (GPU)',
    0.5,
    164 * MB,
    `${ORCA_APP}/Frameworks/Orca Helper (GPU).app/Contents/MacOS/Orca Helper (GPU)`
  ],
  ['Finder', 0.4, 187 * MB, `${SYSTEM}/Finder.app/Contents/MacOS/Finder`],
  ['watchman', 0.2, 71 * MB, '/opt/homebrew/bin/watchman'],
  ['zsh', 0.1, 6 * MB, '/bin/zsh'],
  ['launchd', 0.1, 22 * MB, '/sbin/launchd'],
  ['cfprefsd', 0, 9 * MB, '/usr/sbin/cfprefsd'],
  ['ssh-agent', 0, 4 * MB, '/usr/bin/ssh-agent'],
  ['Dock', 0.3, 64 * MB, `${SYSTEM}/Dock.app/Contents/MacOS/Dock`],
  ['loginwindow', 0.2, 80 * MB, `${SYSTEM}/loginwindow.app/Contents/MacOS/loginwindow`],
  ['vite', 1.4, 210 * MB, '/Users/user/project/node_modules/.bin/vite']
] as const

const NAMES = neutral ? NEUTRAL_NAMES : SAMPLE_NAMES

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function startToken(ms: number): string {
  const date = new Date(Math.floor(ms / 1000) * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  return `${DAYS[date.getDay()]} ${MONTHS[date.getMonth()]} ${date.getDate()} ${time} ${date.getFullYear()}`
}

const PROCESS_TABLE: ProcessRow[] = [
  ...NAMES.map(([name, cpu, memory, path], index) => ({ name, cpu, memory, path, index })),
  ...Array.from({ length: 118 }, (_, index) => ({
    name: `helper-${String(index + 1).padStart(3, '0')}`,
    cpu: 0,
    memory: (2 + ((index * 37) % 60)) * MB,
    path: `/usr/local/libexec/helper-${String(index + 1).padStart(3, '0')}`,
    index: index + NAMES.length
  }))
].map((entry) => {
  const startedMs = Math.floor((Date.now() - (2 * 3600 + entry.index * 600) * 1000) / 1000) * 1000
  const other = entry.name === 'WindowServer' ? 88 : entry.name === 'postgres' ? 70 : 501
  return {
    pid: entry.name === 'launchd' ? 1 : 300 + entry.index * 431,
    ppid: entry.name === 'launchd' ? 0 : 1,
    uid: other,
    user: other === 88 ? '_windowserver' : other === 70 ? '_postgres' : 'user',
    name: entry.name,
    path: entry.path,
    cpu: entry.cpu,
    memory: entry.memory,
    cpuTime: 400 + entry.index * 97,
    startedAt: startedMs,
    start: startToken(startedMs)
  }
})

if (linux) {
  const bootMs = Math.floor((Date.now() - 3 * 86400 * 1000) / 1000) * 1000
  for (const [pid, name, cpu] of [
    [2, 'kthreadd', 0],
    [212, 'kworker/u16:2-events_unbound', 1.8],
    [87, 'ksoftirqd/3', 0.4]
  ] as const) {
    PROCESS_TABLE.push({
      pid,
      ppid: pid === 2 ? 0 : 2,
      uid: 0,
      user: 'root',
      name,
      path: '',
      cpu,
      memory: 0,
      cpuTime: 30,
      startedAt: bootMs,
      start: String(pid * 10),
      kernel: true
    })
  }
}

const ORCA_PID = PROCESS_TABLE.find((row) => row.name === 'Orca')?.pid ?? 2
const QUIT_CONTEXT = {
  uid: 501,
  selfPid: 99999,
  parentPid: ORCA_PID,
  bundle: '/Applications/Orca.app'
}
const removed = new Set<number>()
const offer = () => createOfferer(QUIT_CONTEXT, PROCESS_TABLE)

function liveTable(): ProcessRow[] {
  return PROCESS_TABLE.filter((row) => !removed.has(row.pid))
}

function processPage(input: PollInput): PollResult['processes'] {
  const query = readQuery(input.processes)
  if (!query || windows) return null
  const rows = liveTable().map((row) => ({
    ...row,
    cpu: row.cpu > 0 ? round1(clamp(row.cpu * (0.85 + next() * 0.3), 0, 400)) : 0,
    cpuTime: row.cpuTime + (Date.now() - startedAt) / 10000
  }))
  return withOffers(queryProcesses({ rows, t: Date.now() }, query), offer())
}

function detail(input: unknown): DetailResult {
  const pid = (input as { pid?: unknown } | null)?.pid
  const row = liveTable().find((entry) => entry.pid === pid)
  if (!row) return { found: false }
  const command =
    row.name === 'node'
      ? '/Users/user/.nvm/versions/node/v24.22.1/bin/node /Users/user/project/node_modules/.bin/vite --port 5173'
      : row.path
  return {
    found: true,
    process: {
      ...row,
      quit: offer()(row),
      parentName: row.ppid === 1 ? 'launchd' : null,
      command,
      threads: 23
    }
  }
}

function quitAnswer(input: unknown): QuitResult {
  const parsed = readQuitInput(input)
  if (!parsed) throw hostError('invalid_params', 'quit takes a pid, a start time and force')
  const row = liveTable().find((entry) => entry.pid === parsed.pid)
  if (!row) return { ok: false, reason: 'gone' }
  if (row.start !== parsed.startedAt) return { ok: false, reason: 'changed' }
  const verdict = offer()(row)
  if (verdict === 'not_owner') return { ok: false, reason: 'not_owner' }
  if (verdict !== 'allowed') return { ok: false, reason: 'protected' }
  if (row.name === 'tsc') return { ok: false, reason: 'changed' }
  if (row.name === 'agent') return { ok: false, reason: 'not_permitted' }
  if (row.name === 'watchman') return { ok: false, reason: 'gone' }
  if (row.name === 'vite' && !parsed.force) return { ok: true }
  window.setTimeout(drop, parsed.force ? 100 : 1000)
  function drop(): void {
    removed.add(parsed?.pid ?? 0)
  }
  return { ok: true }
}

function generateUntil(now: number): void {
  let t = samples.length > 0 ? samples[samples.length - 1].t + STEP_MS : startedAt + STEP_MS
  while (t <= now) {
    user = clamp(user + (next() - 0.5) * 9, 4, 70)
    system = clamp(system + (next() - 0.5) * 3, 1, 18)
    for (let index = 0; index < coreLoad.length; index++) {
      coreLoad[index] = clamp(coreLoad[index] + (next() - 0.5) * 18, 1, 99)
    }
    down = clamp(down * (0.8 + next() * 0.4) + (next() > 0.93 ? 3 * MB : 0), 40 * 1024, 5.5 * MB)
    up = clamp(up * (0.8 + next() * 0.4), 20 * 1024, 1.4 * MB)
    read = clamp(read * (0.75 + next() * 0.5) + (next() > 0.9 ? 12 * MB : 0), 200 * 1024, 30 * MB)
    write = clamp(write * (0.75 + next() * 0.5), 100 * 1024, 9 * MB)
    gpuUse = clamp(gpuUse + (next() - 0.5) * 10, 3, 72)
    const spike =
      scenario === 'spike' && Math.abs(t - (startedAt + HISTORY_MS * 0.55)) < STEP_MS * 2
    const active = t >= activeFrom && !windows
    samples.push({
      seq: samples.length + 1,
      t,
      total: round1(user + system),
      user: round1(user),
      system: round1(system),
      cores: coreLoad.map(round1),
      memory: memoryReading(),
      net: active ? { down: Math.round(spike ? 48 * MB : down), up: Math.round(up) } : null,
      disk:
        active && samples.length % 2 === 0
          ? { read: Math.round(read), write: Math.round(write) }
          : null,
      gpu: active && hasGpu && samples.length % 2 === 0 ? round1(gpuUse) : null
    })
    t += STEP_MS
  }
  const oldest = now - HISTORY_MS
  while (samples.length > 0 && samples[0].t < oldest) samples.shift()
}

function sections(): Sections {
  return {
    cpu: scenario !== 'unsupported',
    load: !windows,
    memory: true,
    processes: !windows,
    network: !windows,
    disk: !windows,
    gpu: hasGpu,
    battery: hasBattery,
    energy: !windows && !linux
  }
}

const VOLUMES: Volume[] = [
  {
    name: neutral ? 'System' : 'Macintosh HD',
    mount: '/',
    startup: true,
    total: 494 * GB,
    available: 119 * GB
  },
  {
    name: 'Backup Drive',
    mount: '/Volumes/Backup Drive',
    startup: false,
    total: 2 * 1024 * GB,
    available: 800 * GB
  }
]

const LINUX_VOLUMES: Volume[] = [
  { name: '/', mount: '/', startup: true, total: 476 * GB, available: 201 * GB },
  { name: '/home', mount: '/home', startup: false, total: 931 * GB, available: 412 * GB },
  { name: '/mnt/usb', mount: '/mnt/usb', startup: false, total: 58 * GB, available: 31 * GB }
]

function latestWith(pick: (sample: Sample) => unknown): Sample | null {
  for (let index = samples.length - 1; index >= 0; index--) {
    if (pick(samples[index]) !== null) return samples[index]
  }
  return null
}

function latest(): Sample | null {
  return samples[samples.length - 1] ?? null
}

function networkReading(now: number): NetworkReading | null {
  const sample = latest()
  if (windows || !sample?.net) return null
  const { down: rx, up: tx } = sample.net
  return {
    t: now,
    down: rx,
    up: tx,
    packetsIn: Math.round(rx / 1900),
    packetsOut: Math.round(tx / 360),
    received: 18.4 * GB + (now - startedAt) * 2000,
    sent: 2.1 * GB + (now - startedAt) * 300,
    defaultInterface: linux ? 'wlp2s0' : 'en0',
    interfaces: linux
      ? [
          { name: 'wlp2s0', kind: null, counted: true, down: rx, up: tx },
          { name: 'docker0', kind: 'bridge', counted: false, down: 225 * 1024, up: 1.1 * MB },
          { name: 'veth1a2b3c4', kind: 'virtual', counted: false, down: 220 * 1024, up: MB },
          { name: 'lo', kind: 'loopback', counted: false, down: 96 * 1024, up: 96 * 1024 }
        ]
      : [
          { name: 'en0', kind: null, counted: true, down: rx, up: tx },
          { name: 'bridge100', kind: 'bridge', counted: false, down: 225 * 1024, up: 1.1 * MB },
          { name: 'lo0', kind: 'loopback', counted: false, down: 96 * 1024, up: 96 * 1024 },
          { name: 'utun3', kind: 'tunnel', counted: false, down: 12 * 1024, up: 4 * 1024 }
        ]
  }
}

function diskReading(now: number): PollResult['disk'] {
  const sample = latestWith((entry) => entry.disk)
  if (windows || !sample?.disk) return null
  return {
    t: now,
    read: sample.disk.read,
    write: sample.disk.write,
    reads: Math.round(sample.disk.read / 30000),
    writes: Math.round(sample.disk.write / 17000),
    readTotal: 304 * GB,
    writeTotal: 148 * GB
  }
}

function gpuReading(): GpuReading | null {
  const sample = latestWith((entry) => entry.gpu)
  if (!hasGpu || sample?.gpu === null || sample?.gpu === undefined) return null
  if (linux) {
    return {
      model: 'NVIDIA GeForce RTX 4060 Laptop GPU',
      utilization: sample.gpu,
      renderer: null,
      inUse: 2.3 * GB,
      allocated: 8 * GB,
      dedicated: true
    }
  }
  return {
    model: neutral ? null : 'Apple M4 Pro',
    utilization: sample.gpu,
    renderer: Math.max(0, round1(sample.gpu - 1)),
    inUse: 1.2 * GB,
    allocated: 6.7 * GB,
    dedicated: false
  }
}

function batteryReading(): BatteryReading | null {
  if (!hasBattery) return null
  return linux
    ? { percent: 64, onBattery: true, state: 'discharging', minutesLeft: 194, watts: 11.24 }
    : { percent: 82, onBattery: true, state: 'discharging', minutesLeft: 222, watts: null }
}

let energyPolls = 0

function energyReading(now: number, input: PollInput): EnergyReading | null {
  if (input.view !== 'energy' || windows || linux) {
    energyPolls = 0
    return null
  }
  energyPolls += 1
  if (energyPolls < 2 || params.get('energy') === 'wait') return null
  const named = (name: string) => PROCESS_TABLE.find((row) => row.name === name)?.pid ?? 0
  const impact: [string, number][] = neutral
    ? [
        ['window-compositor', 11],
        ['web-browser', 9.9],
        ['video-encoder', 8.7],
        ['code-editor', 7.8],
        ['audio-service', 6.7],
        ['node', 5.4]
      ]
    : [
        ['WindowServer', 11],
        ['Example Browser Helper (Renderer)', 9.9],
        ['qemu-system-aarch64', 8.7],
        ['Orca Helper (Renderer)', 7.8],
        ['coreaudiod', 6.7],
        ['node', 5.4]
      ]
  const audio = neutral ? 'audio-service' : 'coreaudiod'
  const browser = neutral ? 'web-browser' : 'Example Browser Helper (Renderer)'
  return {
    t: now,
    impact: impact.map(([name, value]) => ({ pid: named(name), name, impact: value })),
    blockers: [
      { pid: named(audio), name: audio, kinds: ['system'] },
      { pid: 36800, name: 'caffeinate', kinds: ['system'] },
      { pid: named(browser), name: browser, kinds: ['system', 'display'] }
    ]
  }
}

function cores(): CoreInfo[] {
  return Array.from({ length: CORE_COUNT }, (_, index) => ({
    kind: windows || linux ? null : index < 4 ? 'efficiency' : 'performance'
  }))
}

function hello(): HelloResult {
  return {
    protocol: 1,
    run,
    platform: windows ? 'win32' : linux ? 'linux' : 'darwin',
    cpuModel: neutral
      ? null
      : windows
        ? 'Intel(R) Core(TM) i7-1185G7 @ 3.00GHz'
        : linux
          ? 'AMD Ryzen 7 7840U w/ Radeon 780M Graphics'
          : 'Apple M4 Pro',
    cores: cores(),
    totalMemory: (windows ? 16 : linux ? 32 : 48) * GB,
    sections: sections(),
    intervalMs: STEP_MS,
    historyMs: HISTORY_MS,
    energyIntervalMs: 10000,
    defaultView: params.get('view') === 'processes' ? 'processes' : 'last'
  }
}

function poll(input: PollInput): PollResult {
  const now = Date.now()
  generateUntil(now)
  const reset = input.run !== run
  const since = reset ? 0 : (input.since ?? 0)
  const load: LoadAverage | null = windows ? null : [5.49 + next() * 0.2, 4.79, 4.33]
  return {
    run,
    reset,
    seq: samples.length > 0 ? samples[samples.length - 1].seq : 0,
    samples: samples.filter((sample) => sample.seq > since),
    current: { load, uptime: 3 * 86400 + 4 * 3600 + (now - startedAt) / 1000 },
    sections: sections(),
    memory: memoryReading(),
    network: networkReading(now),
    disk: diskReading(now),
    volumes: windows ? null : linux ? LINUX_VOLUMES : VOLUMES,
    gpu: gpuReading(),
    battery: batteryReading(),
    energy: energyReading(now, input),
    processes: processPage(input),
    intervalMs: STEP_MS,
    historyMs: HISTORY_MS
  }
}

function later<T>(ms: number, value: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    window.setTimeout(settle, ms)
    function settle(): void {
      try {
        resolve(value())
      } catch (error) {
        reject(error)
      }
    }
  })
}

async function request(name: string, input?: unknown): Promise<unknown> {
  if (name === 'os-vitals.hello') {
    if (scenario === 'loading') return new Promise(() => {})
    if (scenario === 'error') {
      return later(300, () => {
        throw hostError('timeout', 'the worker did not answer in time')
      })
    }
    return later(40, hello)
  }
  if (name === 'os-vitals.poll') {
    polls += 1
    if (scenario === 'flaky' && polls > 1 && polls % 3 === 0) {
      return later(60, () => {
        throw hostError('unavailable', 'the worker stopped')
      })
    }
    return later(20, () => poll((input ?? {}) as PollInput))
  }
  if (name === 'os-vitals.process.detail') return later(30, () => detail(input))
  if (name === 'os-vitals.process.quit') return later(40, () => quitAnswer(input))
  throw hostError('unknown_method', `no handler for ${name}`)
}

const store = new Map<string, unknown>()

const fake = {
  api: { major: 1, minor: 10 },
  locale: 'en',
  host: {
    call: async (method: string) => {
      throw hostError('not_permitted', `${method} is not faked in the harness`)
    },
    has: () => false
  },
  on(event: string, handler: Handler) {
    const set = listeners.get(event) ?? new Set<Handler>()
    set.add(handler)
    listeners.set(event, set)
    return { dispose: () => set.delete(handler) }
  },
  plugin: {
    request,
    on: () => ({ dispose() {} })
  },
  storage: {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      store.set(key, value)
    },
    delete: async (key: string) => {
      store.delete(key)
    },
    keys: async () => [...store.keys()],
    onDidChange: () => ({ dispose() {} })
  },
  settings: {
    get: async () => ({}),
    set: async () => {},
    onDidChange: () => ({ dispose() {} })
  },
  secrets: {
    get: async () => null,
    set: async () => {},
    delete: async () => {}
  }
}

applyTheme(theme)
Object.defineProperty(globalThis, 'orca', {
  value: Object.freeze(fake),
  writable: false,
  configurable: false
})

document.addEventListener('keydown', (event) => {
  if (event.key !== 't' || event.metaKey || event.ctrlKey || event.altKey) return
  applyTheme(theme === 'dark' ? 'light' : 'dark')
  emit('theme', { colorScheme: theme })
})

const ACTION_DELAY_MS = 400

function findButton(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === text
  )
}

function runActions(list: string[]): void {
  const action = list.shift()
  if (!action) return
  const [verb, ...rest] = action.split(':')
  const argument = rest.join(':')
  if (verb === 'tab' || verb === 'click') findButton(argument)?.click()
  if (verb === 'probe') {
    const active = document.activeElement
    const label =
      active instanceof HTMLElement ? (active.textContent ?? '').trim().slice(0, 40) : ''
    document.body.dataset.focus = `${active?.tagName.toLowerCase() ?? 'none'}:${label}`
    document.body.dataset.dialog = document.querySelector('dialog')?.open ? 'open' : 'closed'
  }
  if (verb === 'filter') {
    const input = document.querySelector<HTMLInputElement>('#vt-filter')
    if (input) {
      input.value = argument
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    }
  }
  if (verb === 'focus') {
    const cell = [...document.querySelectorAll<HTMLElement>('tbody td.col-name')].find(
      (td) => td.textContent === argument
    )
    cell?.closest('tr')?.focus()
  }
  if (verb === 'key') {
    const target = document.activeElement ?? document.body
    target.dispatchEvent(new KeyboardEvent('keydown', { key: argument, bubbles: true }))
  }
  if (verb === 'scroll') window.scrollTo(0, Number(argument) || 0)
  if (verb === 'reveal') {
    const card = [...document.querySelectorAll<HTMLElement>('.vt-title')]
      .find((title) => title.textContent?.trim() === argument)
      ?.closest('section')
    const bar = document.querySelector<HTMLElement>('.vt-bar')
    if (card) window.scrollTo(0, card.offsetTop - (bar?.offsetHeight ?? 0) - 10)
  }
  if (verb === 'measure') {
    const root = document.documentElement
    const wide = [...document.querySelectorAll<HTMLElement>('body *')].filter((node) => {
      const rect = node.getBoundingClientRect()
      return rect.width > 0 && rect.right > root.clientWidth + 0.5
    })
    document.body.dataset.overflow = String(root.scrollWidth - root.clientWidth)
    document.body.dataset.wide = wide
      .slice(0, 5)
      .map((node) => `${node.tagName.toLowerCase()}.${node.className}`)
      .join(' | ')
  }
  if (verb === 'hover') {
    const [index, fraction] = argument.split(':').map(Number)
    const area = document.querySelectorAll<HTMLElement>('.vt-plot-area')[index]
    if (area) {
      const rect = area.getBoundingClientRect()
      area.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerType: 'mouse',
          clientX: rect.left + rect.width * fraction,
          clientY: rect.top + rect.height / 2
        })
      )
    }
  }
  if (verb === 'chart') {
    document.querySelectorAll<HTMLElement>('.vt-plot-area')[Number(argument)]?.focus()
  }
  if (verb === 'select') {
    const cell = [...document.querySelectorAll<HTMLElement>('tbody td.col-name')].find(
      (td) => td.textContent === argument
    )
    cell?.click()
  }
  window.setTimeout(continueActions, verb === 'wait' ? Number(argument) || 0 : ACTION_DELAY_MS)
  function continueActions(): void {
    runActions(list)
  }
}

const acts = (params.get('act') ?? '').split(',').filter(Boolean)
if (acts.length > 0) {
  window.setTimeout(startActions, 600)
}
function startActions(): void {
  runActions(acts)
}
