import { clearTimeout as clearNodeTimer, setTimeout as startNodeTimer } from 'node:timers'

export type TimerHandle = unknown

export type Clock = {
  now(): number
  setTimeout(callback: () => void, ms: number): TimerHandle
  clearTimeout(handle: TimerHandle): void
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout(callback, ms) {
    const handle = startNodeTimer(callback, ms)
    handle.unref()
    return handle
  },
  clearTimeout(handle) {
    clearNodeTimer(handle as ReturnType<typeof startNodeTimer>)
  }
}
