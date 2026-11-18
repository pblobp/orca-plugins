import type { MemoryPressure, MemoryReading } from '../../src/protocol.ts'
import { CHECK_ICON, el, icon, setAttr, setText, WARNING_ICON } from '../dom.ts'
import { bytes, gigabytes } from '../format.ts'
import type { PanelActions, PanelModel } from '../state.ts'
import { cardTitle } from './common.ts'

export type Part = {
  label: string
  series: string
  value: (memory: MemoryReading) => number | null
}

const DETAILED: readonly Part[] = [
  { label: 'App', series: 's1', value: (m) => m.app },
  { label: 'Wired', series: 's2', value: (m) => m.wired },
  { label: 'Compressed', series: 's3', value: (m) => m.compressed },
  { label: 'Cached files', series: 's4', value: (m) => m.cached }
]

const SIMPLE: readonly Part[] = [{ label: 'Used', series: 's1', value: (m) => m.used }]

const LINUX: readonly Part[] = [
  { label: 'Used', series: 's1', value: (m) => m.used },
  { label: 'Buffers', series: 's2', value: (m) => m.buffers },
  { label: 'Cached', series: 's4', value: (m) => m.cached }
]

export const FREE: Part = { label: 'Free', series: 'free', value: (m) => m.free }

const PRESSURE_TEXT: Record<MemoryPressure, string> = {
  normal: 'Pressure normal',
  warning: 'Pressure elevated',
  critical: 'Pressure critical'
}

export function memoryParts(memory: MemoryReading): readonly Part[] {
  if (memory.app !== null) return DETAILED
  return memory.buffers !== null ? LINUX : SIMPLE
}

export function segmentShares(values: readonly number[], total: number): number[] {
  let left = 100
  return values.map((value) => {
    const share = total > 0 ? Math.max(0, Math.min(left, (100 * value) / total)) : 0
    left -= share
    return share
  })
}

export function isSimple(parts: readonly Part[]): boolean {
  return parts === SIMPLE
}

export function createPressure() {
  const pressureIcon = el('span', { className: 'vt-pressure-icon' })
  const pressureText = el('span')
  const element = el('span', { className: 'vt-pressure' }, [pressureIcon, pressureText])
  let shown: MemoryPressure | null | undefined
  return {
    element,
    update(pressure: MemoryPressure | null) {
      element.hidden = pressure === null
      if (pressure && pressure !== shown) {
        const tone = pressure === 'normal' ? 'good' : pressure === 'warning' ? 'warn' : 'crit'
        pressureIcon.replaceChildren(
          icon(pressure === 'normal' ? CHECK_ICON : WARNING_ICON, `vt-icon-stroke vt-${tone}`)
        )
        setText(pressureText, PRESSURE_TEXT[pressure])
      }
      shown = pressure
    }
  }
}

export function createMemoryCard(actions: PanelActions) {
  const title = cardTitle('Memory', 'vt-mem-title', 'memory', actions)
  const used = el('span', { className: 'vt-big', text: '–' })
  const of = el('span', { className: 'vt-sub' })
  const bar = el('div', { className: 'vt-membar', attrs: { role: 'img' } })
  const free = el('div', { className: 'vt-seg vt-seg-free' })
  const legend = el('div', { className: 'vt-memlegend' })
  const pressure = createPressure()
  const swap = el('span')
  const element = el(
    'section',
    { className: 'vt-card', attrs: { 'aria-labelledby': 'vt-mem-title' } },
    [
      el('div', { className: 'vt-card-head' }, [
        title,
        el('div', { className: 'vt-amount' }, [used, of])
      ]),
      bar,
      legend,
      el('div', { className: 'vt-foot' }, [pressure.element, swap])
    ]
  )
  let shownParts: readonly Part[] | null = null
  let segments: HTMLElement[] = []
  let values: HTMLElement[] = []

  function build(parts: readonly Part[]): void {
    shownParts = parts
    segments = parts.map((part) => el('div', { className: `vt-seg vt-${part.series}` }))
    bar.replaceChildren(...segments, free)
    const listed = parts === DETAILED ? parts : [...parts, FREE]
    values = listed.map(() => el('span', { className: 'vt-value' }))
    legend.replaceChildren(
      ...listed.map((part, index) =>
        el('div', { className: 'vt-memrow' }, [
          el('span', { className: 'vt-key' }, [
            el('span', {
              className: `vt-swatch vt-${part.series}`,
              attrs: { 'aria-hidden': 'true' }
            }),
            el('span', { text: part.label })
          ]),
          values[index]
        ])
      )
    )
  }

  function update(model: PanelModel): void {
    element.hidden = !model.sections.memory
    const memory = model.memory
    if (!memory) {
      setText(used, '–')
      setText(of, model.hello.totalMemory > 0 ? `of ${gigabytes(model.hello.totalMemory)} GB` : '')
      pressure.update(null)
      setText(swap, '')
      return
    }
    const parts = memoryParts(memory)
    if (parts !== shownParts) build(parts)
    setText(used, gigabytes(memory.used))
    setText(of, `of ${gigabytes(memory.total)} GB`)
    const described: string[] = []
    const amounts = parts.map((part) => part.value(memory) ?? 0)
    const shares = segmentShares(amounts, memory.total)
    parts.forEach((part, index) => {
      segments[index].style.flexBasis = `${shares[index]}%`
      setText(values[index], bytes(amounts[index]))
      described.push(`${part.label.toLowerCase()} ${gigabytes(amounts[index])}`)
    })
    if (parts !== DETAILED) setText(values[parts.length], bytes(memory.free))
    described.push(`free ${gigabytes(memory.free)}`)
    setAttr(bar, 'aria-label', `Memory in use: ${described.join(', ')} gigabytes`)

    pressure.update(memory.pressure)
    setText(swap, memory.swapUsed === null ? '' : `Swap ${bytes(memory.swapUsed)}`)
  }

  return { element, update }
}
