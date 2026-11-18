import type { Sample } from '../../src/protocol.ts'
import { createTimeChart, type ChartSpec } from '../charts.ts'
import { el, setText } from '../dom.ts'
import { minutes, rate, rateScale } from '../format.ts'
import { timeWindow, type PanelActions, type PanelModel } from '../state.ts'
import { cardTitle, legendKey, ratePair } from './common.ts'

export function networkChartSpec(size: ChartSpec['size'], axis: ChartSpec['axis']): ChartSpec {
  return {
    name: 'Download and upload rate',
    size,
    axis,
    scale: rateScale,
    series: [
      {
        label: 'Download',
        color: 1,
        area: true,
        format: rate,
        value: (s: Sample) => s.net?.down ?? null
      },
      { label: 'Upload', color: 2, format: rate, value: (s: Sample) => s.net?.up ?? null }
    ]
  }
}

export function createNetworkCard(actions: PanelActions) {
  const title = cardTitle('Network', 'vt-net-title', 'network', actions)
  const subtitle = el('span', { className: 'vt-sub' })
  const rates = ratePair('down', 'up')
  const chart = createTimeChart(networkChartSpec('mini', 'corner'))
  const element = el(
    'section',
    { className: 'vt-card', attrs: { 'aria-labelledby': 'vt-net-title' } },
    [
      el('div', { className: 'vt-card-head' }, [
        el('div', { className: 'vt-head-text' }, [title, subtitle]),
        rates.element
      ]),
      chart.element,
      el('div', { className: 'vt-legend' }, [
        legendKey('s1', 'Download').element,
        legendKey('s2', 'Upload').element
      ])
    ]
  )

  function update(model: PanelModel): void {
    element.hidden = !model.sections.network
    if (element.hidden) return
    const network = model.network
    rates.set(rate(network?.down), rate(network?.up))
    setText(subtitle, network ? (network.defaultInterface ?? 'No default route') : 'Measuring…')
    chart.update(model.samples, timeWindow(model), minutes(model.historyMs))
  }

  return { element, update }
}
