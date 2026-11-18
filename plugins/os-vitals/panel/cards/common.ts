import type { DetailView } from '../../src/protocol.ts'
import { CHEVRON_RIGHT, el, icon, setAttr, setText } from '../dom.ts'
import type { PanelActions } from '../state.ts'

export function legendKey(
  series: string,
  label: string
): { element: HTMLElement; label: HTMLElement } {
  const text = el('span', { text: label })
  const element = el('span', { className: 'vt-key' }, [
    el('span', { className: `vt-swatch vt-${series}`, attrs: { 'aria-hidden': 'true' } }),
    text
  ])
  return { element, label: text }
}

export function cardTitle(
  text: string,
  id: string,
  view: DetailView,
  actions: PanelActions
): HTMLElement {
  const button = el('button', { className: 'vt-title-link', attrs: { type: 'button' } }, [
    el('span', { text }),
    icon(CHEVRON_RIGHT, 'vt-icon-stroke vt-icon-small')
  ])
  button.addEventListener('click', () => actions.openView(view, button))
  return el('h2', { className: 'vt-title', attrs: { id } }, [button])
}

export type RatePair = {
  element: HTMLElement
  set(first: string, second: string): void
}

export function ratePair(firstLabel: string, secondLabel: string): RatePair {
  const first = el('span')
  const second = el('span')
  const element = el('div', { className: 'vt-rates' }, [
    el('span', { className: 'vt-rate' }, [
      first,
      el('span', { className: 'vt-rate-label', text: ` ${firstLabel}` })
    ]),
    el('span', { className: 'vt-rate' }, [
      second,
      el('span', { className: 'vt-rate-label', text: ` ${secondLabel}` })
    ])
  ])
  return {
    element,
    set(a, b) {
      setText(first, a)
      setText(second, b)
    }
  }
}

export type Meter = {
  element: HTMLElement
  set(fraction: number | null, label: string): void
}

export function meter(tone: 'neutral' | 's3' | 's1' = 'neutral'): Meter {
  const fill = el('div', { className: `vt-meter-fill vt-meter-${tone}` })
  const element = el('div', { className: 'vt-meter', attrs: { role: 'img' } }, [fill])
  return {
    element,
    set(fraction, label) {
      const value = fraction === null || !Number.isFinite(fraction) ? 0 : fraction
      fill.style.flexBasis = `${Math.max(0, Math.min(1, value)) * 100}%`
      setAttr(element, 'aria-label', label)
    }
  }
}

export function factRows(labels: readonly string[]): {
  element: HTMLElement
  rows: HTMLElement[]
  labels: HTMLElement[]
  values: HTMLElement[]
} {
  const values = labels.map(() => el('span', { className: 'vt-stat-value' }))
  const names = labels.map((label) => el('span', { className: 'vt-stat-label', text: label }))
  const rows = labels.map((_, index) =>
    el('div', { className: 'vt-stat' }, [names[index], values[index]])
  )
  return { element: el('div', { className: 'vt-stats' }, rows), rows, labels: names, values }
}
