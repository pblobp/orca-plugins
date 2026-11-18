import { createBatteryCard } from '../cards/battery.ts'
import { createCpuCard } from '../cards/cpu.ts'
import { createDiskCard } from '../cards/disk.ts'
import { createGpuCard } from '../cards/gpu.ts'
import { createMemoryCard } from '../cards/memory.ts'
import { createNetworkCard } from '../cards/network.ts'
import { createTopCard } from '../cards/top.ts'
import { el } from '../dom.ts'
import { TOP_QUERY, type PanelActions, type View } from '../state.ts'

export function createOverview(actions: PanelActions): View {
  const cards = [
    createCpuCard(actions),
    createMemoryCard(actions),
    createNetworkCard(actions),
    createDiskCard(actions),
    createGpuCard(actions),
    createBatteryCard(actions),
    createTopCard(actions)
  ]
  const element = el(
    'div',
    { className: 'vt-stack' },
    cards.map((card) => card.element)
  )
  return {
    element,
    update(model) {
      for (const card of cards) card.update(model)
    },
    query: (model) => (model.sections.processes ? TOP_QUERY : null),
    escape: () => false
  }
}
