import type { CpuTimes } from '../cpu.ts'
import type { CoreInfo, LoadAverage, Sections } from '../protocol.ts'

export type Provider = {
  platform: string
  cpuModel(): string | null
  cores(): CoreInfo[]
  cpuTimes(): CpuTimes[]
  load(): LoadAverage | null
  uptime(): number
  totalMemory(): number
  sections(): Sections
}
