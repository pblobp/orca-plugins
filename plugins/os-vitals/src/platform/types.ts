import type { CpuTimes } from '../cpu.ts'
import type { DiskDriver } from '../parse/ioreg-disk.ts'
import type { InterfaceCounters } from '../parse/netstat.ts'
import type { Assertion } from '../parse/pmset.ts'
import type { Identity, RawDetail, RawProcess } from '../parse/ps.ts'
import type { EnergySample } from '../parse/top.ts'
import type {
  BatteryReading,
  CoreInfo,
  GpuReading,
  LoadAverage,
  MemoryReading,
  Sections,
  Volume
} from '../protocol.ts'

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
  network(): Promise<InterfaceCounters[] | null>
  defaultInterface(): Promise<string | null>
  disk(): Promise<DiskDriver[] | null>
  volumes(): Promise<Volume[] | null>
  gpu(): Promise<GpuReading | null>
  battery(): Promise<BatteryReading | null>
  energy(): Promise<EnergySample[] | null>
  assertions(): Promise<Assertion[] | null>
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
