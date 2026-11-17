import type {
  DetailResult,
  ProcessDetail,
  ProcessQuery,
  ProcessRow,
  ProcessSortKey,
  SortDirection
} from '../../src/protocol.ts'
import { cpuText } from '../cards/top.ts'
import {
  CHEVRON_DOWN,
  CHEVRON_UP,
  CLOSE_ICON,
  el,
  icon,
  SEARCH_ICON,
  setAttr,
  setText,
  toggleAttr
} from '../dom.ts'
import { ago, bytes, cpuTime } from '../format.ts'
import { readStored, writeStored, type PanelActions, type PanelModel, type View } from '../state.ts'

const SORT_STORE = 'os-vitals.sort'
const PAGE = 100
const MAX_ROWS = 1000
const FILTER_DELAY_MS = 250

type Column = { key: ProcessSortKey; label: string; className: string }

const COLUMNS: readonly Column[] = [
  { key: 'name', label: 'Name', className: 'col-name' },
  { key: 'cpu', label: 'CPU %', className: 'col-cpu vt-num' },
  { key: 'memory', label: 'Memory', className: 'col-mem vt-num' },
  { key: 'pid', label: 'PID', className: 'col-pid vt-num' }
]

const SORT_NAMES: Record<ProcessSortKey, string> = {
  name: 'name',
  cpu: 'CPU percent',
  memory: 'memory',
  pid: 'PID'
}

type RowView = {
  tr: HTMLTableRowElement
  name: HTMLElement
  cpu: HTMLElement
  memory: HTMLElement
  pid: HTMLElement
  data: ProcessRow | null
}

type Detail =
  | { status: 'loading' }
  | { status: 'ready'; data: ProcessDetail }
  | { status: 'gone' }
  | { status: 'error'; code: string }

function defaultDirection(key: ProcessSortKey): SortDirection {
  return key === 'name' ? 'asc' : 'desc'
}

function storedSort(): { sort: ProcessSortKey; direction: SortDirection } {
  const [key, direction] = (readStored(SORT_STORE) ?? '').split(':')
  const sort = COLUMNS.find((column) => column.key === key)?.key ?? 'cpu'
  return {
    sort,
    direction: direction === 'asc' || direction === 'desc' ? direction : defaultDirection(sort)
  }
}

function codeOf(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code
  }
  return 'action_failed'
}

function fact(label: string): { element: HTMLElement; value: HTMLElement } {
  const value = el('dd')
  return { element: el('div', { className: 'vt-fact' }, [el('dt', { text: label }), value]), value }
}

