export type DfRow = {
  device: string
  mount: string
  total: number
  used: number
  available: number
}

const ROW = /^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(\/.*)$/
const WHOLE_DISK = /^\/dev\/(disk\d+)/
const KIB = 1024

export function parseDf(text: string): DfRow[] {
  const out: DfRow[] = []
  for (const line of text.split('\n').slice(1)) {
    const match = ROW.exec(line.trimEnd())
    if (!match) continue
    out.push({
      device: match[1],
      mount: match[6],
      total: Number(match[2]) * KIB,
      used: Number(match[3]) * KIB,
      available: Number(match[4]) * KIB
    })
  }
  return out
}

function wholeDisk(device: string): string | null {
  const match = WHOLE_DISK.exec(device)
  return match ? match[1] : null
}

export function otherVolumes(rows: readonly DfRow[], startupMounts: readonly string[]): DfRow[] {
  const startup = new Set<string>()
  for (const row of rows) {
    const disk = startupMounts.includes(row.mount) ? wholeDisk(row.device) : null
    if (disk) startup.add(disk)
  }
  return rows.filter((row) => {
    const disk = wholeDisk(row.device)
    return (
      disk !== null &&
      !startup.has(disk) &&
      row.mount.startsWith('/Volumes/') &&
      row.mount.length > '/Volumes/'.length &&
      row.total > 0
    )
  })
}
