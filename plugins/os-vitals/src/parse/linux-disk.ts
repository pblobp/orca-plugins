import type { DiskDriver } from './ioreg-disk.ts'

export type MountRow = { device: string; mount: string; type: string }

export const SECTOR_BYTES = 512
const ESCAPE = /\\([0-7]{3})/g
const HIDDEN_ROOTS: readonly string[] = [
  '/proc',
  '/sys',
  '/dev',
  '/etc',
  '/run',
  '/snap',
  '/var/lib/docker',
  '/var/snap'
]
const SHOWN_UNDER_RUN: readonly string[] = ['/run/media/']
const SKIPPED_TYPES = new Set(['squashfs', 'overlay', 'tmpfs', 'devtmpfs', 'ramfs', 'iso9660'])

export function parseDiskstats(text: string): DiskDriver[] {
  const out: DiskDriver[] = []
  for (const line of text.split('\n')) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 14) continue
    const numbers = [3, 5, 7, 9].map((index) => Number(fields[index]))
    if (!numbers.every((value) => Number.isFinite(value) && value >= 0)) continue
    const [reads, sectorsRead, writes, sectorsWritten] = numbers
    out.push({
      id: fields[2],
      readBytes: sectorsRead * SECTOR_BYTES,
      writeBytes: sectorsWritten * SECTOR_BYTES,
      reads,
      writes,
      image: false
    })
  }
  return out
}

export function sysBlockName(device: string): string | null {
  if (device === '' || device.includes('..') || device.startsWith('.')) return null
  return device.replace(/\//g, '!')
}

export function unescapeMount(text: string): string {
  return text.replace(ESCAPE, (_, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)))
}

export function parseMounts(text: string): MountRow[] {
  const out: MountRow[] = []
  for (const line of text.split('\n')) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 3) continue
    out.push({ device: unescapeMount(fields[0]), mount: unescapeMount(fields[1]), type: fields[2] })
  }
  return out
}

function hiddenPath(mount: string): boolean {
  if (SHOWN_UNDER_RUN.some((root) => mount.startsWith(root))) return false
  return HIDDEN_ROOTS.some((root) => mount === root || mount.startsWith(`${root}/`))
}

export function realMounts(rows: readonly MountRow[]): string[] {
  const byDevice = new Map<string, string>()
  for (const row of rows) {
    if (row.mount === '/' || !row.device.startsWith('/dev/')) continue
    if (SKIPPED_TYPES.has(row.type) || hiddenPath(row.mount)) continue
    const known = byDevice.get(row.device)
    if (known === undefined || row.mount.length < known.length) byDevice.set(row.device, row.mount)
  }
  const rootDevices = new Set(rows.filter((row) => row.mount === '/').map((row) => row.device))
  const mounts = [...byDevice.entries()]
    .filter(([device]) => !rootDevices.has(device))
    .map(([, mount]) => mount)
  return ['/', ...mounts.sort()]
}
