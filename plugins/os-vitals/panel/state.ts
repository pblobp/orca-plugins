import type { Current, HelloResult, Sample } from '../src/protocol.ts'

export type PanelModel = {
  hello: HelloResult
  samples: readonly Sample[]
  current: Current | null
  intervalMs: number
  historyMs: number
}

export type View = {
  element: HTMLElement
  update(model: PanelModel): void
}

export function latestWithCores(samples: readonly Sample[]): Sample | null {
  for (let index = samples.length - 1; index >= 0; index--) {
    if (samples[index].cores) return samples[index]
  }
  return null
}
