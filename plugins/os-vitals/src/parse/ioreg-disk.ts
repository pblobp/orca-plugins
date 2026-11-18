export type DiskDriver = {
  id: string
  readBytes: number
  writeBytes: number
  reads: number
  writes: number
  image: boolean
}

const DRIVER = /^\+-o IOBlockStorageDriver\s+<class IOBlockStorageDriver, id (0x[0-9a-f]+)/i
const STATISTICS = /"Statistics" = \{(.*)\}/
const ENTRY = /"([^"]+)"=(\d+)/g
const MEDIA = /\+-o (.+?)\s+<class IOMedia,/
const IMAGE = /disk image/i

export function parseDictionary(body: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const match of body.matchAll(ENTRY)) out.set(match[1], Number(match[2]))
  return out
}

function finish(block: { id: string; lines: string[] }): DiskDriver | null {
  let stats: Map<string, number> | null = null
  let image = false
  for (const line of block.lines) {
    const found = STATISTICS.exec(line)
    if (found && !stats) stats = parseDictionary(found[1])
    const media = MEDIA.exec(line)
    if (media && IMAGE.test(media[1])) image = true
  }
  if (!stats) return null
  const value = (key: string) => stats.get(key)
  const readBytes = value('Bytes (Read)')
  const writeBytes = value('Bytes (Write)')
  if (readBytes === undefined || writeBytes === undefined) return null
  return {
    id: block.id,
    readBytes,
    writeBytes,
    reads: value('Operations (Read)') ?? 0,
    writes: value('Operations (Write)') ?? 0,
    image
  }
}

export function parseDiskDrivers(text: string): DiskDriver[] {
  const out: DiskDriver[] = []
  let block: { id: string; lines: string[] } | null = null
  const close = () => {
    const driver = block ? finish(block) : null
    if (driver) out.push(driver)
  }
  for (const line of text.split('\n')) {
    const start = DRIVER.exec(line)
    if (start) {
      close()
      block = { id: start[1].toLowerCase(), lines: [] }
    } else if (block) {
      block.lines.push(line)
    }
  }
  close()
  return out
}
