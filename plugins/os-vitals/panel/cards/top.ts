import type { ProcessRow } from '../../src/protocol.ts'
import { CHEVRON_RIGHT, el, icon, setText } from '../dom.ts'
import { bytes } from '../format.ts'
import type { PanelActions, PanelModel } from '../state.ts'

export function cpuText(value: number): string {
  return value.toFixed(1)
}

export function createTopCard(actions: PanelActions) {
  const allLabel = el('span', { text: 'All' })
  const all = el('button', { className: 'vt-link', attrs: { type: 'button' } }, [
    allLabel,
    icon(CHEVRON_RIGHT, 'vt-icon-stroke vt-icon-small')
  ])
  all.addEventListener('click', () => actions.showProcesses())
  const body = el('tbody')
  const element = el(
    'section',
    { className: 'vt-card vt-top', attrs: { 'aria-labelledby': 'vt-top-title' } },
    [
      el('div', { className: 'vt-card-head vt-center' }, [
        el('h2', { className: 'vt-title', text: 'Top processes', attrs: { id: 'vt-top-title' } }),
        all
      ]),
      el('table', { className: 'vt-mini' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { text: 'Name', attrs: { scope: 'col' } }),
            el('th', { className: 'vt-num', text: 'CPU %', attrs: { scope: 'col' } }),
            el('th', { className: 'vt-num col-mem', text: 'Memory', attrs: { scope: 'col' } })
          ])
        ]),
        body
      ])
    ]
  )
  const rows: {
    row: HTMLTableRowElement
    name: HTMLElement
    cpu: HTMLElement
    memory: HTMLElement
  }[] = []
  const waiting = el('tr', {}, [
    el('td', { className: 'vt-muted', text: 'Reading processes…', attrs: { colspan: '3' } })
  ])

  function show(list: readonly ProcessRow[]): void {
    while (rows.length < list.length) {
      const name = el('td', { className: 'vt-name' })
      const cpu = el('td', { className: 'vt-num' })
      const memory = el('td', { className: 'vt-num vt-fg2 col-mem' })
      rows.push({ row: el('tr', {}, [name, cpu, memory]), name, cpu, memory })
    }
    const visible = rows.slice(0, list.length)
    list.forEach((entry, index) => {
      setText(visible[index].name, entry.name)
      visible[index].name.title = entry.name
      setText(visible[index].cpu, cpuText(entry.cpu))
      setText(visible[index].memory, bytes(entry.memory))
    })
    const nodes = list.length > 0 ? visible.map((entry) => entry.row) : [waiting]
    if (
      body.children.length !== nodes.length ||
      nodes.some((node, i) => body.children[i] !== node)
    ) {
      body.replaceChildren(...nodes)
    }
  }

  function update(model: PanelModel): void {
    element.hidden = !model.sections.processes
    const page = model.processes
    setText(allLabel, page ? `All ${page.total.toLocaleString('en-US')}` : 'All')
    show(page ? page.rows : [])
  }

  return { element, update }
}
