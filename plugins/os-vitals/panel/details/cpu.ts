import { coreOrder, cpuChartSpec, cpuSubtitle } from '../cards/cpu.ts'
import { legendKey } from '../cards/common.ts'
import { createTimeChart, drawSparkline, readPalette } from '../charts.ts'
import { el, setText } from '../dom.ts'
import { cpuTime, duration, loadAverage, minutes, percent } from '../format.ts'
import {
  latestWithCores,
  TOP_QUERY,
  timeWindow,
  type PanelActions,
  type PanelModel
} from '../state.ts'
import { cpuText } from '../cards/top.ts'
import {
  card,
  detailFrame,
  detailView,
  heading,
  miniTable,
  sectionTitle,
  timeCaption
} from './frame.ts'

export function coreLabels(kinds: readonly (string | null)[]): string[] {
  const counters = new Map<string, number>()
  return kinds.map((kind) => {
    const prefix = kind === 'performance' ? 'P' : kind === 'efficiency' ? 'E' : 'C'
    const next = (counters.get(prefix) ?? 0) + 1
    counters.set(prefix, next)
    return `${prefix}${next}`
  })
}

export function createCpuView(actions: PanelActions) {
  const subtitle = el('span', { className: 'vt-sub' })
  const headline = el('div', { className: 'vt-huge', text: '–' })
  const user = legendKey('s1', 'User –')
  const system = legendKey('s2', 'System –')
  const idle = el('span', { className: 'vt-fg3' })
  const chart = createTimeChart(cpuChartSpec('detail-tall', 'column'))
  const caption = timeCaption()
  const load = el('span')
  const uptime = el('span')
  const usage = card('vt-cpu-h1', [
    el('div', { className: 'vt-card-head' }, [
      el('div', { className: 'vt-head-text' }, [heading('CPU', 'vt-cpu-h1'), subtitle]),
      headline
    ]),
    el('div', { className: 'vt-legend' }, [user.element, system.element, idle]),
    chart.element,
    caption.element,
    el('div', { className: 'vt-foot vt-rule' }, [load, uptime])
  ])

  const kindsNote = el('span', { className: 'vt-sub', text: 'P performance · E efficiency' })
  const grid = el('div', { className: 'vt-core-grid' })
  const cores = card('vt-cores-h2', [
    el('div', { className: 'vt-card-head vt-baseline' }, [
      sectionTitle('Cores', 'vt-cores-h2'),
      kindsNote
    ]),
    grid
  ])
  const cells: {
    element: HTMLElement
    label: HTMLElement
    value: HTMLElement
    canvas: HTMLCanvasElement
  }[] = []

  const table = miniTable(['Name', 'CPU %', 'CPU time'], ['vt-name', 'vt-num', 'vt-num vt-fg2'])
  const top = card(
    'vt-topcpu-h2',
    [sectionTitle('Top by CPU', 'vt-topcpu-h2'), table.element],
    'vt-card vt-top'
  )

  const frame = detailFrame(actions, [usage, cores, top])

  function syncCells(total: number): void {
    while (cells.length < total) {
      const label = el('span', { className: 'vt-fg3' })
      const value = el('span', { className: 'vt-core-value' })
      const canvas = el('canvas', { attrs: { 'aria-hidden': 'true' } })
      const element = el('div', { className: 'vt-core-cell' }, [
        el('div', { className: 'vt-core-top' }, [label, value]),
        canvas
      ])
      cells.push({ element, label, value, canvas })
      grid.append(element)
    }
    while (cells.length > total) cells.pop()?.element.remove()
  }

  function update(model: PanelModel): void {
    const { hello, samples } = model
    const latest = samples[samples.length - 1] ?? null
    setText(subtitle, cpuSubtitle(model))
    setText(headline, percent(latest?.total))
    setText(user.label, `User ${percent(latest?.user)}`)
    setText(system.label, `System ${percent(latest?.system)}`)
    setText(idle, latest ? `Idle ${percent(100 - latest.total)}` : 'Idle –')
    const range = timeWindow(model)
    chart.update(samples, range, minutes(model.historyMs))
    caption.update(model.historyMs)
    const current = model.current
    setText(load, current?.load ? `Load ${loadAverage(current.load)}` : '')
    setText(uptime, current ? `Up ${duration(current.uptime)}` : '')

    const order = coreOrder(hello.cores)
    const labels = coreLabels(order.map((index) => hello.cores[index].kind))
    kindsNote.hidden = !labels.some((label) => label.startsWith('P'))
    syncCells(order.length)
    const withCores = latestWithCores(samples)
    const palette = readPalette()
    const history = samples.filter((sample) => sample.cores)
    order.forEach((coreIndex, position) => {
      const cell = cells[position]
      setText(cell.label, labels[position])
      setText(cell.value, percent(withCores?.cores?.[coreIndex]))
      drawSparkline(
        cell.canvas,
        history.map((sample) => ({ t: sample.t, value: sample.cores?.[coreIndex] ?? 0 })),
        range,
        palette
      )
    })

    top.hidden = !model.sections.processes
    const rows = model.processes?.rows ?? []
    table.show(
      rows.map((row) => [row.name, cpuText(row.cpu), cpuTime(row.cpuTime)]),
      'Reading processes…'
    )
  }

  return detailView(frame, update, (model) => (model.sections.processes ? TOP_QUERY : null))
}
