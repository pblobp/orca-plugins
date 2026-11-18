import type { DiskDriver } from './parse/ioreg-disk.ts'
import { macInterface, type Classifier } from './interfaces.ts'
import type { InterfaceCounters } from './parse/netstat.ts'
import type { DiskReading, InterfaceRate, NetworkReading } from './protocol.ts'

export const INTERFACE_LIMIT = 12

export function grew(previous: number, current: number): number {
  return Number.isFinite(previous) && Number.isFinite(current) && current > previous
    ? current - previous
    : 0
}

const perSecond = (amount: number, seconds: number) => Math.round(amount / seconds)

export function networkReading(
  previous: readonly InterfaceCounters[],
  current: readonly InterfaceCounters[],
  seconds: number,
  t: number,
  defaultInterface: string | null,
  classify: Classifier = macInterface
): NetworkReading {
  const before = new Map(previous.map((entry) => [entry.name, entry]))
  const reading: NetworkReading = {
    t,
    down: 0,
    up: 0,
    packetsIn: 0,
    packetsOut: 0,
    received: 0,
    sent: 0,
    defaultInterface,
    interfaces: []
  }
  let packetsIn = 0
  let packetsOut = 0
  const rows: InterfaceRate[] = []
  for (const entry of current) {
    const { kind, counted } = classify(entry.name)
    if (counted) {
      reading.received += entry.rxBytes
      reading.sent += entry.txBytes
    }
    const old = before.get(entry.name)
    if (!old) continue
    const down = perSecond(grew(old.rxBytes, entry.rxBytes), seconds)
    const up = perSecond(grew(old.txBytes, entry.txBytes), seconds)
    if (counted) {
      reading.down += down
      reading.up += up
      packetsIn += grew(old.rxPackets, entry.rxPackets)
      packetsOut += grew(old.txPackets, entry.txPackets)
    }
    if (down + up > 0) rows.push({ name: entry.name, kind, counted, down, up })
  }
  reading.packetsIn = perSecond(packetsIn, seconds)
  reading.packetsOut = perSecond(packetsOut, seconds)
  reading.interfaces = rows
    .sort((a, b) => b.down + b.up - (a.down + a.up) || a.name.localeCompare(b.name))
    .slice(0, INTERFACE_LIMIT)
  return reading
}

export function diskReading(
  previous: readonly DiskDriver[],
  current: readonly DiskDriver[],
  seconds: number,
  t: number
): DiskReading {
  const before = new Map(previous.map((entry) => [entry.id, entry]))
  const reading: DiskReading = {
    t,
    read: 0,
    write: 0,
    reads: 0,
    writes: 0,
    readTotal: 0,
    writeTotal: 0
  }
  let read = 0
  let write = 0
  let reads = 0
  let writes = 0
  for (const entry of current) {
    if (entry.image) continue
    reading.readTotal += entry.readBytes
    reading.writeTotal += entry.writeBytes
    const old = before.get(entry.id)
    if (!old || old.image) continue
    read += grew(old.readBytes, entry.readBytes)
    write += grew(old.writeBytes, entry.writeBytes)
    reads += grew(old.reads, entry.reads)
    writes += grew(old.writes, entry.writes)
  }
  reading.read = perSecond(read, seconds)
  reading.write = perSecond(write, seconds)
  reading.reads = perSecond(reads, seconds)
  reading.writes = perSecond(writes, seconds)
  return reading
}
