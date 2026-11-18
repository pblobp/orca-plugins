import type { Volume } from '../../src/protocol.ts'
import { factRows, legendKey, meter, ratePair, type Meter } from '../cards/common.ts'
import { diskChartSpec, usedLabel, usedText } from '../cards/disk.ts'
import { createTimeChart } from '../charts.ts'
import { el, setText } from '../dom.ts'
import { bytes, minutes, perSecond, rate } from '../format.ts'
import { timeWindow, type PanelActions, type PanelModel } from '../state.ts'
import { card, detailFrame, detailView, heading, sectionTitle, timeCaption } from './frame.ts'

type VolumeRow = {
  element: HTMLElement
  name: HTMLElement
  kind: HTMLElement
  free: HTMLElement
  bar: Meter
  used: HTMLElement
}

export function createDiskView(actions: PanelActions) {
  const rates = ratePair('read', 'write')
  const chart = createTimeChart(diskChartSpec('detail', 'column'))
  const caption = timeCaption()
  const usage = card('vt-disk-h1', [
    el('div', { className: 'vt-card-head' }, [
      el('div', { className: 'vt-head-text' }, [
        heading('Disk', 'vt-disk-h1'),
        el('span', { className: 'vt-sub', text: 'All drives' })
      ]),
      rates.element
    ]),
    chart.element,
    caption.element,
    el('div', { className: 'vt-legend' }, [
      legendKey('s1', 'Read').element,
      legendKey('s2', 'Write').element
    ])
  ])
  const facts = factRows(['Reads', 'Writes', 'Read since startup', 'Written since startup'])
  const activity = card('vt-disk-activity', [
    sectionTitle('Activity', 'vt-disk-activity'),
    facts.element
  ])
  const list = el('div', { className: 'vt-volumes' })
  const volumes = card('vt-disk-volumes', [sectionTitle('Volumes', 'vt-disk-volumes'), list])
  const rows: VolumeRow[] = []
  const frame = detailFrame(actions, [usage, activity, volumes])

  function syncRows(count: number): void {
    while (rows.length < count) {
      const name = el('span', { className: 'vt-volume-name' })
      const kind = el('span', { className: 'vt-tag' })
      const free = el('span', { className: 'vt-fg2' })
      const bar = meter()
      const used = el('span', { className: 'vt-sub' })
      const element = el('div', { className: 'vt-volume' }, [
        el('div', { className: 'vt-row' }, [
          el('span', { className: 'vt-key' }, [name, kind]),
          free
        ]),
        bar.element,
        used
      ])
      rows.push({ element, name, kind, free, bar, used })
      list.append(element)
    }
    while (rows.length > count) rows.pop()?.element.remove()
  }

  function showVolume(row: VolumeRow, volume: Volume): void {
    setText(row.name, volume.name)
    row.name.title = volume.mount
    setText(row.kind, volume.startup ? 'Startup' : '')
    row.kind.hidden = !volume.startup
    setText(row.free, `${bytes(volume.available)} free`)
    row.bar.set((volume.total - volume.available) / volume.total, usedLabel(volume))
    setText(row.used, usedText(volume))
  }

  function update(model: PanelModel): void {
    const disk = model.disk
    rates.set(rate(disk?.read), rate(disk?.write))
    chart.update(model.samples, timeWindow(model), minutes(model.historyMs))
    caption.update(model.historyMs)
    const [reads, writes, readTotal, writeTotal] = facts.values
    setText(reads, perSecond(disk?.reads))
    setText(writes, perSecond(disk?.writes))
    setText(readTotal, bytes(disk?.readTotal))
    setText(writeTotal, bytes(disk?.writeTotal))
    const shown = model.volumes ?? []
    volumes.hidden = shown.length === 0
    syncRows(shown.length)
    shown.forEach((volume, index) => showVolume(rows[index], volume))
  }

  return detailView(frame, update)
}
