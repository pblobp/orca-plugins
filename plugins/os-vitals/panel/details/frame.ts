import { CHEVRON_LEFT, el, icon, setText } from '../dom.ts'
import { spanAgo } from '../format.ts'
import type { PanelActions, PanelModel, View } from '../state.ts'

export type DetailFrame = {
  element: HTMLElement
  back: HTMLButtonElement
}

export function detailFrame(actions: PanelActions, cards: HTMLElement[]): DetailFrame {
  const back = el('button', { className: 'vt-back', attrs: { type: 'button' } }, [
    icon(CHEVRON_LEFT, 'vt-icon-stroke vt-icon-small'),
    el('span', { text: 'Overview' })
  ])
  back.addEventListener('click', () => actions.back())
  const element = el('div', { className: 'vt-detail' }, [
    el('nav', { className: 'vt-detail-bar', attrs: { 'aria-label': 'Back' } }, [back]),
    el('div', { className: 'vt-stack' }, cards)
  ])
  return { element, back }
}

export function detailView(
  frame: DetailFrame,
  update: (model: PanelModel) => void,
  query: View['query'] = () => null
): View {
  return {
    element: frame.element,
    update,
    query,
    escape: () => false,
    enter: () => frame.back.focus()
  }
}

export function timeCaption(): { element: HTMLElement; update(historyMs: number): void } {
  const start = el('span')
  const element = el(
    'div',
    { className: 'vt-caption vt-time-caption', attrs: { 'aria-hidden': 'true' } },
    [start, el('span', { text: 'Now' })]
  )
  return {
    element,
    update(historyMs) {
      setText(start, spanAgo(historyMs))
    }
  }
}

export function heading(text: string, id: string): HTMLElement {
  return el('h1', { className: 'vt-title', text, attrs: { id } })
}

export function sectionTitle(text: string, id: string): HTMLElement {
  return el('h2', { className: 'vt-title', text, attrs: { id } })
}

export function card(id: string, children: HTMLElement[], className = 'vt-card'): HTMLElement {
  return el('section', { className, attrs: { 'aria-labelledby': id } }, children)
}

export type Cell = string | { text: string; tag: string }

export type MiniTable = {
  element: HTMLTableElement
  show(rows: Cell[][], empty: string): void
}

export function miniTable(headers: readonly string[], classes: readonly string[]): MiniTable {
  const body = el('tbody')
  const element = el('table', { className: 'vt-mini' }, [
    el('thead', {}, [
      el(
        'tr',
        {},
        headers.map((header, index) =>
          el('th', { className: classes[index], text: header, attrs: { scope: 'col' } })
        )
      )
    ]),
    body
  ])
  const rows: {
    row: HTMLTableRowElement
    cells: HTMLElement[]
    texts: HTMLElement[]
    tags: HTMLElement[]
  }[] = []
  const emptyCell = el('td', { className: 'vt-muted', attrs: { colspan: String(headers.length) } })
  const emptyRow = el('tr', {}, [emptyCell])
  return {
    element,
    show(list, empty) {
      while (rows.length < list.length) {
        const texts = headers.map(() => el('span'))
        const tags = headers.map(() => el('span', { className: 'vt-tag' }))
        const cells = headers.map((_, index) =>
          el('td', { className: classes[index] }, [texts[index], tags[index]])
        )
        rows.push({ row: el('tr', {}, cells), cells, texts, tags })
      }
      list.forEach((values, index) => {
        const row = rows[index]
        row.cells.forEach((cell, at) => {
          const value = values[at] ?? ''
          const text = typeof value === 'string' ? value : value.text
          const tag = typeof value === 'string' ? '' : value.tag
          setText(row.texts[at], text)
          setText(row.tags[at], tag ? ` ${tag}` : '')
          row.tags[at].hidden = tag === ''
          if (at === 0) cell.title = tag ? `${text} ${tag}` : text
        })
      })
      setText(emptyCell, empty)
      const nodes =
        list.length > 0 ? rows.slice(0, list.length).map((entry) => entry.row) : [emptyRow]
      if (
        body.children.length !== nodes.length ||
        nodes.some((node, index) => body.children[index] !== node)
      ) {
        body.replaceChildren(...nodes)
      }
    }
  }
}
