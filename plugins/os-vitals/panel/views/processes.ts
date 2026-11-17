import { el } from '../dom.ts'
import type { View } from '../state.ts'

export function createProcesses(): View {
  const element = el('div', { className: 'vt-stack' }, [
    el('section', { className: 'vt-card vt-notice' }, [
      el('h2', { className: 'vt-title', text: 'Processes' }),
      el('p', {
        className: 'vt-muted',
        text: 'The process list is not available in this version of OS Vitals yet.'
      })
    ])
  ])
  return { element, update() {} }
}
