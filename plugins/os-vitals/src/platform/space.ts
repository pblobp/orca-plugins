import { statfs } from 'node:fs/promises'

export type VolumeSpace = { total: number; available: number }

export async function readSpace(path: string): Promise<VolumeSpace | null> {
  try {
    const stats = await statfs(path)
    const total = stats.blocks * stats.bsize
    const available = stats.bavail * stats.bsize
    return total > 0 && available >= 0 ? { total, available: Math.min(total, available) } : null
  } catch {
    return null
  }
}
