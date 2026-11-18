import type {
  DetailResult,
  ListedProcess,
  ProcessDetail,
  ProcessQuery,
  ProcessSortKey,
  QuitOffer,
  QuitReason,
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
import { createConfirmDialog } from '../quit-dialog.ts'
import { readStored, writeStored, type PanelActions, type PanelModel, type View } from '../state.ts'

const SORT_STORE = 'os-vitals.sort'
const PAGE = 100
const MAX_ROWS = 1000
const FILTER_DELAY_MS = 250
const STILL_RUNNING_MS = 5000
const AFTER_FORCE_MS = 1000

const OFFER_TEXT: Record<Exclude<QuitOffer, 'allowed'>, string> = {
  not_owner: 'This process belongs to another user, so it cannot be quit from here.',
  system: 'This process is part of the operating system, so it cannot be quit from here.',
  orca: 'This process is part of Orca, so it cannot be quit from here.'
}

export function refusalText(reason: QuitReason, name: string): string {
  switch (reason) {
    case 'protected':
      return `OS Vitals does not quit ${name}: it is part of the operating system or of Orca.`
    case 'not_owner':
      return `${name} belongs to another user, so OS Vitals cannot quit it.`
    case 'gone':
      return `${name} has already exited.`
    case 'changed':
      return `${name} changed since the list was read, so nothing was sent. Check the list and try again.`
    case 'not_permitted':
      return `The system did not let OS Vitals quit ${name}.`
  }
}

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
  data: ListedProcess | null
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
  let selected: { pid: number; startedAt: number; start: string } | null = null
  let quitStatus = ''
  let forceOffered = false
  let notice = ''
  let quitRun = 0
  const dialog = createConfirmDialog()
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
  const quitNote = el('p', { className: 'vt-muted' })
  const quitStatusLine = el('p', { className: 'vt-quit-status', attrs: { role: 'status' } })
  const forceButton = el('button', {
    className: 'vt-button vt-danger',
    text: 'Force quit…',
    attrs: { type: 'button' }
  })
  const quitButton = el('button', {
    className: 'vt-button vt-danger',
    text: 'Quit…',
    attrs: { type: 'button' }
  })
  const quitActions = el('div', { className: 'vt-quit-actions' }, [forceButton, quitButton])
  const listNotice = el('p', { className: 'vt-list-notice', attrs: { role: 'status' } })
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
      commandBlock,
      quitNote,
      quitStatusLine,
      quitActions
    ]
  )
  drawer.hidden = true

  const unsupported = el('section', { className: 'vt-card vt-notice' }, [
    el('h2', { className: 'vt-title', text: 'Processes are not available' }),
    el('p', { className: 'vt-muted', text: 'OS Vitals cannot list processes on this system yet.' })
  ])
  const list = el('div', { className: 'vt-proclist' }, [toolbar, listNotice, table, footer, drawer])
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

  function open(data: ListedProcess): void {
    selected = { pid: data.pid, startedAt: data.startedAt, start: data.start }
    quitStatus = ''
    forceOffered = false
    notice = ''
    quitRun += 1
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
    quitStatus = ''
    forceOffered = false
    quitRun += 1
    render()
    focusRow(rows.find((entry) => entry.data?.pid === pid))
  }

  function target(): {
    pid: number
    start: string
    name: string
    user: string
    startedAt: number
    command: string
    offer: QuitOffer
  } | null {
    if (!selected) return null
    const live = model?.processes?.rows.find(
      (data) => data.pid === selected?.pid && data.start === selected?.start
    )
    const known = detail?.status === 'ready' ? detail.data : null
    const name = known?.name ?? live?.name
    if (!name) return null
    return {
      pid: selected.pid,
      start: selected.start,
      name,
      user: known?.user ?? live?.user ?? '',
      startedAt: known?.startedAt ?? live?.startedAt ?? selected.startedAt,
      command: known?.command ?? '',
      offer: live?.quit ?? known?.quit ?? 'system'
    }
  }

  async function stillRunning(pid: number, start: string): Promise<boolean | null> {
    try {
      const result = await actions.requestDetail(pid)
      return result.found && result.process.start === start
    } catch {
      return null
    }
  }

  function finishGone(name: string, run: number): void {
    if (run !== quitRun) return
    const pid = selected?.pid
    notice = `${name} has quit.`
    selected = null
    detail = null
    quitStatus = ''
    forceOffered = false
    quitRun += 1
    render()
    actions.queryChanged()
    focusRow(rows.find((entry) => entry.data && entry.data.pid !== pid && entry.tr.isConnected))
  }

  async function checkAfter(run: number, pid: number, start: string, name: string): Promise<void> {
    if (run !== quitRun) return
    const running = await stillRunning(pid, start)
    if (run !== quitRun) return
    if (running === false) {
      finishGone(name, run)
      return
    }
    quitStatus =
      running === null
        ? `OS Vitals could not check whether ${name} quit.`
        : `${name} is still running.`
    forceOffered = running === true
    render()
    if (forceOffered) forceButton.focus()
  }

  async function quit(force: boolean): Promise<void> {
    const current = target()
    if (!current || current.offer !== 'allowed') return
    const started = ago(current.startedAt, Date.now())
    const confirmed = await dialog.confirm(
      force
        ? {
            title: `Force quit ${current.name}?`,
            meta: `PID ${current.pid}, started ${started}${current.user ? ` by ${current.user}` : ''}.`,
            command: current.command,
            warning: `${current.name} is stopped at once. It gets no chance to save its work.`,
            confirmLabel: 'Force quit',
            returnFocus: forceButton
          }
        : {
            title: `Quit ${current.name}?`,
            meta: `PID ${current.pid}, started ${started}${current.user ? ` by ${current.user}` : ''}.`,
            command: current.command,
            warning:
              'The process is asked to exit. Anything it has not saved is lost. ' +
              'If it is still running after 5 seconds, you can force it to quit.',
            confirmLabel: 'Quit',
            returnFocus: quitButton
          }
    )
    if (!confirmed || !selected || selected.pid !== current.pid) return
    quitRun += 1
    const run = quitRun
    forceOffered = false
    quitStatus = force ? `Forcing ${current.name} to quit…` : `Asking ${current.name} to quit…`
    render()
    let reason: QuitReason | null = null
    try {
      const result = await actions.requestQuit({
        pid: current.pid,
        startedAt: current.start,
        force
      })
      reason = result.ok ? null : result.reason
    } catch (error) {
      if (run !== quitRun) return
      quitStatus = `OS Vitals could not ask ${current.name} to quit (${codeOf(error)}).`
      render()
      return
    }
    if (run !== quitRun) return
    actions.queryChanged()
    if (reason) {
      quitStatus = refusalText(reason, current.name)
      render()
      return
    }
    quitStatus = force ? `Forced ${current.name} to quit.` : `Asked ${current.name} to quit.`
    render()
    const wait = force ? AFTER_FORCE_MS : STILL_RUNNING_MS
    window.setTimeout(check, wait)
    function check(): void {
      void checkAfter(run, current?.pid ?? 0, current?.start ?? '', current?.name ?? '')
    }
  }

  quitButton.addEventListener('click', () => {
    void quit(false)
  })
  forceButton.addEventListener('click', () => {
    void quit(true)
  })

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

  function renderRows(page: readonly ListedProcess[]): void {
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
        selected !== null && selected.pid === data.pid && selected.start === data.start
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

  function renderQuit(): void {
    const current = target()
    const offer = current?.offer ?? null
    const quitting = quitStatus !== ''
    quitButton.hidden = offer !== 'allowed' || quitting
    forceButton.hidden = !forceOffered || offer !== 'allowed'
    quitNote.hidden = offer === null || offer === 'allowed'
    setText(quitNote, offer && offer !== 'allowed' ? OFFER_TEXT[offer] : '')
    setText(quitStatusLine, quitStatus)
    quitStatusLine.hidden = quitStatus === ''
    quitActions.hidden = quitButton.hidden && forceButton.hidden
  }

  function renderDrawer(page: readonly ListedProcess[]): void {
    drawer.hidden = selected === null
    if (!selected || !detail) return
    renderQuit()
    const live = page.find((data) => data.pid === selected?.pid && data.start === selected?.start)
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
    const supported = model.sections.processes
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
    setText(listNotice, notice)
    listNotice.hidden = notice === ''
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
      current.sections.processes ? { sort, direction, filter, limit, offset: 0 } : null,
    escape() {
      if (dialog.isOpen() || !selected) return false
      close()
      return true
    }
  }
}
