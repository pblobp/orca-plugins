import { macInterface } from '../interfaces.ts'
import type { InterfaceKind } from '../protocol.ts'

export type InterfaceCounters = {
  name: string
  rxBytes: number
  txBytes: number
  rxPackets: number
  txPackets: number
}

const LINK = /^<Link#\d+>$/
const COUNT = /^\d+$/
const ROUTE_INTERFACE = /^\s*interface:\s*(\S+)\s*$/m
const COLUMNS = ['Ipkts', 'Ibytes', 'Opkts', 'Obytes'] as const

export function interfaceKind(name: string): InterfaceKind {
  return macInterface(name).kind
}

export function countsInTotals(name: string): boolean {
  return macInterface(name).counted
}

export function parseNetstat(text: string): InterfaceCounters[] | null {
  const lines = text.split('\n')
  const header = (lines[0] ?? '').trim().split(/\s+/)
  const fromRight = (column: string) => {
    const index = header.indexOf(column)
    return index < 0 ? -1 : header.length - 1 - index
  }
  const offsets = COLUMNS.map(fromRight)
  if (header[0] !== 'Name' || offsets.some((offset) => offset < 0)) return null
  const [rxPackets, rxBytes, txPackets, txBytes] = offsets
  const seen = new Map<string, InterfaceCounters>()
  for (const line of lines.slice(1)) {
    const tokens = line.trim().split(/\s+/)
    if (tokens.length < header.length - 1 || !LINK.test(tokens[2] ?? '')) continue
    const pick = (offset: number) => tokens[tokens.length - 1 - offset]
    const values = [pick(rxBytes), pick(txBytes), pick(rxPackets), pick(txPackets)]
    if (!values.every((value) => value !== undefined && COUNT.test(value))) continue
    const name = tokens[0].replace(/\*$/, '')
    if (name === '' || seen.has(name)) continue
    const [rx, tx, rxp, txp] = values.map(Number)
    seen.set(name, { name, rxBytes: rx, txBytes: tx, rxPackets: rxp, txPackets: txp })
  }
  return [...seen.values()]
}

export function parseDefaultRoute(text: string): string | null {
  const match = ROUTE_INTERFACE.exec(text)
  return match ? match[1] : null
}
