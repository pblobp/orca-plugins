import type { CoreKind } from '../protocol.ts'

const NODE = /\+-o\s+(\S+)/
const CPU_NODE = /^cpu\d+(@[0-9a-f]+)?$/i
const LOGICAL_ID = /"logical-cpu-id"\s*=\s*(\d+)/
const CLUSTER_TYPE = /"cluster-type"\s*=\s*<"([A-Z])">/

export function parseCoreKinds(text: string): Map<number, CoreKind> {
  const kinds = new Map<number, CoreKind>()
  let inCpu = false
  let id: number | null = null
  let kind: CoreKind | null = null
  const flush = () => {
    if (inCpu && id !== null && kind !== null) kinds.set(id, kind)
    id = null
    kind = null
  }
  for (const line of text.split('\n')) {
    const node = NODE.exec(line)
    if (node) {
      flush()
      inCpu = CPU_NODE.test(node[1])
      continue
    }
    if (!inCpu) continue
    const logical = LOGICAL_ID.exec(line)
    if (logical) id = Number(logical[1])
    const cluster = CLUSTER_TYPE.exec(line)
    if (cluster) {
      if (cluster[1] === 'P') kind = 'performance'
      else if (cluster[1] === 'E') kind = 'efficiency'
    }
  }
  flush()
  return kinds
}
