import type {
  BatteryReading,
  Current,
  DetailResult,
  DetailView,
  DiskReading,
  EnergyReading,
  GpuReading,
  HelloResult,
  MemoryReading,
  NetworkReading,
  ProcessPage,
  ProcessQuery,
  QuitInput,
  QuitResult,
  Sample,
  Sections,
  Volume
} from '../src/protocol.ts'
import type { TimeWindow } from './charts.ts'

export type PanelModel = {
  hello: HelloResult
  sections: Sections
  samples: readonly Sample[]
  current: Current | null
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

export type PanelActions = {
  showProcesses(): void
  openView(view: DetailView, opener: HTMLElement | null): void
  back(): void
  queryChanged(): void
  requestDetail(pid: number): Promise<DetailResult>
  requestQuit(input: QuitInput): Promise<QuitResult>
}

export type View = {
  element: HTMLElement
  update(model: PanelModel): void
  query(model: PanelModel): ProcessQuery | null
  escape(): boolean
  enter?(): void
}

export const TOP_QUERY: ProcessQuery = {
  sort: 'cpu',
  direction: 'desc',
  filter: '',
  limit: 5,
  offset: 0
}

export const TOP_MEMORY_QUERY: ProcessQuery = { ...TOP_QUERY, sort: 'memory' }

const GAP_FLOOR_MS = 5000

export function timeWindow(model: PanelModel): TimeWindow {
  const latest = model.samples[model.samples.length - 1]
  const end = latest ? latest.t : Date.now()
  return {
    start: end - model.historyMs,
    end,
    gapMs: 3 * Math.max(model.intervalMs, GAP_FLOOR_MS)
  }
}

export function detailAvailable(view: DetailView, model: PanelModel): boolean {
  const { sections } = model
  if (view === 'cpu') return sections.cpu
  if (view === 'memory') return sections.memory
  if (view === 'network') return sections.network
  if (view === 'disk') return sections.disk
  if (view === 'gpu') return sections.gpu
  return sections.energy || sections.battery
}

export function latestWithCores(samples: readonly Sample[]): Sample | null {
  for (let index = samples.length - 1; index >= 0; index--) {
    if (samples[index].cores) return samples[index]
  }
  return null
}

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {}
}
