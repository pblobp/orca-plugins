import type { BatteryReading, BatteryState, BlockerKind } from '../protocol.ts'

export type Assertion = {
  pid: number
  name: string
  type: string
}

const SOURCE = /^Now drawing from '([^']+)'/m
const BATTERY =
  /^\s*-\S*Battery\S*.*?\t\s*(\d{1,3})%;\s*([^;]+?)(?:;\s*([^;]*?))?(?:\s+present:.*)?$/m
const REMAINING = /^(\d+):(\d{2}) remaining/
const OWNER = /^\s+pid (\d+)\((.+)\): \[0x[0-9a-f]+\] \d+:\d{2}:\d{2} (\w+) named: /i
const KERNEL = /^Kernel Assertions:/

const STATES: Record<string, BatteryState> = {
  charging: 'charging',
  discharging: 'discharging',
  charged: 'charged',
  'finishing charge': 'finishing'
}

export const BLOCKER_TYPES: Readonly<Record<string, BlockerKind>> = {
  PreventUserIdleSystemSleep: 'system',
  PreventSystemSleep: 'system',
  NoIdleSleepAssertion: 'system',
  PreventUserIdleDisplaySleep: 'display',
  NoDisplaySleepAssertion: 'display'
}

const POWER_MANAGER = 'powerd'

export function parseBattery(text: string): BatteryReading | null {
  const line = BATTERY.exec(text)
  if (!line) return null
  const level = Number(line[1])
  if (!(level >= 0 && level <= 100)) return null
  const source = SOURCE.exec(text)?.[1].toLowerCase() ?? ''
  const status = line[2].trim().toLowerCase()
  const detail = (line[3] ?? '').trim().toLowerCase()
  const attached = detail.startsWith('charging') ? 'charging' : 'not-charging'
  const state = status === 'ac attached' ? attached : (STATES[status] ?? null)
  const remaining = REMAINING.exec(detail)
  const minutes = remaining ? Number(remaining[1]) * 60 + Number(remaining[2]) : null
  return {
    percent: level,
    onBattery: source.includes('battery'),
    state,
    minutesLeft:
      minutes !== null && minutes > 0 && (state === 'discharging' || state === 'charging')
        ? minutes
        : null
  }
}

export function hasPowerSource(text: string): boolean {
  return SOURCE.test(text)
}

export function parseAssertions(text: string): Assertion[] {
  const out: Assertion[] = []
  for (const line of text.split('\n')) {
    if (KERNEL.test(line)) break
    const match = OWNER.exec(line)
    if (!match) continue
    out.push({ pid: Number(match[1]), name: match[2], type: match[3] })
  }
  return out
}

export function sleepBlockers(
  assertions: readonly Assertion[]
): { pid: number; name: string; kinds: BlockerKind[] }[] {
  const byPid = new Map<number, { pid: number; name: string; kinds: BlockerKind[] }>()
  for (const assertion of assertions) {
    const kind = BLOCKER_TYPES[assertion.type]
    if (!kind || assertion.name === POWER_MANAGER) continue
    const entry = byPid.get(assertion.pid) ?? {
      pid: assertion.pid,
      name: assertion.name,
      kinds: []
    }
    if (!entry.kinds.includes(kind)) entry.kinds.push(kind)
    byPid.set(assertion.pid, entry)
  }
  return [...byPid.values()]
}
