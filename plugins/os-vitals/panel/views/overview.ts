import { createBatteryCard } from '../cards/battery.ts'
import { createCpuCard } from '../cards/cpu.ts'
import { createDiskCard } from '../cards/disk.ts'
import { createGpuCard } from '../cards/gpu.ts'
import { createMemoryCard } from '../cards/memory.ts'
import { createNetworkCard } from '../cards/network.ts'
import { createTopCard } from '../cards/top.ts'
import { el, setText } from '../dom.ts'
import { TOP_QUERY, type PanelActions, type View } from '../state.ts'

export const FALLBACK_TEXT =
  'This system gets CPU and memory only. Processes, network, disk, GPU and battery are read on macOS and Linux.'

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
  const limited = el('p', { className: 'vt-card vt-note vt-limited' })
  const element = el('div', { className: 'vt-stack' }, [
    limited,
    ...cards.map((card) => card.element)
  ])
  return {
    element,
    update(model) {
      const full = model.hello.platform === 'darwin' || model.hello.platform === 'linux'
      limited.hidden = full
      setText(limited, full ? '' : FALLBACK_TEXT)
      for (const card of cards) card.update(model)
    },
    query: (model) => (model.sections.processes ? TOP_QUERY : null),
    escape: () => false
  }
}