export function createProcesses(actions: PanelActions): View {
  let { sort, direction } = storedSort()
  let filter = ''
  let limit = PAGE
  let selected: { pid: number; startedAt: number } | null = null
  let focusedPid: number | null = null
  let detail: Detail | null = null
  let filterTimer: number | undefined
  let model: PanelModel | null = null

  const input = el('input', {
    className: 'vt-search-input',
    attrs: {
      id: 'vt-filter',
      type: 'search',
      placeholder: 'Filter by name or PID',
      autocomplete: 'off',
      spellcheck: 'false'
    }
  })
  const toolbar = el('div', { className: 'vt-toolbar' }, [
    el('div', { className: 'vt-search' }, [
      icon(SEARCH_ICON, 'vt-icon-stroke vt-icon-small'),
      el('label', {
        className: 'vt-hidden-label',
        text: 'Filter processes',
        attrs: { for: 'vt-filter' }
      }),
      input
    ])
  ])

  const headers = COLUMNS.map((column) => {
    const label = el('span', { text: column.label })
    const marker = el('span', { className: 'vt-sort-marker' })
    const button = el('button', { className: 'vt-sort', attrs: { type: 'button' } }, [
      label,
      marker
    ])
    const th = el('th', { className: column.className, attrs: { scope: 'col' } }, [button])
    button.addEventListener('click', () => {
      if (sort === column.key) direction = direction === 'asc' ? 'desc' : 'asc'
      else {
        sort = column.key
        direction = defaultDirection(column.key)
      }
      writeStored(SORT_STORE, `${sort}:${direction}`)
      limit = PAGE
      renderHeaders()
      actions.queryChanged()
    })
    return { column, th, button, marker }
  })

  const body = el('tbody')
  const emptyCell = el('td', { className: 'vt-empty', attrs: { colspan: '4' } })
  const emptyRow = el('tr', { className: 'vt-empty-row' }, [emptyCell])
  const table = el('table', { className: 'vt-table', attrs: { 'aria-label': 'Processes' } }, [
    el('thead', {}, [
      el(
        'tr',
        {},
        headers.map((header) => header.th)
      )
    ]),
    body
  ])
  const countText = el('span', { attrs: { 'aria-live': 'polite' } })
  const loadMore = el('button', {
    className: 'vt-button vt-small',
    text: 'Load more',
    attrs: { type: 'button' }
  })
  const footer = el('div', { className: 'vt-listfoot' }, [countText, loadMore])

  const drawerName = el('span', { className: 'vt-drawer-name' })
  const drawerPid = el('span', { className: 'vt-sub' })
  const closeButton = el(
    'button',
    {
      className: 'vt-icon-button vt-plain',
      attrs: { type: 'button', 'aria-label': 'Close details' }
    },
    [icon(CLOSE_ICON, 'vt-icon-stroke')]
  )
  const facts = {
    user: fact('User'),
    parent: fact('Parent'),
    started: fact('Started'),
    threads: fact('Threads'),
    cpuTime: fact('CPU time'),
    memory: fact('Memory')
  }
  const factList = el(
    'dl',
    { className: 'vt-facts' },
    Object.values(facts).map((entry) => entry.element)
  )
  const commandText = el('code', { className: 'vt-command' })
  const commandBlock = el('div', { className: 'vt-command-block' }, [
    el('span', { className: 'vt-caption', text: 'Command' }),
    commandText
  ])
  const drawerStatus = el('p', { className: 'vt-muted', attrs: { 'aria-live': 'polite' } })
  const drawer = el(
    'section',
    { className: 'vt-drawer', attrs: { 'aria-labelledby': 'vt-drawer-title' } },
    [
      el('div', { className: 'vt-drawer-head' }, [
        el('div', { className: 'vt-drawer-title', attrs: { id: 'vt-drawer-title' } }, [
          drawerName,
          drawerPid
        ]),
        closeButton
      ]),
      drawerStatus,
      factList,
      commandBlock
    ]
  )
  drawer.hidden = true

  const unsupported = el('section', { className: 'vt-card vt-notice' }, [
    el('h2', { className: 'vt-title', text: 'Processes are not available' }),
    el('p', { className: 'vt-muted', text: 'OS Vitals cannot list processes on this system yet.' })
  ])
  const list = el('div', { className: 'vt-proclist' }, [toolbar, table, footer, drawer])
  const element = el('div', { className: 'vt-processes' }, [list, unsupported])
  const rows: RowView[] = []

  function renderHeaders(): void {
    for (const header of headers) {
      const active = header.column.key === sort
      setAttr(
        header.th,
        'aria-sort',
        active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'
      )
      header.button.classList.toggle('vt-sort-active', active)
      const wanted = active ? direction : ''
      if (header.marker.dataset.direction !== wanted) {
        header.marker.dataset.direction = wanted
        header.marker.replaceChildren(
          ...(active
            ? [icon(direction === 'asc' ? CHEVRON_UP : CHEVRON_DOWN, 'vt-icon-stroke vt-icon-tiny')]
            : [])
        )
      }
      const next =
        active && direction === 'desc' ? 'ascending' : active ? 'descending' : 'the default order'
      setAttr(
        header.button,
        'aria-label',
        `${header.column.label}, sort by ${SORT_NAMES[header.column.key]} in ${next}`
      )
    }
  }

  function rowView(): RowView {
    const name = el('td', { className: 'col-name vt-name' })
    const cpu = el('td', { className: 'col-cpu vt-num' })
    const memory = el('td', { className: 'col-mem vt-num vt-fg2' })
    const pid = el('td', { className: 'col-pid vt-num vt-fg3' })
    const tr = el('tr', { className: 'vt-row', attrs: { tabindex: '-1' } }, [
      name,
      cpu,
      memory,
      pid
    ])
    const view: RowView = { tr, name, cpu, memory, pid, data: null }
    return view
  }

  function rowFor(target: EventTarget | null): RowView | undefined {
    const tr = target instanceof Element ? target.closest('tr') : null
    return rows.find((entry) => entry.tr === tr && entry.data)
  }

  function focusRow(view: RowView | undefined): void {
    if (!view?.data) return
    focusedPid = view.data.pid
    for (const entry of rows) entry.tr.tabIndex = entry === view ? 0 : -1
    view.tr.focus()
  }

  function open(data: ProcessRow): void {
    selected = { pid: data.pid, startedAt: data.startedAt }
    focusedPid = data.pid
    detail = { status: 'loading' }
    const wanted = selected
    actions
      .requestDetail(data.pid)
      .then((result: DetailResult) => {
        if (selected !== wanted) return
        detail = result.found ? { status: 'ready', data: result.process } : { status: 'gone' }
        render()
      })
      .catch((error: unknown) => {
        if (selected !== wanted) return
        detail = { status: 'error', code: codeOf(error) }
        render()
      })
    render()
  }

  function close(): void {
    const pid = selected?.pid
    selected = null
    detail = null
    render()
    focusRow(rows.find((entry) => entry.data?.pid === pid))
  }

  function applyFilter(): void {
    filterTimer = undefined
    const next = input.value.trim()
    if (next === filter) return
    filter = next
    limit = PAGE
    actions.queryChanged()
  }

  input.addEventListener('input', () => {
    if (filterTimer !== undefined) window.clearTimeout(filterTimer)
    filterTimer = window.setTimeout(applyFilter, FILTER_DELAY_MS)
  })
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      if (filterTimer !== undefined) window.clearTimeout(filterTimer)
      applyFilter()
    }
  })
  loadMore.addEventListener('click', () => {
    limit = Math.min(MAX_ROWS, limit + PAGE)
    actions.queryChanged()
  })
  closeButton.addEventListener('click', close)
  body.addEventListener('click', (event) => {
    const view = rowFor(event.target)
    if (view?.data) {
      focusRow(view)
      open(view.data)
    }
  })
  body.addEventListener('keydown', (event) => {
    const view = rowFor(event.target)
    if (!view?.data) return
    const visible = rows.filter((entry) => entry.data && entry.tr.isConnected)
    const index = visible.indexOf(view)
    let next: RowView | undefined
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      open(view.data)
      return
    }
    if (event.key === 'ArrowDown') next = visible[index + 1]
    else if (event.key === 'ArrowUp') next = visible[index - 1]
    else if (event.key === 'Home') next = visible[0]
    else if (event.key === 'End') next = visible[visible.length - 1]
    else return
    event.preventDefault()
    focusRow(next)
  })

  function renderRows(page: readonly ProcessRow[]): void {
    const hadFocus = rows.some((entry) => entry.tr === document.activeElement)
    while (rows.length < page.length) rows.push(rowView())
    const visible = rows.slice(0, page.length)
    page.forEach((data, index) => {
      const view = visible[index]
      view.data = data
      setText(view.name, data.name)
      view.name.title = data.name
      setText(view.cpu, cpuText(data.cpu))
      setText(view.memory, bytes(data.memory))
      setText(view.pid, String(data.pid))
      const isSelected =
        selected !== null && selected.pid === data.pid && selected.startedAt === data.startedAt
      view.tr.classList.toggle('vt-selected', isSelected)
      toggleAttr(view.tr, 'aria-selected', isSelected, 'true')
    })
    for (const view of rows.slice(page.length)) view.data = null
    const focusIndex = Math.max(
      0,
      page.findIndex((data) => data.pid === focusedPid)
    )
    visible.forEach((view, index) => {
      view.tr.tabIndex = index === focusIndex ? 0 : -1
    })
    const nodes: HTMLElement[] = visible.length > 0 ? visible.map((view) => view.tr) : [emptyRow]
    if (
      body.children.length !== nodes.length ||
      nodes.some((node, i) => body.children[i] !== node)
    ) {
      body.replaceChildren(...nodes)
    }
    if (hadFocus && visible[focusIndex] && document.activeElement !== visible[focusIndex].tr) {
      visible[focusIndex].tr.focus()
    }
  }

  function renderDrawer(page: readonly ProcessRow[]): void {
    drawer.hidden = selected === null
    if (!selected || !detail) return
    const live = page.find(
      (data) => data.pid === selected?.pid && data.startedAt === selected?.startedAt
    )
    const known = detail.status === 'ready' ? detail.data : null
    setText(drawerName, known?.name ?? live?.name ?? `PID ${selected.pid}`)
    setText(drawerPid, `PID ${selected.pid}`)
    setAttr(
      drawer,
      'aria-label',
      `Details for ${known?.name ?? live?.name ?? `PID ${selected.pid}`}`
    )
    const status =
      detail.status === 'loading'
        ? 'Reading details…'
        : detail.status === 'gone'
          ? 'This process has exited.'
          : detail.status === 'error'
            ? `OS Vitals could not read its details (${detail.code}).`
            : ''
    setText(drawerStatus, status)
    drawerStatus.hidden = status === ''
    factList.hidden = !known
    commandBlock.hidden = !known
    if (!known) return
    setText(facts.user.value, known.user)
    setText(
      facts.parent.value,
      known.parentName ? `${known.parentName} (${known.ppid})` : String(known.ppid)
    )
    setText(facts.started.value, ago(known.startedAt, Date.now()))
    setText(facts.threads.value, known.threads === null ? '–' : String(known.threads))
    setText(facts.cpuTime.value, cpuTime(live?.cpuTime ?? known.cpuTime))
    setText(facts.memory.value, bytes(live?.memory ?? known.memory))
    setText(commandText, known.command)
  }

  function render(): void {
    if (!model) return
    const supported = model.hello.sections.processes
    list.hidden = !supported
    unsupported.hidden = supported
    if (!supported) return
    const page = model.processes
    const shown = page ? page.rows : []
    if (!page) setText(emptyCell, 'Reading processes…')
    else if (page.matched === 0)
      setText(emptyCell, filter ? `No process matches “${filter}”.` : 'No processes.')
    renderRows(shown)
    const total = page ? page.total.toLocaleString('en-US') : '–'
    const matched = page ? page.matched.toLocaleString('en-US') : '–'
    setText(countText, filter ? `${matched} of ${total} processes` : `${total} processes`)
    loadMore.hidden = !page || shown.length >= page.matched || limit >= MAX_ROWS
    renderDrawer(shown)
  }

  renderHeaders()

  return {
    element,
    update(next) {
      model = next
      render()
    },
    query: (current) =>
      current.hello.sections.processes ? { sort, direction, filter, limit, offset: 0 } : null,
    escape() {
      if (!selected) return false
      close()
      return true
    }
  }
}
