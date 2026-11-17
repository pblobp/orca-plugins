import { START_TOKEN, type Identity } from './parse/ps.ts'
import { protectedRule } from './protected.ts'
import type { ProcessRow, QuitInput, QuitOffer, QuitReason, QuitResult } from './protocol.ts'

export type QuitSignal = 'SIGTERM' | 'SIGKILL'

export type QuitContext = {
  uid: number
  selfPid: number
  parentPid: number
  bundle: string | null
}

export type QuitDeps = QuitContext & {
  listed(): readonly ProcessRow[]
  identify(pid: number): Promise<Identity | null>
  kill(pid: number, signal: QuitSignal): void
}

const MAX_PID = 0x7fffffff
const INPUT_KEYS = ['pid', 'startedAt', 'force']

export function readQuitInput(input: unknown): QuitInput | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  if (Object.keys(raw).some((key) => !INPUT_KEYS.includes(key))) return null
  const { pid, startedAt, force } = raw
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid < 1 || pid > MAX_PID) return null
  if (typeof startedAt !== 'string' || startedAt.length > 64 || !START_TOKEN.test(startedAt)) {
    return null
  }
  if (typeof force !== 'boolean') return null
  return { pid, startedAt, force }
}

export function family(context: QuitContext, rows: readonly ProcessRow[]): Set<number> {
  const parents = new Map(rows.map((row) => [row.pid, row.ppid]))
  const found = new Set<number>([context.selfPid, context.parentPid])
  const seen = new Set<number>([context.selfPid])
  let current: number | undefined = parents.get(context.selfPid) ?? context.parentPid
  while (current !== undefined && current > 1 && !seen.has(current)) {
    seen.add(current)
    found.add(current)
    current = parents.get(current)
  }
  found.delete(0)
  found.delete(1)
  return found
}

export function insideBundle(path: string, bundle: string | null): boolean {
  if (!bundle) return false
  const root = bundle.endsWith('/') ? bundle : `${bundle}/`
  return path.startsWith(root)
}

export function createOfferer(
  context: QuitContext,
  rows: readonly ProcessRow[]
): (row: ProcessRow) => QuitOffer {
  const own = family(context, rows)
  return (row) => {
    if (row.pid <= 1) return 'system'
    if (row.uid !== context.uid) return 'not_owner'
    if (own.has(row.pid) || insideBundle(row.path, context.bundle)) return 'orca'
    return protectedRule(row)?.group ?? 'allowed'
  }
}

function refuse(reason: QuitReason): QuitResult {
  return { ok: false, reason }
}

function errorCode(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null
}

export async function quitProcess(input: QuitInput, deps: QuitDeps): Promise<QuitResult> {
  if (input.pid <= 1) return refuse('protected')

  const rows = deps.listed()
  const listed = rows.find((row) => row.pid === input.pid && row.start === input.startedAt)
  if (listed && listed.uid !== deps.uid) return refuse('not_owner')

  const fresh = await deps.identify(input.pid)
  if (!fresh) return refuse('gone')
  if (!listed || fresh.start !== input.startedAt) return refuse('changed')
  if (fresh.uid !== listed.uid || fresh.name !== listed.name) return refuse('changed')

  if (family(deps, rows).has(input.pid) || insideBundle(fresh.path, deps.bundle)) {
    return refuse('protected')
  }
  if (protectedRule(fresh)) return refuse('protected')

  try {
    deps.kill(input.pid, input.force ? 'SIGKILL' : 'SIGTERM')
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ESRCH') return refuse('gone')
    if (code === 'EPERM') return refuse('not_permitted')
    throw error
  }
  return { ok: true }
}
