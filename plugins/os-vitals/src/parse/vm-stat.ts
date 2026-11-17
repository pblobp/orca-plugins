export type VmStat = {
  pageSize: number
  pages: Record<string, number>
}

const HEADER = /page size of (\d+) bytes/
const ROW = /^"?([^":]+)"?:\s+(\d+)\.?\s*$/

export function parseVmStat(text: string): VmStat | null {
  const lines = text.split('\n')
  const header = HEADER.exec(lines[0] ?? '')
  if (!header) return null
  const pageSize = Number(header[1])
  if (!Number.isFinite(pageSize) || pageSize <= 0) return null
  const pages: Record<string, number> = {}
  for (const line of lines.slice(1)) {
    const row = ROW.exec(line.trim())
    if (row) pages[row[1].trim().toLowerCase()] = Number(row[2])
  }
  return { pageSize, pages }
}
