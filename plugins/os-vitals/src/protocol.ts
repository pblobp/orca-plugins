export type Tier = 'background' | 'active'

export type ViewName = 'overview' | 'processes'

export type DefaultView = 'last' | ViewName

export type Sample = {
  seq: number
  t: number
  total: number
  user: number
  system: number
  cores: number[] | null
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

export type PollInput = {
  since?: number
  run?: string
  view?: string
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
  intervalMs: number
  historyMs: number
}

declare module 'orca' {
  interface PluginRequests {
    'os-vitals.hello': { output: HelloResult }
    'os-vitals.poll': { input: PollInput; output: PollResult }
  }
}
