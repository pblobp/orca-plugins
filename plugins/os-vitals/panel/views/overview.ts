import { createCpuCard } from '../cards/cpu.ts'
import { createMemoryCard } from '../cards/memory.ts'
import { createTopCard } from '../cards/top.ts'
import { el } from '../dom.ts'
import { TOP_QUERY, type PanelActions, type View } from '../state.ts'

export function createOverview(actions: PanelActions): View {
  const cpu = createCpuCard()
  const memory = createMemoryCard()
  const top = createTopCard(actions)
  const element = el('div', { className: 'vt-stack' }, [cpu.element, memory.element, top.element])
  return {
    element,
    update(model) {
      cpu.update(model)
      memory.update(model)
      top.update(model)
    },
    query: (model) => (model.hello.sections.processes ? TOP_QUERY : null),
    escape: () => false
  }
}
