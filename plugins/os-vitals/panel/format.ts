export function percent(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '–'
    : `${Math.round(value)}%`
}

export function loadAverage(values: readonly number[]): string {
  return values.map((value) => value.toFixed(2)).join(' · ')
}

export function duration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days} d ${hours} h`
  if (hours > 0) return `${hours} h ${minutes} min`
  return `${minutes} min`
}

export function interval(ms: number): string {
  return `Every ${Math.round(ms / 100) / 10} s`
}

export function minutes(ms: number): string {
  const count = Math.round(ms / 60000)
  return count === 1 ? 'the last minute' : `the last ${count} minutes`
}

export function count(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`
}
