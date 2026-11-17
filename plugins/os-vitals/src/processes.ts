import { round1 } from './cpu.ts'
import { processName, type RawProcess } from './parse/ps.ts'
import type {
  ListedProcess,
  ProcessPage,
  ProcessQuery,
  ProcessRow,
  ProcessSortKey,
  QuitOffer,
  SortDirection
} from './protocol.ts'

export const PAGE_SIZE = 100
export const MAX_LIMIT = 1000
export const MAX_FILTER = 128
export const MAX_GAP_SECONDS = 15

const SORT_KEYS: readonly ProcessSortKey[] = ['name', 'cpu', 'memory', 'pid']
const DIRECTIONS: readonly SortDirection[] = ['asc', 'desc']

export type ProcessSnapshot = {
  rows: ProcessRow[]
  t: number
}

export type ProcessTracker = {
  update(raw: readonly RawProcess[], t: number): ProcessSnapshot
  clear(): void
}

const identity = (pid: number, start: string) => `${pid}:${start}`

export function createProcessTracker(): ProcessTracker {
  let previous = new Map<string, { cpuTime: number; t: number }>()
  return {
    update(raw, t) {
      const next = new Map<string, { cpuTime: number; t: number }>()
      const rows: ProcessRow[] = raw.map((entry) => {
        const key = identity(entry.pid, entry.start)
        const before = previous.get(key)
        const elapsed = before ? (t - before.t) / 1000 : 0
        const cpu =
          before && elapsed > 0 && elapsed <= MAX_GAP_SECONDS
            ? Math.max(0, ((entry.cpuTime - before.cpuTime) / elapsed) * 100)
            : Math.max(0, entry.pcpu)
        next.set(key, { cpuTime: entry.cpuTime, t })
        return {
          pid: entry.pid,
          ppid: entry.ppid,
          uid: entry.uid,
          user: entry.user,
          name: processName(entry.comm),
          path: entry.comm,
          cpu: Number.isFinite(cpu) ? round1(cpu) : 0,
          memory: entry.rss,
          cpuTime: entry.cpuTime,
          startedAt: entry.startedAt,
          start: entry.start
        }
      })
      previous = next
      return { rows, t }
    },
    clear() {
      previous = new Map()
    }
  }
}

function whole(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

export function readQuery(input: unknown): ProcessQuery | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  const sort = SORT_KEYS.find((key) => key === raw.sort) ?? 'cpu'
  const direction =
    DIRECTIONS.find((key) => key === raw.direction) ?? (sort === 'name' ? 'asc' : 'desc')
  return {
    sort,
    direction,
    filter: typeof raw.filter === 'string' ? raw.filter.trim().slice(0, MAX_FILTER) : '',
    limit: whole(raw.limit, 1, MAX_LIMIT, PAGE_SIZE),
    offset: whole(raw.offset, 0, Number.MAX_SAFE_INTEGER, 0)
  }
}

export function matches(row: ProcessRow, filter: string): boolean {
  if (!filter) return true
  const needle = filter.toLowerCase()
  if (/^\d+$/.test(needle) && String(row.pid).startsWith(needle)) return true
  return row.name.toLowerCase().includes(needle)
}

function primary(a: ProcessRow, b: ProcessRow, sort: ProcessSortKey): number {
  if (sort === 'name') return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
  return a[sort] - b[sort]
}

export type ProcessSlice = Omit<ProcessPage, 'rows'> & { rows: ProcessRow[] }

export function queryProcesses(snapshot: ProcessSnapshot, query: ProcessQuery): ProcessSlice {
  const matched = snapshot.rows.filter((row) => matches(row, query.filter))
  const sign = query.direction === 'asc' ? 1 : -1
  matched.sort((a, b) => primary(a, b, query.sort) * sign || a.pid - b.pid)
  return {
    rows: matched.slice(query.offset, query.offset + query.limit),
    total: snapshot.rows.length,
    matched: matched.length,
    offset: query.offset,
    sampledAt: snapshot.t
  }
}

export function withOffers(
  slice: ProcessSlice,
  offer: (row: ProcessRow) => QuitOffer
): ProcessPage {
  const rows: ListedProcess[] = slice.rows.map((row) => ({ ...row, quit: offer(row) }))
  return { ...slice, rows }
}
