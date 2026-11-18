export type EnergySample = {
  pid: number
  impact: number
}

const HEADER = /^PID\s+POWER\b/
const ROW = /^(\d+)\s+(\d+(?:\.\d+)?)\b/

export function parseTopEnergy(text: string): EnergySample[] | null {
  const samples: string[][] = []
  for (const line of text.split('\n')) {
    if (HEADER.test(line)) samples.push([])
    else samples[samples.length - 1]?.push(line)
  }
  if (samples.length < 2) return null
  const out: EnergySample[] = []
  for (const line of samples[1]) {
    const match = ROW.exec(line.trim())
    if (!match) continue
    const pid = Number(match[1])
    const impact = Number(match[2])
    if (pid > 0 && Number.isFinite(impact)) out.push({ pid, impact })
  }
  return out
}
