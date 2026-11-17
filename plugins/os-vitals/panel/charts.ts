export type Palette = {
  series: string[]
  grid: string
  areaAlpha: number
}

export type CpuPoint = {
  t: number
  user: number
  total: number
}

export type TimeWindow = {
  start: number
  end: number
  gapMs: number
}

type Surface = {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  pixel: number
}

const HEX = /^#([0-9a-f]{6})$/i

export function readPalette(root: Element = document.documentElement): Palette {
  const style = getComputedStyle(root)
  const value = (name: string) => style.getPropertyValue(name).trim()
  return {
    series: [value('--vt-s1'), value('--vt-s2'), value('--vt-s3'), value('--vt-s4')],
    grid: value('--orca-border') || 'rgba(128, 128, 128, 0.35)',
    areaAlpha: root.classList.contains('light') ? 0.16 : 0.22
  }
}

export function withAlpha(color: string, alpha: number): string {
  const match = HEX.exec(color)
  if (!match) return color
  const n = Number.parseInt(match[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

function prepare(canvas: HTMLCanvasElement): Surface | null {
  const ratio = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  const width = Math.round(rect.width * ratio)
  const height = Math.round(rect.height * ratio)
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, rect.width, rect.height)
  return { ctx, width: rect.width, height: rect.height, pixel: 1 / ratio }
}

function segments<T extends { t: number }>(points: readonly T[], gapMs: number): T[][] {
  const out: T[][] = []
  let current: T[] = []
  for (const point of points) {
    const previous = current[current.length - 1]
    if (previous && point.t - previous.t > gapMs) {
      out.push(current)
      current = []
    }
    current.push(point)
  }
  if (current.length > 0) out.push(current)
  return out
}

function drawGrid(surface: Surface, palette: Palette, fractions: readonly number[]): void {
  const { ctx, width, height, pixel } = surface
  ctx.save()
  ctx.strokeStyle = palette.grid
  ctx.lineWidth = pixel
  ctx.globalAlpha = 0.8
  for (const fraction of fractions) {
    const y = Math.min(height - pixel / 2, Math.round(fraction * (height - 1)) + pixel / 2)
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }
  ctx.restore()
}

export function drawCpuChart(
  canvas: HTMLCanvasElement,
  points: readonly CpuPoint[],
  range: TimeWindow,
  palette: Palette
): void {
  const surface = prepare(canvas)
  if (!surface) return
  const { ctx, width, height } = surface
  drawGrid(surface, palette, [0.5, 1])
  const span = Math.max(1, range.end - range.start)
  const x = (t: number) => ((t - range.start) / span) * width
  const y = (value: number) => height - 1 - (Math.min(100, Math.max(0, value)) / 100) * (height - 2)
  const [userColor, systemColor] = palette.series
  const visible = points.filter((point) => point.t >= range.start - range.gapMs)

  for (const part of segments(visible, range.gapMs)) {
    if (part.length < 2) continue
    ctx.beginPath()
    part.forEach((point, index) => {
      if (index === 0) ctx.moveTo(x(point.t), y(point.user))
      else ctx.lineTo(x(point.t), y(point.user))
    })
    ctx.lineTo(x(part[part.length - 1].t), height)
    ctx.lineTo(x(part[0].t), height)
    ctx.closePath()
    ctx.fillStyle = withAlpha(userColor, palette.areaAlpha)
    ctx.fill()

    ctx.beginPath()
    part.forEach((point, index) => {
      if (index === 0) ctx.moveTo(x(point.t), y(point.total))
      else ctx.lineTo(x(point.t), y(point.total))
    })
    for (let index = part.length - 1; index >= 0; index--) {
      ctx.lineTo(x(part[index].t), y(part[index].user))
    }
    ctx.closePath()
    ctx.fillStyle = withAlpha(systemColor, palette.areaAlpha + 0.02)
    ctx.fill()

    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    for (const [color, pick] of [
      [userColor, (point: CpuPoint) => point.user],
      [systemColor, (point: CpuPoint) => point.total]
    ] as const) {
      ctx.beginPath()
      part.forEach((point, index) => {
        if (index === 0) ctx.moveTo(x(point.t), y(pick(point)))
        else ctx.lineTo(x(point.t), y(pick(point)))
      })
      ctx.strokeStyle = color
      ctx.stroke()
    }
  }
}
