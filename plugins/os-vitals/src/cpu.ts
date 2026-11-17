export type CpuTimes = {
  user: number
  nice: number
  sys: number
  idle: number
  irq: number
}

export type CpuUsage = {
  total: number
  user: number
  system: number
  cores: number[]
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function share(part: number, whole: number): number {
  if (whole <= 0) return 0
  return round1(Math.min(100, Math.max(0, (part / whole) * 100)))
}

function grew(next: number, previous: number): number {
  const delta = next - previous
  return Number.isFinite(delta) && delta > 0 ? delta : 0
}

export function copyTimes(times: CpuTimes): CpuTimes {
  return { user: times.user, nice: times.nice, sys: times.sys, idle: times.idle, irq: times.irq }
}

export function cpuUsage(
  previous: readonly CpuTimes[],
  next: readonly CpuTimes[]
): CpuUsage | null {
  if (previous.length === 0 || previous.length !== next.length) return null
  let userAll = 0
  let systemAll = 0
  let elapsedAll = 0
  const cores: number[] = []
  for (let index = 0; index < next.length; index++) {
    const before = previous[index]
    const after = next[index]
    const user = grew(after.user, before.user) + grew(after.nice, before.nice)
    const system = grew(after.sys, before.sys) + grew(after.irq, before.irq)
    const elapsed = user + system + grew(after.idle, before.idle)
    cores.push(share(user + system, elapsed))
    userAll += user
    systemAll += system
    elapsedAll += elapsed
  }
  if (elapsedAll <= 0) return null
  return {
    total: share(userAll + systemAll, elapsedAll),
    user: share(userAll, elapsedAll),
    system: share(systemAll, elapsedAll),
    cores
  }
}
