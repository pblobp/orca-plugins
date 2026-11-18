export type Tier = 'background' | 'active'

export type TopView = 'overview' | 'processes'

export type DetailView = 'cpu' | 'memory' | 'network' | 'disk' | 'gpu' | 'energy'

export type ViewName = TopView | DetailView

export type DefaultView = 'last' | TopView

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

export type NetRate = { down: number; up: number }

export type DiskRate = { read: number; write: number }

export type Sample = {
  seq: number
  t: number
  total: number
  user: number
  system: number
  cores: number[] | null
  memory: MemoryReading | null
  net: NetRate | null
  disk: DiskRate | null
  gpu: number | null
}

export type InterfaceKind = 'loopback' | 'tunnel' | 'bridge' | 'wireless-helper' | null

export type InterfaceRate = {
  name: string
  kind: InterfaceKind
  counted: boolean
  down: number
  up: number
}

export type NetworkReading = {
  t: number
  down: number
  up: number
  packetsIn: number
  packetsOut: number
  received: number
  sent: number
  defaultInterface: string | null
  interfaces: InterfaceRate[]
}

export type DiskReading = {
  t: number
  read: number
  write: number
  reads: number
  writes: number
  readTotal: number
  writeTotal: number
}

export type Volume = {
  name: string
  mount: string
  startup: boolean
  total: number
  available: number
}

export type GpuReading = {
  model: string | null
  utilization: number
  renderer: number | null
  inUse: number | null
  allocated: number | null
}

export type BatteryState = 'charging' | 'discharging' | 'charged' | 'finishing' | 'not-charging'

export type BatteryReading = {
  percent: number
  onBattery: boolean
  state: BatteryState | null
  minutesLeft: number | null
}

export type BlockerKind = 'system' | 'display'

export type EnergyImpact = { pid: number; name: string; impact: number }

export type SleepBlocker = { pid: number; name: string; kinds: BlockerKind[] }

export type EnergyReading = {
  t: number
  impact: EnergyImpact[]
  blockers: SleepBlocker[] | null
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

export type QuitOffer = 'allowed' | 'not_owner' | 'system' | 'orca'

export type ProcessRow = {
  pid: number
  ppid: number
  uid: number
  user: string
  name: string
  path: string
  cpu: number
  memory: number
  cpuTime: number
  startedAt: number
  start: string
}

export type ListedProcess = ProcessRow & { quit: QuitOffer }

export type ProcessPage = {
  rows: ListedProcess[]
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
  sections: Sections
  memory: MemoryReading | null
  network: NetworkReading | null
  disk: DiskReading | null
  volumes: Volume[] | null
  gpu: GpuReading | null
  battery: BatteryReading | null
  energy: EnergyReading | null
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
  start: string
  quit: QuitOffer
  cpuTime: number
  memory: number
  cpu: number | null
  threads: number | null
}

export type DetailResult = { found: true; process: ProcessDetail } | { found: false }

export type QuitInput = {
  pid: number
  startedAt: string
  force: boolean
}

export type QuitReason = 'protected' | 'not_owner' | 'gone' | 'changed' | 'not_permitted'

export type QuitResult = { ok: true } | { ok: false; reason: QuitReason }

declare module 'orca' {
  interface PluginRequests {
    'os-vitals.hello': { output: HelloResult }
    'os-vitals.poll': { input: PollInput; output: PollResult }
    'os-vitals.process.detail': { input: DetailInput; output: DetailResult }
    'os-vitals.process.quit': { input: QuitInput; output: QuitResult }
  }
}
