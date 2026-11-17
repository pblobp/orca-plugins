import type { CpuTimes } from '../cpu.ts'
import type { Identity, RawDetail, RawProcess } from '../parse/ps.ts'
import type { CoreInfo, LoadAverage, MemoryReading, Sections } from '../protocol.ts'

export type Provider = {
  platform: string
  init(): Promise<void>
  cpuModel(): string | null
  cores(): CoreInfo[]
  cpuTimes(): CpuTimes[]
  load(): LoadAverage | null
  uptime(): number
  totalMemory(): number
  sections(): Sections
  memory(): Promise<MemoryReading | null>
  processes(): Promise<RawProcess[] | null>
  processDetail(pid: number): Promise<RawDetail | null>
  identify(pid: number): Promise<Identity | null>
  dispose(): void
}

export type SectionGuard = {
  ok(): boolean
  succeeded(): void
  failed(): void
}

export const FAILURE_LIMIT = 3

export function sectionGuard(limit = FAILURE_LIMIT): SectionGuard {
  let failures = 0
  return {
    ok: () => failures < limit,
    succeeded() {
      failures = 0
    },
    failed() {
      failures += 1
    }
  }
}
