import type { MemoryPressure, MemoryReading } from '../../src/protocol.ts'
import { CHECK_ICON, el, icon, setAttr, setText, WARNING_ICON } from '../dom.ts'
import { bytes, gigabytes } from '../format.ts'
import type { PanelModel } from '../state.ts'

type Part = { label: string; series: string; value: (memory: MemoryReading) => number | null }

const DETAILED: readonly Part[] = [
  { label: 'App', series: 's1', value: (m) => m.app },
  { label: 'Wired', series: 's2', value: (m) => m.wired },
  { label: 'Compressed', series: 's3', value: (m) => m.compressed },
  { label: 'Cached files', series: 's4', value: (m) => m.cached }
]

const SIMPLE: readonly Part[] = [{ label: 'Used', series: 's1', value: (m) => m.used }]

const FREE: Part = { label: 'Free', series: 'free', value: (m) => m.free }

const PRESSURE_TEXT: Record<MemoryPressure, string> = {
  normal: 'Pressure normal',
  warning: 'Pressure elevated',
  critical: 'Pressure critical'
}

export function memoryParts(memory: MemoryReading): readonly Part[] {
  return memory.app === null ? SIMPLE : DETAILED
}

export function createMemoryCard() {
  const title = el('h2', { className: 'vt-title', text: 'Memory', attrs: { id: 'vt-mem-title' } })
  const used = el('span', { className: 'vt-big', text: '–' })
  const of = el('span', { className: 'vt-sub' })
  const bar = el('div', { className: 'vt-membar', attrs: { role: 'img' } })
  const free = el('div', { className: 'vt-seg vt-seg-free' })
  const legend = el('div', { className: 'vt-memlegend' })
  const pressureIcon = el('span', { className: 'vt-pressure-icon' })
  const pressureText = el('span')
  const pressure = el('span', { className: 'vt-pressure' }, [pressureIcon, pressureText])
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
      el('div', { className: 'vt-foot' }, [pressure, swap])
    ]
  )
  let shownParts: readonly Part[] | null = null
  let segments: HTMLElement[] = []
  let values: HTMLElement[] = []
  let shownPressure: MemoryPressure | null | undefined

  function build(parts: readonly Part[]): void {
    shownParts = parts
    segments = parts.map((part) => el('div', { className: `vt-seg vt-${part.series}` }))
    bar.replaceChildren(...segments, free)
    const listed = parts === SIMPLE ? [...parts, FREE] : parts
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
    element.hidden = !model.hello.sections.memory
    const memory = model.memory
    if (!memory) {
      setText(used, '–')
      setText(of, model.hello.totalMemory > 0 ? `of ${gigabytes(model.hello.totalMemory)} GB` : '')
      pressure.hidden = true
      setText(swap, '')
      return
    }
    const parts = memoryParts(memory)
    if (parts !== shownParts) build(parts)
    setText(used, gigabytes(memory.used))
    setText(of, `of ${gigabytes(memory.total)} GB`)
    const described: string[] = []
    parts.forEach((part, index) => {
      const value = part.value(memory) ?? 0
      segments[index].style.flexBasis = `${(100 * value) / memory.total}%`
      setText(values[index], bytes(value))
      described.push(`${part.label.toLowerCase()} ${gigabytes(value)}`)
    })
    if (parts === SIMPLE) setText(values[parts.length], bytes(memory.free))
    described.push(`free ${gigabytes(memory.free)}`)
    setAttr(bar, 'aria-label', `Memory in use: ${described.join(', ')} gigabytes`)

    pressure.hidden = memory.pressure === null
    if (memory.pressure && memory.pressure !== shownPressure) {
      const tone =
        memory.pressure === 'normal' ? 'good' : memory.pressure === 'warning' ? 'warn' : 'crit'
      pressureIcon.replaceChildren(
        icon(memory.pressure === 'normal' ? CHECK_ICON : WARNING_ICON, `vt-icon-stroke vt-${tone}`)
      )
      setText(pressureText, PRESSURE_TEXT[memory.pressure])
    }
    shownPressure = memory.pressure
    setText(swap, memory.swapUsed === null ? '' : `Swap ${bytes(memory.swapUsed)}`)
  }

  return { element, update }
}
