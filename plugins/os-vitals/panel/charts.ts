import type { Sample } from '../src/protocol.ts'
import type { Scale } from '../src/format.ts'
import { el, setAttr, setText } from './dom.ts'
import { clockTime } from './format.ts'

export type Palette = {
  series: string[]
  grid: string
  areaAlpha: number
}

export type TimeWindow = {
  start: number
  end: number
  gapMs: number
}

export type SeriesSpec = {
  label: string
  color: 1 | 2 | 3 | 4
  value: (sample: Sample) => number | null
  format: (value: number) => string
  area?: boolean
}

export type AxisMode = 'column' | 'corner' | 'none'

export type ChartSpec = {
  name: string
  size: 'micro' | 'mini' | 'card' | 'detail-short' | 'detail' | 'detail-tall'
  series: SeriesSpec[]
  stacked?: boolean
  axis: AxisMode
  scale: (peak: number) => Scale
}

export type TimeChart = {
  element: HTMLElement
  update(samples: readonly Sample[], range: TimeWindow, span: string): void
}

type Surface = {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  pixel: number
}

type Point = { t: number; values: (number | null)[]; stack: (number | null)[] }

const HEX = /^#([0-9a-f]{6})$/i
const MARKER_RADIUS = 6
const TIP_GAP = 10
const PAGE_STEP = 10

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

