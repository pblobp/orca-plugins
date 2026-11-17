import type { OrcaWorkerApi } from 'orca/worker'

const counts: Record<string, number> = {}

export default function activate(orca: OrcaWorkerApi): void {
  orca.panels.handle('count', async ({ name }: { name: string }) => {
    counts[name] = (counts[name] ?? 0) + 1
    return { total: counts[name] }
  })
}
