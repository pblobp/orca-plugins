import type { InterfaceRate } from '../../src/protocol.ts'
import { legendKey, factRows, ratePair } from '../cards/common.ts'
import { networkChartSpec } from '../cards/network.ts'
import { createTimeChart } from '../charts.ts'
import { el, setText } from '../dom.ts'
import { bytes, minutes, perSecond, rate } from '../format.ts'
import { timeWindow, type PanelActions, type PanelModel } from '../state.ts'
import {
  card,
  detailFrame,
  detailView,
  heading,
  miniTable,
  sectionTitle,
  timeCaption
} from './frame.ts'

const KIND_TEXT = {
  loopback: 'Loopback',
  tunnel: 'Tunnel',
  bridge: 'Bridge',
  virtual: 'Virtual',
  'wireless-helper': 'Apple wireless'
}

export const MAC_NOTE =
  'Totals leave out loopback, bridges, tunnels and Apple wireless helpers: their traffic stays on this Mac or is counted on another interface.'

export const LINUX_NOTE =
  'Totals leave out loopback, Docker and other bridges, veth pairs and tunnels: their traffic stays on this computer or is counted on another interface.'

export function interfaceKindText(row: InterfaceRate, defaultInterface: string | null): string {
  if (row.kind) return KIND_TEXT[row.kind]
  return row.name === defaultInterface ? 'Default' : ''
}

export function createNetworkView(actions: PanelActions) {
  const subtitle = el('span', { className: 'vt-sub' })
  const rates = ratePair('down', 'up')
  const chart = createTimeChart(networkChartSpec('detail', 'column'))
  const caption = timeCaption()
  const usage = card('vt-net-h1', [
    el('div', { className: 'vt-card-head' }, [
      el('div', { className: 'vt-head-text' }, [heading('Network', 'vt-net-h1'), subtitle]),
      rates.element
    ]),
    chart.element,
    caption.element,
    el('div', { className: 'vt-legend' }, [
      legendKey('s1', 'Download').element,
      legendKey('s2', 'Upload').element
    ])
  ])
  const totals = factRows(['Received', 'Sent', 'Packets in', 'Packets out'])
  const since = card('vt-net-total', [
    sectionTitle('Since startup', 'vt-net-total'),
    totals.element
  ])
  const table = miniTable(['Name', 'Down', 'Up'], ['vt-name', 'vt-num', 'vt-num'])
  const note = el('p', { className: 'vt-note' })
  const interfaces = card(
    'vt-net-ifaces',
    [sectionTitle('Interfaces', 'vt-net-ifaces'), table.element, note],
    'vt-card vt-top'
  )
  const frame = detailFrame(actions, [usage, since, interfaces])

  function update(model: PanelModel): void {
    setText(note, model.hello.platform === 'linux' ? LINUX_NOTE : MAC_NOTE)
    const network = model.network
    rates.set(rate(network?.down), rate(network?.up))
    const route = network?.defaultInterface ?? null
    setText(
      subtitle,
      network ? (route ? `${route} · default route` : 'No default route') : 'Measuring…'
    )
    chart.update(model.samples, timeWindow(model), minutes(model.historyMs))
    caption.update(model.historyMs)
    const [received, sent, packetsIn, packetsOut] = totals.values
    setText(received, bytes(network?.received))
    setText(sent, bytes(network?.sent))
    setText(packetsIn, perSecond(network?.packetsIn))
    setText(packetsOut, perSecond(network?.packetsOut))
    table.show(
      (network?.interfaces ?? []).map((row) => [
        { text: row.name, tag: interfaceKindText(row, route) },
        rate(row.down),
        rate(row.up)
      ]),
      network ? 'No interface carried traffic in the last reading.' : 'Measuring…'
    )
  }

  return detailView(frame, update)
}
