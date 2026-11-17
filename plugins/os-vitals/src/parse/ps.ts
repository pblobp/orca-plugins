export type RawProcess = {
  pid: number
  ppid: number
  uid: number
  pcpu: number
  rss: number
  cpuTime: number
  startedAt: number
  start: string
  user: string
  comm: string
}

export type Identity = {
  start: string
  uid: number
  path: string
  name: string
}

export type RawDetail = RawProcess & {
  command: string
  threads: number | null
}

const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11
}

const LINE =
  /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)\s+(\S.*?)\s*$/

const LSTART = '[A-Z][a-z]{2}\\s+[A-Z][a-z]{2}\\s+\\d{1,2}\\s+\\d{2}:\\d{2}:\\d{2}\\s+\\d{4}'
const IDENTITY = new RegExp(`^\\s*(${LSTART})\\s+(\\d+)\\s+(\\S.*?)\\s*$`)

export const START_TOKEN = /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/

export function normalizeStart(text: string): string {
  return text.trim().split(/\s+/).join(' ')
}

export function parseCpuTime(text: string): number | null {
  const match = /^(?:(\d+)-)?(\d+(?::\d+){0,2}(?:\.\d+)?)$/.exec(text.trim())
  if (!match) return null
  const parts = match[2].split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part))) return null
  const seconds = parts.reduce((total, part) => total * 60 + part, 0)
  return (match[1] ? Number(match[1]) * 86400 : 0) + Math.round(seconds * 100) / 100
}

export function parseLstart(text: string): number | null {
  const tokens = text.trim().split(/\s+/)
  if (tokens.length !== 5) return null
  const [, monthName, dayText, time, yearText] = tokens
  const month = MONTHS[monthName]
  const clock = time.split(':').map(Number)
  const day = Number(dayText)
  const year = Number(yearText)
  if (month === undefined || clock.length !== 3 || [day, year, ...clock].some(Number.isNaN)) {
    return null
  }
  const value = new Date(year, month, day, clock[0], clock[1], clock[2]).getTime()
  return Number.isFinite(value) ? value : null
}

export function processName(comm: string): string {
  const trimmed = comm.trim()
  const base = trimmed.startsWith('/') ? trimmed.slice(trimmed.lastIndexOf('/') + 1) : trimmed
  return base || trimmed
}

export function parsePsLine(line: string): RawProcess | null {
  const match = LINE.exec(line)
  if (!match) return null
  const cpuTime = parseCpuTime(match[6])
  const startedAt = parseLstart(match[7])
  if (cpuTime === null || startedAt === null) return null
  return {
    pid: Number(match[1]),
    ppid: Number(match[2]),
    uid: Number(match[3]),
    pcpu: Number(match[4]),
    rss: Number(match[5]) * 1024,
    cpuTime,
    startedAt,
    start: normalizeStart(match[7]),
    user: match[8],
    comm: match[9]
  }
}

export function parsePs(text: string): RawProcess[] {
  const out: RawProcess[] = []
  for (const line of text.split('\n')) {
    const entry = parsePsLine(line)
    if (entry) out.push(entry)
  }
  return out
}

export function countThreads(text: string): number | null {
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  if (lines.length < 2 || !/^\s*USER\s+PID\b/.test(lines[0])) return null
  return lines.length - 1
}

export function parseDetail(text: string, threadsText: string | null): RawDetail | null {
  const line = text.split('\n').find((entry) => entry.trim() !== '')
  const parsed = line ? parsePsLine(line) : null
  if (!parsed) return null
  return {
    ...parsed,
    command: parsed.comm,
    threads: threadsText === null ? null : countThreads(threadsText)
  }
}

export function parseIdentity(text: string): Identity | null {
  const line = text.split('\n').find((entry) => entry.trim() !== '')
  const match = line ? IDENTITY.exec(line) : null
  if (!match || parseLstart(match[1]) === null) return null
  return {
    start: normalizeStart(match[1]),
    uid: Number(match[2]),
    path: match[3],
    name: processName(match[3])
  }
}
