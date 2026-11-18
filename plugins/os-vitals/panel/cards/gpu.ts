import type { GpuReading, Sample } from '../../src/protocol.ts'
import { createTimeChart, percentScale, type ChartSpec } from '../charts.ts'
import { el, setText } from '../dom.ts'
import { bytes, minutes, percent } from '../format.ts'
import { timeWindow, type PanelActions, type PanelModel } from '../state.ts'
import { cardTitle } from './common.ts'

export function gpuChartSpec(size: ChartSpec['size'], axis: ChartSpec['axis']): ChartSpec {
  return {
    name: 'GPU usage',
    size,
    axis,
    scale: percentScale,
    series: [
      {
        label: 'GPU',
        color: 1,
        area: true,
        format: (value) => percent(value),
        value: (s: Sample) => s.gpu
      }
    ]
  }
}

export function gpuSubtitle(gpu: GpuReading): string {
  const name = gpu.model ?? 'GPU'
  return gpu.inUse === null ? name : `${name} · ${bytes(gpu.inUse)} in use`
}

export function createGpuCard(actions: PanelActions) {
  const title = cardTitle('GPU', 'vt-gpu-title', 'gpu', actions)
  const subtitle = el('span', { className: 'vt-sub' })
  const headline = el('div', { className: 'vt-big', text: '–' })
  const chart = createTimeChart(gpuChartSpec('micro', 'none'))
  const element = el(
    'section',
    { className: 'vt-card', attrs: { 'aria-labelledby': 'vt-gpu-title' } },
    [
      el('div', { className: 'vt-card-head' }, [
        el('div', { className: 'vt-head-text' }, [title, subtitle]),
        headline
      ]),
      chart.element
    ]
  )

  function update(model: PanelModel): void {
    const gpu = model.gpu
    element.hidden = !model.sections.gpu || gpu === null
    if (!gpu) return
    setText(subtitle, gpuSubtitle(gpu))
    setText(headline, percent(gpu.utilization))
    chart.update(model.samples, timeWindow(model), minutes(model.historyMs))
  }

  return { element, update }
}