export function percentScale(): Scale {
  return { max: 100, top: '100%', mid: '50' }
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

export function split<T extends { t: number }>(
  items: readonly T[],
  gapMs: number,
  keep: (item: T) => boolean
): T[][] {
  const out: T[][] = []
  let current: T[] = []
  for (const item of items) {
    if (!keep(item)) continue
    const previous = current[current.length - 1]
    if (previous && item.t - previous.t > gapMs) {
      out.push(current)
      current = []
    }
    current.push(item)
  }
  if (current.length > 0) out.push(current)
  return out
}

function trace(ctx: CanvasRenderingContext2D, coords: readonly [number, number][]): void {
  coords.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
}

export function drawSparkline(
  canvas: HTMLCanvasElement,
  points: readonly { t: number; value: number }[],
  range: TimeWindow,
  palette: Palette
): void {
  const surface = prepare(canvas)
  if (!surface) return
  const { ctx, width, height } = surface
  const span = Math.max(1, range.end - range.start)
  const color = palette.series[0]
  const visible = points.filter((point) => point.t >= range.start - range.gapMs)
  for (const part of split(visible, range.gapMs, () => true)) {
    if (part.length < 2) continue
    const coords = part.map((point): [number, number] => [
      ((point.t - range.start) / span) * width,
      height - 1 - (Math.min(100, Math.max(0, point.value)) / 100) * (height - 2)
    ])
    ctx.beginPath()
    trace(ctx, coords)
    ctx.lineTo(coords[coords.length - 1][0], height)
    ctx.lineTo(coords[0][0], height)
    ctx.closePath()
    ctx.fillStyle = withAlpha(color, palette.areaAlpha)
    ctx.fill()
    ctx.beginPath()
    trace(ctx, coords)
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    ctx.strokeStyle = color
    ctx.stroke()
  }
}

export function createTimeChart(spec: ChartSpec): TimeChart {
  const canvas = el('canvas', { attrs: { 'aria-hidden': 'true' } })
  const cross = el('div', { className: 'vt-cross', attrs: { 'aria-hidden': 'true' } })
  const markers = spec.series.map((series) =>
    el('div', { className: `vt-marker vt-s${series.color}`, attrs: { 'aria-hidden': 'true' } })
  )
  const tipTime = el('span', { className: 'vt-tip-time' })
  const tipValues = spec.series.map(() => el('span', { className: 'vt-tip-value' }))
  const tip = el('div', { className: 'vt-tip', attrs: { 'aria-hidden': 'true' } }, [
    tipTime,
    ...spec.series.map((series, index) =>
      el('span', { className: 'vt-tip-row' }, [
        el('span', { className: 'vt-tip-label' }, [
          el('span', {
            className: `vt-tip-line vt-s${series.color}`,
            attrs: { 'aria-hidden': 'true' }
          }),
          el('span', { text: series.label })
        ]),
        tipValues[index]
      ])
    )
  ])
  const corner = el('span', { className: 'vt-axis-corner', attrs: { 'aria-hidden': 'true' } })
  const area = el('div', { className: 'vt-plot-area', attrs: { tabindex: '0', role: 'img' } }, [
    canvas,
    cross,
    ...markers,
    tip
  ])
  if (spec.axis === 'corner') area.append(corner)
  const axisTop = el('span')
  const axisMid = el('span')
  const live = el('span', { className: 'vt-sr', attrs: { 'aria-live': 'polite' } })
  const element = el('div', { className: `vt-plot vt-plot-${spec.size}` }, [area, live])
  if (spec.axis === 'column') {
    element.append(
      el('div', { className: 'vt-axis', attrs: { 'aria-hidden': 'true' } }, [
        axisTop,
        axisMid,
        el('span', { text: '0' })
      ])
    )
  }

  let points: Point[] = []
  let range: TimeWindow = { start: 0, end: 1, gapMs: 1 }
  let scale: Scale = spec.scale(0)
  let hoverT: number | null = null
  let following = false
  let keyboard = false

  const xOf = (t: number, width: number) =>
    ((t - range.start) / Math.max(1, range.end - range.start)) * width
  const yOf = (value: number, height: number) =>
    height - 1 - (Math.min(scale.max, Math.max(0, value)) / scale.max) * (height - 2)

  function toPoints(samples: readonly Sample[]): Point[] {
    const out: Point[] = []
    for (const sample of samples) {
      if (sample.t < range.start - range.gapMs) continue
      const values = spec.series.map((series) => {
        const value = series.value(sample)
        return value === null || !Number.isFinite(value) ? null : value
      })
      if (values.every((value) => value === null)) continue
      let sum = 0
      const stack = values.map((value) => {
        if (value === null) return null
        if (!spec.stacked) return value
        sum += value
        return sum
      })
      out.push({ t: sample.t, values, stack })
    }
    return out
  }

  function draw(): void {
    const surface = prepare(canvas)
    if (!surface) return
    const palette = readPalette()
    const { ctx, width, height } = surface
    drawGrid(surface, palette, spec.axis === 'column' ? [0, 0.5, 1] : [1])
    const parts = spec.series.map((_, index) =>
      split(points, range.gapMs, (point) => point.stack[index] !== null).filter(
        (part) => part.length >= 2
      )
    )
    const coordsOf = (part: readonly Point[], index: number) =>
      part.map((point): [number, number] => [
        xOf(point.t, width),
        yOf(point.stack[index] ?? 0, height)
      ])
    spec.series.forEach((series, index) => {
      if (!series.area) return
      const color = palette.series[series.color - 1]
      for (const part of parts[index]) {
        const coords = coordsOf(part, index)
        ctx.beginPath()
        trace(ctx, coords)
        if (spec.stacked && index > 0) {
          for (let at = part.length - 1; at >= 0; at--) {
            ctx.lineTo(coords[at][0], yOf(part[at].stack[index - 1] ?? 0, height))
          }
        } else {
          ctx.lineTo(coords[coords.length - 1][0], height)
          ctx.lineTo(coords[0][0], height)
        }
        ctx.closePath()
        ctx.fillStyle = withAlpha(color, palette.areaAlpha + (index > 0 ? 0.02 : 0))
        ctx.fill()
      }
    })
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    spec.series.forEach((series, index) => {
      ctx.strokeStyle = palette.series[series.color - 1]
      for (const part of parts[index]) {
        ctx.beginPath()
        trace(ctx, coordsOf(part, index))
        ctx.stroke()
      }
    })
  }

  function nearest(t: number): Point | null {
    let best: Point | null = null
    for (const point of points) {
      if (!best || Math.abs(point.t - t) < Math.abs(best.t - t)) best = point
    }
    return best
  }

  function valueText(series: SeriesSpec, value: number | null): string {
    return value === null ? 'no reading' : series.format(value)
  }

  function describePoint(point: Point): string {
    const parts = spec.series.map(
      (series, index) => `${series.label} ${valueText(series, point.values[index])}`
    )
    return `${clockTime(point.t)}: ${parts.join(', ')}`
  }

  function hideHover(): void {
    cross.hidden = true
    tip.hidden = true
    for (const marker of markers) marker.hidden = true
  }

  function showHover(): void {
    const point = hoverT === null ? null : nearest(hoverT)
    const width = area.clientWidth
    const height = area.clientHeight
    if (!point || width <= 0 || height <= 0) {
      hideHover()
      return
    }
    hoverT = point.t
    const x = Math.round(xOf(point.t, width))
    cross.hidden = false
    cross.style.left = `${x}px`
    setText(tipTime, clockTime(point.t))
    spec.series.forEach((series, index) => {
      const value = point.values[index]
      const stacked = point.stack[index]
      setText(tipValues[index], value === null ? '–' : series.format(value))
      const marker = markers[index]
      marker.hidden = stacked === null
      if (stacked !== null) {
        marker.style.left = `${x - MARKER_RADIUS}px`
        marker.style.top = `${Math.round(yOf(stacked, height)) - MARKER_RADIUS}px`
      }
    })
    tip.hidden = false
    const tipWidth = tip.offsetWidth
    const left = x + TIP_GAP + tipWidth <= width ? x + TIP_GAP : Math.max(0, x - TIP_GAP - tipWidth)
    tip.style.left = `${left}px`
  }

  function describeChart(span: string): string {
    const latest = points[points.length - 1]
    const now = latest
      ? spec.series
          .map(
            (series, index) =>
              `${series.label.toLowerCase()} ${valueText(series, latest.values[index])}`
          )
          .join(', ')
      : 'no reading yet'
    const scaleText = spec.axis === 'none' ? '' : ` Scale 0 to ${scale.top}.`
    return `${spec.name} over ${span}. Now ${now}.${scaleText} Arrow keys read earlier values.`
  }

  function moveTo(next: number): void {
    if (points.length === 0) return
    const index = Math.max(0, Math.min(points.length - 1, next))
    hoverT = points[index].t
    following = index === points.length - 1
    showHover()
    setText(live, describePoint(points[index]))
  }

  function currentIndex(): number {
    const found = hoverT === null ? -1 : points.findIndex((point) => point.t === hoverT)
    return found < 0 ? points.length - 1 : found
  }

  area.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return
    const rect = area.getBoundingClientRect()
    const fraction = (event.clientX - rect.left) / Math.max(1, rect.width)
    hoverT = range.start + fraction * (range.end - range.start)
    following = false
    keyboard = false
    showHover()
  })
  area.addEventListener('pointerleave', () => {
    if (keyboard) return
    hoverT = null
    hideHover()
  })
  area.addEventListener('focus', () => {
    if (!area.matches(':focus-visible')) return
    keyboard = true
    if (hoverT === null && points.length > 0) {
      hoverT = points[points.length - 1].t
      following = true
    }
    showHover()
  })
  area.addEventListener('blur', () => {
    keyboard = false
    hoverT = null
    hideHover()
  })
  area.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !tip.hidden) {
      hoverT = null
      hideHover()
      event.preventDefault()
      event.stopPropagation()
      return
    }
    const last = points.length - 1
    const targets = new Map<string, () => number>([
      ['ArrowLeft', () => currentIndex() - 1],
      ['ArrowRight', () => currentIndex() + 1],
      ['PageUp', () => currentIndex() - PAGE_STEP],
      ['PageDown', () => currentIndex() + PAGE_STEP],
      ['Home', () => 0],
      ['End', () => last]
    ])
    const target = targets.get(event.key)
    if (!target) return
    keyboard = true
    event.preventDefault()
    moveTo(target())
  })

  hideHover()

  return {
    element,
    update(samples, nextRange, span) {
      range = nextRange
      points = toPoints(samples)
      let peak = 0
      for (const point of points) {
        for (const value of point.stack) if (value !== null && value > peak) peak = value
      }
      scale = spec.scale(peak)
      setText(axisTop, scale.top)
      setText(axisMid, scale.mid)
      setText(corner, scale.top)
      setAttr(area, 'aria-label', describeChart(span))
      if (following && points.length > 0) hoverT = points[points.length - 1].t
      draw()
      if (hoverT !== null) showHover()
    }
  }
}
