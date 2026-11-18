import type { Sample, Volume } from '../../src/protocol.ts'
import { createTimeChart, type ChartSpec } from '../charts.ts'
import { el, setText } from '../dom.ts'
import { bytes, minutes, portion, rate, rateScale } from '../format.ts'
import { timeWindow, type PanelActions, type PanelModel } from '../state.ts'
import { cardTitle, legendKey, meter, ratePair } from './common.ts'

export function diskChartSpec(size: ChartSpec['size'], axis: ChartSpec['axis']): ChartSpec {
  return {
    name: 'Disk read and write rate',
    size,
    axis,
    scale: rateScale,
    series: [
      {
        label: 'Read',
        color: 1,
        area: true,
        format: rate,
        value: (s: Sample) => s.disk?.read ?? null
      },
      { label: 'Write', color: 2, format: rate, value: (s: Sample) => s.disk?.write ?? null }
    ]
  }
}

export function usedText(volume: Volume): string {
  return `${portion(volume.total - volume.available, volume.total)} used`
}

export function usedLabel(volume: Volume): string {
  return `${volume.name}: ${usedText(volume)}, ${bytes(volume.available)} free`
}

export function createDiskCard(actions: PanelActions) {
  const title = cardTitle('Disk', 'vt-disk-title', 'disk', actions)
  const subtitle = el('span', { className: 'vt-sub' })
  const rates = ratePair('read', 'write')
  const chart = createTimeChart(diskChartSpec('mini', 'corner'))
  const space = meter()
  const used = el('span')
  const free = el('span')
  const spaceBlock = el('div', { className: 'vt-space' }, [
    space.element,
    el('div', { className: 'vt-foot' }, [used, free])
  ])
  const element = el(
    'section',
    { className: 'vt-card', attrs: { 'aria-labelledby': 'vt-disk-title' } },
    [
      el('div', { className: 'vt-card-head' }, [
        el('div', { className: 'vt-head-text' }, [title, subtitle]),
        rates.element
      ]),
      chart.element,
      el('div', { className: 'vt-legend' }, [
        legendKey('s1', 'Read').element,
        legendKey('s2', 'Write').element
      ]),
      spaceBlock
    ]
  )

  function update(model: PanelModel): void {
    element.hidden = !model.sections.disk
    if (element.hidden) return
    rates.set(rate(model.disk?.read), rate(model.disk?.write))
    const startup = model.volumes?.find((volume) => volume.startup) ?? null
    setText(subtitle, startup ? startup.name : 'All drives')
    spaceBlock.hidden = startup === null
    if (startup) {
      space.set((startup.total - startup.available) / startup.total, usedLabel(startup))
      setText(used, usedText(startup))
      setText(free, `${bytes(startup.available)} free`)
    }
    chart.update(model.samples, timeWindow(model), minutes(model.historyMs))
  }

  return { element, update }
}
