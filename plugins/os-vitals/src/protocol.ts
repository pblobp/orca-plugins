export type Tier = 'background' | 'active'

export type ViewName = 'overview' | 'processes'

export type DefaultView = 'last' | ViewName

export type MemoryPressure = 'normal' | 'warning' | 'critical'

export type MemoryReading = {
  total: number
  used: number
  app: number | null
  wired: number | null
  compressed: number | null
  cached: number | null
  free: number
  swapUsed: number | null
  swapTotal: number | null
  pressure: MemoryPressure | null
}

export type Sample = {
  seq: number
  t: number
  total: number
  user: number
  system: number
  cores: number[] | null
  memory: MemoryReading | null
}

export type Sections = {
  cpu: boolean
  load: boolean
  memory: boolean
  processes: boolean
  network: boolean
  disk: boolean
  gpu: boolean
  battery: boolean
  energy: boolean
}

export type CoreKind = 'performance' | 'efficiency'

export type CoreInfo = { kind: CoreKind | null }

export type LoadAverage = [number, number, number]

export type HelloResult = {
  protocol: 1
  run: string
  platform: string
  cpuModel: string | null
  cores: CoreInfo[]
  totalMemory: number
  sections: Sections
  intervalMs: number
  historyMs: number
  defaultView: DefaultView
}

export type ProcessSortKey = 'name' | 'cpu' | 'memory' | 'pid'

export type SortDirection = 'asc' | 'desc'

export type ProcessQuery = {
  sort: ProcessSortKey
  direction: SortDirection
  filter: string
  limit: number
  offset: number
}

export type ProcessRow = {
  pid: number
  ppid: number
  uid: number
  user: string
  name: string
  cpu: number
  memory: number
  cpuTime: number
  startedAt: number
}

export type ProcessPage = {
  rows: ProcessRow[]
  total: number
  matched: number
  offset: number
  sampledAt: number
}

export type PollInput = {
  since?: number
  run?: string
  view?: ViewName
  processes?: ProcessQuery
}

export type Current = {
  load: LoadAverage | null
  uptime: number
}

export type PollResult = {
  run: string
  reset: boolean
  seq: number
  samples: Sample[]
  current: Current
  memory: MemoryReading | null
  processes: ProcessPage | null
  intervalMs: number
  historyMs: number
}

export type DetailInput = {
  pid: number
}

export type ProcessDetail = {
  pid: number
  ppid: number
  parentName: string | null
  uid: number
  user: string
  name: string
  command: string
  startedAt: number
  cpuTime: number
  memory: number
  cpu: number | null
  threads: number | null
}

export type DetailResult = { found: true; process: ProcessDetail } | { found: false }

declare module 'orca' {
  interface PluginRequests {
    'os-vitals.hello': { output: HelloResult }
    'os-vitals.poll': { input: PollInput; output: PollResult }
    'os-vitals.process.detail': { input: DetailInput; output: DetailResult }
  }
}
