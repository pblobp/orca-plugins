const KB = 1024
const MB = KB * 1024
const GB = MB * 1024
const TB = GB * 1024
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const
const NICE_STEPS: readonly number[] = [
  1, 2, 3, 4, 5, 6, 8, 10, 20, 30, 40, 50, 60, 80, 100, 200, 300, 400, 500, 600, 800
]
const HEADROOM = 1.05

export type Scale = { max: number; top: string; mid: string }

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
  if (value >= TB) return `${significant(value / TB)} TB`
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

export function rate(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return '–'
  let scaled = value
  let unit = 0
  while (scaled >= KB && unit < UNITS.length - 1) {
    scaled /= KB
    unit += 1
  }
  const text = unit >= 2 && scaled < 100 ? scaled.toFixed(1) : String(Math.round(scaled))
  return `${text} ${UNITS[unit]}/s`
}

function trimNumber(value: number): string {
  return String(Number(value.toFixed(1)))
}

export function rateScale(peak: number): Scale {
  const target = Math.max(KB, Number.isFinite(peak) && peak > 0 ? peak * HEADROOM : 0)
  for (let unit = 1; unit < UNITS.length; unit++) {
    const size = KB ** unit
    for (const step of NICE_STEPS) {
      if (step * size >= target) {
        return { max: step * size, top: `${step} ${UNITS[unit]}/s`, mid: trimNumber(step / 2) }
      }
    }
  }
  const size = KB ** (UNITS.length - 1)
  const step = Math.ceil(target / size)
  return { max: step * size, top: `${step} TB/s`, mid: trimNumber(step / 2) }
}

export function clockTime(t: number): string {
  const date = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function portion(part: number, whole: number): string {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return '–'
  const [size, unit] = whole >= TB ? [TB, 'TB'] : whole >= GB ? [GB, 'GB'] : [MB, 'MB']
  return `${significant(Math.max(0, part) / size)} of ${significant(whole / size)} ${unit}`
}

export function perSecond(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return '–'
  return `${Math.round(value).toLocaleString('en-US')} /s`
}
