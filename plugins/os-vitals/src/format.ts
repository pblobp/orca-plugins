const KB = 1024
const MB = KB * 1024
const GB = MB * 1024

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

export function significant(value: number): string {
  if (!Number.isFinite(value)) return '–'
  return String(Number(value.toPrecision(3)))
}

export function gigabytes(value: number): string {
  return significant(value / GB)
}

export function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return '–'
  if (value >= GB) return `${significant(value / GB)} GB`
  if (value >= MB) return `${Math.round(value / MB)} MB`
  if (value >= KB) return `${Math.round(value / KB)} KB`
  return `${Math.round(value)} B`
}

export function cpuTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`
}

export function ago(startedAt: number, now: number): string {
  const seconds = (now - startedAt) / 1000
  if (!Number.isFinite(seconds)) return '–'
  return seconds < 60 ? 'under a minute ago' : `${duration(seconds)} ago`
}
