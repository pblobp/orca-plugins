export {
  ago,
  bytes,
  clockTime,
  cpuTime,
  duration,
  gigabytes,
  loadAverage,
  percent,
  perSecond,
  portion,
  rate,
  rateScale,
  significant
} from '../src/format.ts'

export function interval(ms: number): string {
  return `Every ${Math.round(ms / 100) / 10} s`
}

export function minutes(ms: number): string {
  const count = Math.round(ms / 60000)
  return count === 1 ? 'the last minute' : `the last ${count} minutes`
}

export function count(value: number, one: string, many: string): string {
  return `${value.toLocaleString('en-US')} ${value === 1 ? one : many}`
}

export function spanAgo(ms: number): string {
  return `${Math.round(ms / 60000)} min ago`
}

export function shortSpan(ms: number): string {
  return `last ${Math.round(ms / 60000)} min`
}
