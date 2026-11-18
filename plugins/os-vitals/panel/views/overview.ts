import type { Sections } from '../../src/protocol.ts'
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

const SECTION_NAMES: readonly [keyof Sections, string][] = [
  ['memory', 'Memory'],
  ['network', 'Network'],
  ['disk', 'Disk'],
  ['gpu', 'GPU'],
  ['battery', 'Battery'],
  ['processes', 'The process list'],
  ['energy', 'Energy impact']
]

export function stoppedSections(before: Sections, now: Sections): string[] {
  return SECTION_NAMES.filter(([key]) => before[key] && !now[key]).map(([, name]) => name)
}

export function stoppedText(names: readonly string[]): string {
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  const hidden = names.length === 1 ? 'it is' : 'they are'
  return `${list} stopped answering after repeated failures, so ${hidden} hidden until Orca restarts the plugin.`
}

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
  const stopped = el('p', { className: 'vt-card vt-note vt-limited' })
  const element = el('div', { className: 'vt-stack' }, [
    el('h1', { className: 'vt-sr', text: 'Overview' }),
    limited,
    stopped,
    ...cards.map((card) => card.element)
  ])
  return {
    element,
    update(model) {
      const full = model.hello.platform === 'darwin' || model.hello.platform === 'linux'
      limited.hidden = full
      setText(limited, full ? '' : FALLBACK_TEXT)
      const off = stoppedSections(model.hello.sections, model.sections)
      stopped.hidden = off.length === 0
      setText(stopped, off.length === 0 ? '' : stoppedText(off))
      for (const card of cards) card.update(model)
    },
    query: (model) => (model.sections.processes ? TOP_QUERY : null),
    escape: () => false
  }
}
