import type { MemoryReading, Sample } from '../../src/protocol.ts'
import { createPressure, FREE, memoryParts, segmentShares, type Part } from '../cards/memory.ts'
import { meter } from '../cards/common.ts'
import { createTimeChart } from '../charts.ts'
import { el, setText } from '../dom.ts'
import { bytes, gigabytes, minutes, percent, portion, significant } from '../format.ts'
import { TOP_MEMORY_QUERY, timeWindow, type PanelActions, type PanelModel } from '../state.ts'
import {
  card,
  detailFrame,
  detailView,
  heading,
  miniTable,
  sectionTitle,
  timeCaption
} from './frame.ts'

const GB = 1024 ** 3

export function memoryScale(total: number) {
  const max = total > 0 ? total : GB
  return { max, top: `${significant(max / GB)} GB`, mid: significant(max / GB / 2) }
}

export function createMemoryView(actions: PanelActions) {
  const pressure = createPressure()
  const used = el('span', { className: 'vt-huge', text: '–' })
  const of = el('span', { className: 'vt-sub' })
  let total = 0
  const chart = createTimeChart({
    name: 'Memory in use',
    size: 'detail-short',
    axis: 'column',
    scale: () => memoryScale(total),
    series: [
      {
        label: 'In use',
        color: 1,
        area: true,
        format: (value) => `${gigabytes(value)} GB`,
        value: (s: Sample) => s.memory?.used ?? null
      }
    ]
  })
  const caption = timeCaption()
  const usage = card('vt-mem-h1', [
    el('div', { className: 'vt-card-head' }, [
      el('div', { className: 'vt-head-text' }, [heading('Memory', 'vt-mem-h1'), pressure.element]),
      el('div', { className: 'vt-amount' }, [used, of])
    ]),
    chart.element,
    caption.element
  ])

  const bar = el('div', { className: 'vt-membar', attrs: { role: 'img' } })
  const free = el('div', { className: 'vt-seg vt-seg-free' })
  const rows = el('div', { className: 'vt-rows' })
  const breakdown = card('vt-mem-parts', [
    sectionTitle('What is using it', 'vt-mem-parts'),
    bar,
    rows
  ])
  let shownParts: readonly Part[] | null = null
  let segments: HTMLElement[] = []
  let cells: { value: HTMLElement; share: HTMLElement }[] = []

  const swapAmount = el('span', { className: 'vt-value' })
  const swapBar = meter('s1')
  const swap = card('vt-swap-h2', [
    el('div', { className: 'vt-card-head vt-baseline' }, [
      sectionTitle('Swap', 'vt-swap-h2'),
      swapAmount
    ]),
    swapBar.element
  ])

  const table = miniTable(['Name', 'Memory', 'PID'], ['vt-name', 'vt-num', 'vt-num vt-fg2'])
  const top = card(
    'vt-topmem-h2',
    [sectionTitle('Top by memory', 'vt-topmem-h2'), table.element],
    'vt-card vt-top'
  )
  const frame = detailFrame(actions, [usage, breakdown, swap, top])

  function build(parts: readonly Part[]): void {
    shownParts = parts
    segments = parts.map((part) => el('div', { className: `vt-seg vt-${part.series}` }))
    bar.replaceChildren(...segments, free)
    const listed = [...parts, FREE]
    cells = listed.map(() => ({
      value: el('span', { className: 'vt-value' }),
      share: el('span', { className: 'vt-share' })
    }))
    rows.replaceChildren(
      ...listed.map((part, index) =>
        el('div', { className: 'vt-kv' }, [
          el('span', { className: 'vt-key' }, [
            el('span', {
              className: `vt-swatch vt-${part.series}`,
              attrs: { 'aria-hidden': 'true' }
            }),
            el('span', { text: part.label })
          ]),
          el('span', { className: 'vt-row-end' }, [cells[index].value, cells[index].share])
        ])
      )
    )
  }

  function showMemory(memory: MemoryReading): void {
    const parts = memoryParts(memory)
    if (parts !== shownParts) build(parts)
    const listed = [...parts, FREE]
    const described: string[] = []
    const shares = segmentShares(
      parts.map((part) => part.value(memory) ?? 0),
      memory.total
    )
    listed.forEach((part, index) => {
      const value = part.value(memory) ?? 0
      if (index < parts.length) segments[index].style.flexBasis = `${shares[index]}%`
      setText(cells[index].value, bytes(value))
      setText(cells[index].share, percent((100 * value) / memory.total))
      described.push(`${part.label.toLowerCase()} ${gigabytes(value)}`)
    })
    bar.setAttribute('aria-label', `Memory: ${described.join(', ')} gigabytes`)
  }

  function update(model: PanelModel): void {
    const memory = model.memory
    total = memory?.total ?? model.hello.totalMemory
    pressure.update(memory?.pressure ?? null)
    setText(used, memory ? gigabytes(memory.used) : '–')
    setText(of, total > 0 ? `of ${gigabytes(total)} GB` : '')
    chart.update(model.samples, timeWindow(model), minutes(model.historyMs))
    caption.update(model.historyMs)
    breakdown.hidden = memory === null
    if (memory) showMemory(memory)
    swap.hidden = !memory || memory.swapUsed === null || memory.swapTotal === null
    if (memory && memory.swapUsed !== null && memory.swapTotal !== null) {
      const none = memory.swapTotal <= 0
      swapBar.element.hidden = none
      setText(swapAmount, none ? 'Not in use' : portion(memory.swapUsed, memory.swapTotal))
      swapBar.set(
        none ? 0 : memory.swapUsed / memory.swapTotal,
        none ? 'No swap in use' : `${portion(memory.swapUsed, memory.swapTotal)} of swap used`
      )
    }
    top.hidden = !model.sections.processes
    table.show(
      (model.processes?.rows ?? []).map((row) => [row.name, bytes(row.memory), String(row.pid)]),
      'Reading processes…'
    )
  }

  return detailView(frame, update, (model) => (model.sections.processes ? TOP_MEMORY_QUERY : null))
}
