import type {
  Current,
  DetailResult,
  HelloResult,
  MemoryReading,
  ProcessPage,
  ProcessQuery,
  QuitInput,
  QuitResult,
  Sample
} from '../src/protocol.ts'

export type PanelModel = {
  hello: HelloResult
  samples: readonly Sample[]
  current: Current | null
  memory: MemoryReading | null
  processes: ProcessPage | null
  intervalMs: number
  historyMs: number
}

export type PanelActions = {
  showProcesses(): void
  queryChanged(): void
  requestDetail(pid: number): Promise<DetailResult>
  requestQuit(input: QuitInput): Promise<QuitResult>
}

export type View = {
  element: HTMLElement
  update(model: PanelModel): void
  query(model: PanelModel): ProcessQuery | null
  escape(): boolean
}

export const TOP_QUERY: ProcessQuery = {
  sort: 'cpu',
  direction: 'desc',
  filter: '',
  limit: 5,
  offset: 0
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
