export type ProcStat = {
  pid: number
  comm: string
  state: string
  ppid: number
  flags: number
  utime: number
  stime: number
  starttime: number
  rssPages: number
}

export type ProcStatus = {
  name: string | null
  uid: number | null
  rssBytes: number | null
  threads: number | null
}

export type ProcName = {
  name: string
  path: string
  command: string
}

export const KERNEL_THREAD_FLAG = 0x00200000
export const DEFAULT_TICKS = 100
export const TICK_RATES: readonly number[] = [100, 250, 300, 1000, 1024]
const TICK_TOLERANCE = 0.05
const MIN_UPTIME_SECONDS = 2
const NUMBER = /^-?\d+$/

export function parseProcStat(text: string): ProcStat | null {
  const open = text.indexOf('(')
  const close = text.lastIndexOf(')')
  if (open < 1 || close < open) return null
  const pid = Number(text.slice(0, open).trim())
  const fields = text
    .slice(close + 1)
    .trim()
    .split(/\s+/)
  if (!Number.isInteger(pid) || pid <= 0 || fields.length < 22) return null
  const number = (index: number) => (NUMBER.test(fields[index] ?? '') ? Number(fields[index]) : NaN)
  const stat = {
    pid,
    comm: text.slice(open + 1, close),
    state: fields[0],
    ppid: number(1),
    flags: number(6),
    utime: number(11),
    stime: number(12),
    starttime: number(19),
    rssPages: number(21)
  }
  const numbers = [stat.ppid, stat.flags, stat.utime, stat.stime, stat.starttime, stat.rssPages]
  return numbers.every(Number.isFinite) ? stat : null
}

export function isKernelThread(stat: ProcStat): boolean {
  return (stat.flags & KERNEL_THREAD_FLAG) !== 0
}

export function parseProcStatus(text: string): ProcStatus {
  const fields = new Map<string, string>()
  for (const line of text.split('\n')) {
    const colon = line.indexOf(':')
    if (colon > 0) fields.set(line.slice(0, colon), line.slice(colon + 1).trim())
  }
  const first = (key: string) => {
    const value = (fields.get(key) ?? '').split(/\s+/)[0]
    return NUMBER.test(value) ? Number(value) : null
  }
  const rss = first('VmRSS')
  return {
    name: fields.get('Name') ?? null,
    uid: first('Uid'),
    rssBytes: rss === null ? null : rss * 1024,
    threads: first('Threads')
  }
}

export function procName(cmdline: string, comm: string): ProcName {
  const args = cmdline.split('\0').filter((part) => part !== '')
  const first = args[0] ?? ''
  if (first === '') return { name: comm, path: '', command: `[${comm}]` }
  const base = (first.includes('/') ? first.slice(first.lastIndexOf('/') + 1) : first).trim()
  return {
    name: base || comm,
    path: first.startsWith('/') ? first : '',
    command: args.join(' ')
  }
}

export function parseUptime(text: string): number | null {
  const value = Number(text.trim().split(/\s+/)[0])
  return Number.isFinite(value) && value > 0 ? value : null
}

export function calibrateTicks(
  starttimeTicks: number,
  uptimeSeconds: number,
  ageSeconds: number
): number {
  const sinceBoot = uptimeSeconds - ageSeconds
  if (!(starttimeTicks > 0) || !(sinceBoot >= MIN_UPTIME_SECONDS)) return DEFAULT_TICKS
  const measured = starttimeTicks / sinceBoot
  let best = DEFAULT_TICKS
  let error = Number.POSITIVE_INFINITY
  for (const rate of TICK_RATES) {
    const off = Math.abs(measured - rate) / rate
    if (off < error) {
      best = rate
      error = off
    }
  }
  return error <= TICK_TOLERANCE ? best : DEFAULT_TICKS
}

export function parsePasswd(text: string): Map<number, string> {
  const users = new Map<number, string>()
  for (const line of text.split('\n')) {
    const [name, , uid] = line.split(':')
    if (name && uid !== undefined && NUMBER.test(uid) && !users.has(Number(uid))) {
      users.set(Number(uid), name)
    }
  }
  return users
}
