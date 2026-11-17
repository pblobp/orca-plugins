import type {
  HelloResult,
  LoadAverage,
  PollInput,
  PollResult,
  Sample,
  Sections
} from '../../plugins/os-vitals/src/protocol.ts'

type Scenario = 'normal' | 'loading' | 'error' | 'unsupported' | 'windows' | 'flaky' | 'empty'
type Theme = 'dark' | 'light'
type Handler = (payload: unknown) => unknown

const SCENARIOS: readonly Scenario[] = [
  'normal',
  'loading',
  'error',
  'unsupported',
  'windows',
  'flaky',
  'empty'
]

const THEMES: Record<Theme, Record<string, string>> = {
  dark: {
    '--orca-background': '#111113',
    '--orca-foreground': '#ededef',
    '--orca-card': '#18181b',
    '--orca-card-foreground': '#ededef',
    '--orca-popover': '#18181b',
    '--orca-popover-foreground': '#ededef',
    '--orca-primary': '#ededef',
    '--orca-primary-foreground': '#18181b',
    '--orca-secondary': '#232327',
    '--orca-secondary-foreground': '#ededef',
    '--orca-muted': '#232327',
    '--orca-muted-foreground': '#b4b4bd',
    '--orca-accent': '#2a2a2f',
    '--orca-accent-foreground': '#ededef',
    '--orca-destructive': '#e05252',
    '--orca-destructive-foreground': '#ffffff',
    '--orca-border': '#2a2a2f',
    '--orca-input': '#2a2a2f',
    '--orca-ring': '#3987e5',
    '--orca-radius': '8px'
  },
  light: {
    '--orca-background': '#fafafa',
    '--orca-foreground': '#18181b',
    '--orca-card': '#ffffff',
    '--orca-card-foreground': '#18181b',
    '--orca-popover': '#ffffff',
    '--orca-popover-foreground': '#18181b',
    '--orca-primary': '#18181b',
    '--orca-primary-foreground': '#fafafa',
    '--orca-secondary': '#f1f1f3',
    '--orca-secondary-foreground': '#18181b',
    '--orca-muted': '#f1f1f3',
    '--orca-muted-foreground': '#4b4b55',
    '--orca-accent': '#e9e9ec',
    '--orca-accent-foreground': '#18181b',
    '--orca-destructive': '#d03b3b',
    '--orca-destructive-foreground': '#ffffff',
    '--orca-border': '#e2e2e6',
    '--orca-input': '#e2e2e6',
    '--orca-ring': '#2a78d6',
    '--orca-radius': '8px'
  }
}

const params = new URLSearchParams(location.search)
const scenario: Scenario = SCENARIOS.find((name) => name === params.get('scenario')) ?? 'normal'
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
const CORE_COUNT = windows ? 8 : 14
const STEP_MS = 2000
const HISTORY_MS = 5 * 60 * 1000
const run = `harness-${Date.now().toString(36)}`
const startedAt = Date.now() - (scenario === 'empty' ? 0 : HISTORY_MS)
const next = random(11)
const samples: Sample[] = []
let user = 18
let system = 6
const coreLoad = Array.from({ length: CORE_COUNT }, (_, index) => Math.max(4, 62 - index * 4))
let polls = 0

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const round1 = (value: number) => Math.round(value * 10) / 10

function generateUntil(now: number): void {
  let t = samples.length > 0 ? samples[samples.length - 1].t + STEP_MS : startedAt + STEP_MS
  while (t <= now) {
    user = clamp(user + (next() - 0.5) * 9, 4, 70)
    system = clamp(system + (next() - 0.5) * 3, 1, 18)
    for (let index = 0; index < coreLoad.length; index++) {
      coreLoad[index] = clamp(coreLoad[index] + (next() - 0.5) * 18, 1, 99)
    }
    samples.push({
      seq: samples.length + 1,
      t,
      total: round1(user + system),
      user: round1(user),
      system: round1(system),
      cores: coreLoad.map(round1)
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
    memory: false,
    processes: false,
    network: false,
    disk: false,
    gpu: false,
    battery: false,
    energy: false
  }
}

function hello(): HelloResult {
  return {
    protocol: 1,
    run,
    platform: windows ? 'win32' : 'darwin',
    cpuModel: windows ? 'Intel(R) Core(TM) i7-1185G7 @ 3.00GHz' : 'Apple M4 Pro',
    cores: Array.from({ length: CORE_COUNT }, () => ({ kind: null })),
    totalMemory: 48 * 1024 ** 3,
    sections: sections(),
    intervalMs: STEP_MS,
    historyMs: HISTORY_MS,
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
